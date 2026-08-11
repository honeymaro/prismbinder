import { ByteWriter, encodeUtf8 } from '../bytes.js'
import { SIG_CENTRAL, SIG_EOCD, SIG_LOCAL, type ZipArchive } from './types.js'

/**
 * Writes an archive back out.
 *
 * Every header field comes from the parsed entry rather than being recomputed,
 * so `writeZip(readZip(x)) === x` byte-for-byte. That equality is the project's
 * regression gate: it does not prove we understand the format, but it does
 * prove we are not quietly dropping anything we failed to model.
 *
 * The one field we must recompute is each entry's local header offset, since it
 * depends on everything written before it.
 */
export function writeZip(archive: ZipArchive): Uint8Array {
  const w = new ByteWriter(64 * 1024)
  const localOffsets: number[] = []

  for (const e of archive.entries) {
    const nameBytes = encodeUtf8(e.name)
    localOffsets.push(w.length)

    w.u32(SIG_LOCAL)
    w.u16(e.meta.localExtractVersion)
    w.u16(e.meta.flag)
    w.u16(e.meta.method)
    w.u16(e.meta.dosTime)
    w.u16(e.meta.dosDate)
    w.u32(e.meta.crc32)
    w.u32(e.meta.compressedSize)
    w.u32(e.meta.uncompressedSize)
    w.u16(nameBytes.length)
    w.u16(e.meta.extraLocal.length)
    w.bytes(nameBytes)
    w.bytes(e.meta.extraLocal)
    w.bytes(e.stored)
  }

  const cdStart = w.length

  for (let i = 0; i < archive.entries.length; i++) {
    const e = archive.entries[i]!
    const nameBytes = encodeUtf8(e.name)

    w.u32(SIG_CENTRAL)
    w.u16(e.meta.createVersion)
    w.u16(e.meta.extractVersion)
    w.u16(e.meta.flag)
    w.u16(e.meta.method)
    w.u16(e.meta.dosTime)
    w.u16(e.meta.dosDate)
    w.u32(e.meta.crc32)
    w.u32(e.meta.compressedSize)
    w.u32(e.meta.uncompressedSize)
    w.u16(nameBytes.length)
    w.u16(e.meta.extraCentral.length)
    w.u16(e.meta.comment.length)
    w.u16(e.meta.diskStart)
    w.u16(e.meta.internalAttrs)
    w.u32(e.meta.externalAttrs)
    w.u32(localOffsets[i]!)
    w.bytes(nameBytes)
    w.bytes(e.meta.extraCentral)
    w.bytes(e.meta.comment)
  }

  const cdSize = w.length - cdStart

  w.u32(SIG_EOCD)
  w.u16(0) // this disk
  w.u16(0) // disk with the start of the central directory
  w.u16(archive.entries.length)
  w.u16(archive.entries.length)
  w.u32(cdSize)
  w.u32(cdStart)
  w.u16(archive.comment.length)
  w.bytes(archive.comment)

  return w.finish()
}
