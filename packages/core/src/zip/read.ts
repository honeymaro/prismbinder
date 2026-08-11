import { decodeUtf8 } from '../bytes.js'
import { DiagnosticBag, type ParseResult } from '../diagnostics.js'
import {
  DEFAULT_ZIP_LIMITS,
  SIG_CENTRAL,
  SIG_EOCD,
  SIG_EOCD64,
  SIG_EOCD64_LOCATOR,
  SIG_LOCAL,
  type ZipArchive,
  type ZipEntry,
  type ZipLimits,
} from './types.js'

const EOCD_MIN = 22
const MAX_COMMENT = 0xffff

/** ZIP entry names are stored with forward slashes; anything else is suspicious. */
const SAFE_NAME = /^[^\0\\]+$/

/**
 * Characters no legitimate entry name contains and Windows cannot store.
 *
 * The colon is the one that matters: `readme.txt:payload` is not a filename on
 * NTFS, it is an alternate data stream attached to `readme.txt`. Extracting it
 * writes content that does not appear in a directory listing, which is how a
 * crafted archive smuggles a file past someone who looks at what they got.
 */
const WINDOWS_UNSAFE = /[<>:"|?*\u0000-\u001f]/

/** Reserved on Windows with or without an extension: `NUL.csv` is still NUL. */
const RESERVED_DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i

export function isSafeEntryName(name: string): boolean {
  if (!SAFE_NAME.test(name)) return false
  if (name.startsWith('/')) return false
  if (/^[A-Za-z]:/.test(name)) return false

  // Applied per segment, so a reserved name in any directory is caught, and so
  // that the rules read the same way as the path they describe.
  for (const segment of name.split('/')) {
    if (segment === '..') return false
    if (segment === '') continue
    if (WINDOWS_UNSAFE.test(segment)) return false
    if (RESERVED_DEVICE.test(segment)) return false
    // Windows silently strips these, so two distinct entries can collide.
    if (segment !== segment.replace(/[. ]+$/, '')) return false
  }
  return true
}

export interface ReadZipOptions {
  readonly limits?: Partial<ZipLimits>
}

/**
 * Parses an archive's structure without inflating anything.
 *
 * Entry bodies stay compressed until someone asks for them, which keeps
 * `inspect`-style operations cheap on large documents and means a zip bomb
 * costs nothing until it is actually read.
 */
export function readZip(bytes: Uint8Array, opts: ReadZipOptions = {}): ParseResult<ZipArchive> {
  const limits: ZipLimits = { ...DEFAULT_ZIP_LIMITS, ...opts.limits }
  const bag = new DiagnosticBag()
  const empty: ZipArchive = { entries: [], comment: new Uint8Array(0) }

  if (bytes.length < EOCD_MIN) {
    bag.error('zip/truncated', '', `archive is ${bytes.length} bytes, too small to contain an EOCD`)
    return bag.result(empty)
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // Locate the end-of-central-directory record by scanning backwards. The
  // trailing comment is variable length, so its start cannot be computed.
  let eocd = -1
  const scanFloor = Math.max(0, bytes.length - EOCD_MIN - MAX_COMMENT)
  for (let i = bytes.length - EOCD_MIN; i >= scanFloor; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) {
    bag.error('zip/no-eocd', '', 'end-of-central-directory record not found')
    return bag.result(empty)
  }

  let entryCount = view.getUint16(eocd + 10, true)
  let cdOffset = view.getUint32(eocd + 16, true)
  const commentLen = view.getUint16(eocd + 20, true)
  const comment = bytes.subarray(eocd + 22, eocd + 22 + commentLen)

  // ZIP64: the 32-bit fields saturate and the real values live in a separate
  // record. Prism does not currently produce these, but a large enough document
  // eventually would, and silently reading 0xFFFF entries would be worse.
  if (entryCount === 0xffff || cdOffset === 0xffffffff) {
    const locator = eocd - 20
    if (locator >= 0 && view.getUint32(locator, true) === SIG_EOCD64_LOCATOR) {
      const eocd64 = Number(view.getBigUint64(locator + 8, true))
      if (
        eocd64 >= 0 &&
        eocd64 + 56 <= bytes.length &&
        view.getUint32(eocd64, true) === SIG_EOCD64
      ) {
        entryCount = Number(view.getBigUint64(eocd64 + 32, true))
        cdOffset = Number(view.getBigUint64(eocd64 + 48, true))
        bag.info('zip/zip64', '', 'archive uses ZIP64 records')
      } else {
        bag.error('zip/zip64-malformed', '', 'ZIP64 locator present but the record is unreadable')
        return bag.result(empty)
      }
    }
  }

  if (entryCount > limits.maxEntries) {
    bag.error(
      'zip/too-many-entries',
      '',
      `archive declares ${entryCount} entries, above the limit of ${limits.maxEntries}`,
    )
    return bag.result(empty)
  }

  const entries: ZipEntry[] = []
  let off = cdOffset
  let totalUncompressed = 0

  for (let i = 0; i < entryCount; i++) {
    if (off + 46 > bytes.length || view.getUint32(off, true) !== SIG_CENTRAL) {
      bag.error(
        'zip/bad-central-record',
        '',
        `central directory record ${i} is missing or malformed at offset ${off}`,
      )
      break
    }

    const createVersion = view.getUint16(off + 4, true)
    const extractVersion = view.getUint16(off + 6, true)
    const flag = view.getUint16(off + 8, true)
    const method = view.getUint16(off + 10, true)
    const dosTime = view.getUint16(off + 12, true)
    const dosDate = view.getUint16(off + 14, true)
    const crc = view.getUint32(off + 16, true)
    const compressedSize = view.getUint32(off + 20, true)
    const uncompressedSize = view.getUint32(off + 24, true)
    const nameLen = view.getUint16(off + 28, true)
    const extraLen = view.getUint16(off + 30, true)
    const commentLenCd = view.getUint16(off + 32, true)
    const diskStart = view.getUint16(off + 34, true)
    const internalAttrs = view.getUint16(off + 36, true)
    const externalAttrs = view.getUint32(off + 38, true)
    const localOffset = view.getUint32(off + 42, true)

    const nameBytes = bytes.subarray(off + 46, off + 46 + nameLen)
    const name = decodeUtf8(nameBytes)
    const extraCentral = bytes.subarray(off + 46 + nameLen, off + 46 + nameLen + extraLen)
    const entryComment = bytes.subarray(
      off + 46 + nameLen + extraLen,
      off + 46 + nameLen + extraLen + commentLenCd,
    )

    if (!isSafeEntryName(name)) {
      bag.warn('zip/unsafe-name', name, 'entry name is unsafe to write to disk as-is')
    }

    // The local header repeats most fields and carries its own extra field,
    // which is routinely a different length from the central one.
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== SIG_LOCAL) {
      bag.error('zip/bad-local-header', name, `local header missing at offset ${localOffset}`)
      off += 46 + nameLen + extraLen + commentLenCd
      continue
    }
    const localExtractVersion = view.getUint16(localOffset + 4, true)
    const localNameLen = view.getUint16(localOffset + 26, true)
    const localExtraLen = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const extraLocal = bytes.subarray(
      localOffset + 30 + localNameLen,
      localOffset + 30 + localNameLen + localExtraLen,
    )

    if (dataStart + compressedSize > bytes.length) {
      bag.error('zip/truncated-entry', name, 'entry data extends past the end of the archive')
      off += 46 + nameLen + extraLen + commentLenCd
      continue
    }

    // Decompression bomb guards, applied to declared sizes before we inflate.
    if (compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio) {
      bag.error(
        'zip/ratio-exceeded',
        name,
        `compression ratio ${(uncompressedSize / compressedSize).toFixed(0)}:1 exceeds the limit of ${limits.maxCompressionRatio}:1`,
      )
      off += 46 + nameLen + extraLen + commentLenCd
      continue
    }
    totalUncompressed += uncompressedSize
    if (totalUncompressed > limits.maxTotalUncompressed) {
      bag.error(
        'zip/size-exceeded',
        name,
        `total uncompressed size would exceed ${limits.maxTotalUncompressed} bytes`,
      )
      break
    }

    entries.push({
      name,
      isDirectory: name.endsWith('/'),
      meta: {
        createVersion,
        extractVersion,
        localExtractVersion,
        flag,
        method,
        dosTime,
        dosDate,
        crc32: crc,
        compressedSize,
        uncompressedSize,
        internalAttrs,
        externalAttrs,
        diskStart,
        extraCentral,
        extraLocal,
        comment: entryComment,
      },
      stored: bytes.subarray(dataStart, dataStart + compressedSize),
    })

    off += 46 + nameLen + extraLen + commentLenCd
  }

  return bag.result({ entries, comment })
}
