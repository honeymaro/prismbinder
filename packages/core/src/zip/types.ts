/**
 * ZIP structures, modelled so that a parse followed by a write reproduces the
 * original bytes exactly.
 *
 * That is a stricter requirement than "produces a valid archive", and it is why
 * we do not use an off-the-shelf library. Prism's archives are not uniform:
 * within a single file, `extractVersion` is 20 for most entries but 45 for
 * everything under `data/tables/` (with no ZIP64 extra field, so 45 here is not
 * a size signal), directories are stored while files are deflated, and the
 * general-purpose flag is 0x0 on directories and 0x4 on files. Every one of
 * those has to survive a round trip, so every one of them is a field here
 * rather than something we infer at write time.
 */

/** Per-entry metadata, preserved verbatim across a round trip. */
export interface ZipEntryMeta {
  /** Central directory "version made by". Prism writes 0x033F (Unix host, spec 6.3). */
  readonly createVersion: number
  /** "Version needed to extract" in the central directory. Prism uses 20 or 45. */
  readonly extractVersion: number
  /** Same field in the local header. Normally equal to the above; kept separately for fidelity. */
  readonly localExtractVersion: number
  /** General purpose bit flag. Bit 2 (0x4) declares "fast" compression. */
  readonly flag: number
  /** 0 = stored, 8 = deflate. */
  readonly method: number
  /** MS-DOS time and date, as stored. */
  readonly dosTime: number
  readonly dosDate: number
  readonly crc32: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly internalAttrs: number
  /** Unix mode in the high 16 bits: 0x41ff0000 for directories, 0x81b60000 for files. */
  readonly externalAttrs: number
  readonly diskStart: number
  /** Extra fields, which may legitimately differ between the two headers. */
  readonly extraCentral: Uint8Array
  readonly extraLocal: Uint8Array
  readonly comment: Uint8Array
}

export interface ZipEntry {
  readonly name: string
  readonly isDirectory: boolean
  readonly meta: ZipEntryMeta
  /**
   * The entry's bytes exactly as they sit in the archive, still compressed
   * when `meta.method` says so. Holding these rather than the inflated content
   * is what lets untouched entries be copied through byte-for-byte.
   */
  readonly stored: Uint8Array
}

export interface ZipArchive {
  /** Original order is preserved: it is stable across Prism's own writes and we do not know that nothing depends on it. */
  readonly entries: readonly ZipEntry[]
  readonly comment: Uint8Array
}

/** Guards against hostile archives. A browser tab opening an untrusted file needs these. */
export interface ZipLimits {
  /** Reject an entry whose uncompressed size exceeds this many times its compressed size. */
  readonly maxCompressionRatio: number
  /** Reject once total inflated bytes would exceed this. */
  readonly maxTotalUncompressed: number
  readonly maxEntries: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = Object.freeze({
  maxCompressionRatio: 200,
  maxTotalUncompressed: 256 * 1024 * 1024,
  maxEntries: 50_000,
})

export const SIG_LOCAL = 0x04034b50
export const SIG_CENTRAL = 0x02014b50
export const SIG_EOCD = 0x06054b50
export const SIG_EOCD64 = 0x06064b50
export const SIG_EOCD64_LOCATOR = 0x07064b50
export const SIG_DATA_DESCRIPTOR = 0x08074b50
