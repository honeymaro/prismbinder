import { crc32 } from '../bytes.js'
import { deflateRaw, inflateRawBounded } from '../deflate.js'
import { DiagnosticBag, type ParseResult, PrismbinderError } from '../diagnostics.js'
import { DEFAULT_ZIP_LIMITS, type ZipArchive, type ZipEntry, type ZipEntryMeta } from './types.js'

export const METHOD_STORE = 0
export const METHOD_DEFLATE = 8

export interface ReadEntryOptions {
  /** Hard ceiling on inflated output. Defaults to the archive-wide limit. */
  readonly maxOutputBytes?: number
  /**
   * Verify the entry against the CRC-32 the archive records.
   *
   * On by default. It costs one pass over data we have just materialised, and
   * it is the only integrity check the container offers for free.
   */
  readonly verifyCrc?: boolean
}

/**
 * Inflates an entry's content.
 *
 * Returns diagnostics rather than throwing, because a hostile or damaged entry
 * is file content, and file content never throws here - the rest of the
 * document still has to load. An unsupported *compression method* is different:
 * that is us failing to implement something, so it stays an exception.
 *
 * On failure the value is empty. Callers must not treat that as "the entry was
 * empty"; they should surface the diagnostic. The two cases are distinguishable
 * by `meta.uncompressedSize`, which a genuinely empty entry reports as 0.
 */
export function readEntry(entry: ZipEntry, opts: ReadEntryOptions = {}): ParseResult<Uint8Array> {
  const bag = new DiagnosticBag()

  /**
   * Two ceilings, and we take the lower.
   *
   * The absolute one keeps a single entry from spending the whole process's
   * memory. The declared size is the tighter and more interesting one: it is
   * written by whoever made the file, so it cannot be trusted as a promise -
   * but it is perfectly sound as an *upper bound*, because a stream that
   * produces more than its own header claims is malformed by definition, and
   * one that under-claims only makes us stricter than necessary. That
   * asymmetry is what turns an attacker-controlled number into a usable guard.
   */
  const ceiling = opts.maxOutputBytes ?? DEFAULT_ZIP_LIMITS.maxTotalUncompressed
  const limit = Math.min(ceiling, entry.meta.uncompressedSize)

  if (entry.meta.method !== METHOD_STORE && entry.meta.method !== METHOD_DEFLATE) {
    throw new PrismbinderError(
      `unsupported compression method ${entry.meta.method} for "${entry.name}"`,
    )
  }

  let content: Uint8Array
  if (entry.meta.method === METHOD_STORE) {
    content = entry.stored
    if (content.length > limit) {
      bag.error(
        'zip/entry-too-large',
        entry.name,
        `stored entry is ${content.length} bytes, above the ${limit} byte limit`,
      )
      return bag.result(new Uint8Array(0))
    }
  } else {
    // Bounded on produced bytes, not on the size the header claims: the header
    // is written by whoever made the file and is not evidence of anything.
    const inflated = inflateRawBounded(entry.stored, limit)
    if (inflated === undefined) {
      bag.error(
        'zip/inflate-failed',
        entry.name,
        `entry is malformed, or expands beyond the ${limit} bytes it declares`,
      )
      return bag.result(new Uint8Array(0))
    }
    content = inflated
  }

  if (content.length !== entry.meta.uncompressedSize) {
    bag.warn(
      'zip/size-mismatch',
      entry.name,
      `entry declares ${entry.meta.uncompressedSize} bytes but inflates to ${content.length}`,
    )
  }

  if (opts.verifyCrc !== false && crc32(content) !== entry.meta.crc32) {
    bag.error('zip/crc-mismatch', entry.name, 'entry contents do not match the recorded CRC-32')
    return bag.result(new Uint8Array(0))
  }

  return bag.result(content)
}

/**
 * Produces a new entry carrying `content`, keeping every other header field.
 *
 * Recompression uses Prism's exact deflate parameters, so a rewritten entry is
 * indistinguishable from one Prism wrote itself - verified over 1,539 streams
 * from two independent corpora. See docs/measurements.md M1.
 */
export function replaceEntryContent(entry: ZipEntry, content: Uint8Array): ZipEntry {
  const method = entry.meta.method === METHOD_STORE ? METHOD_STORE : METHOD_DEFLATE
  const stored = method === METHOD_STORE ? content : deflateRaw(content)
  const meta: ZipEntryMeta = {
    ...entry.meta,
    method,
    crc32: crc32(content),
    compressedSize: stored.length,
    uncompressedSize: content.length,
  }
  return { ...entry, meta, stored }
}

/** Looks an entry up by exact name. */
export function findEntry(archive: ZipArchive, name: string): ZipEntry | undefined {
  return archive.entries.find((e) => e.name === name)
}

/**
 * Returns a copy of `archive` with the named entries replaced.
 *
 * Entries that are not mentioned keep their original compressed bytes, so a
 * targeted edit leaves the rest of the file untouched at the byte level. That
 * is what makes a diff of two round-tripped documents readable.
 */
export function withEntryContents(
  archive: ZipArchive,
  updates: ReadonlyMap<string, Uint8Array>,
): ZipArchive {
  if (updates.size === 0) return archive
  const seen = new Set<string>()
  const entries = archive.entries.map((e) => {
    const next = updates.get(e.name)
    if (next === undefined) return e
    seen.add(e.name)
    return replaceEntryContent(e, next)
  })
  for (const name of updates.keys()) {
    if (!seen.has(name)) throw new PrismbinderError(`cannot update "${name}": no such entry`)
  }
  return { ...archive, entries }
}
