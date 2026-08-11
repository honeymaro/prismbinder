import { describe, expect, it } from 'vitest'
import { ByteWriter, crc32 } from '../bytes.js'
import { deflateRaw, inflateRawBounded } from '../deflate.js'
import { readEntry } from './entry.js'
import { isSafeEntryName, readZip } from './read.js'
import type { ZipArchive, ZipEntry } from './types.js'
import { writeZip } from './write.js'

/**
 * Guards against files built to hurt us.
 *
 * Everything here is a case that once got through. The decompression bound in
 * particular was checked against the size the archive *claims*, which is a
 * number the archive's author chooses - a 204 KB file could declare a 1:1
 * ratio, pass every check, and inflate to 200 MB.
 */

function entry(name: string, content: Uint8Array, declaredSize?: number): ZipEntry {
  const stored = deflateRaw(content)
  return {
    name,
    isDirectory: false,
    stored,
    meta: {
      createVersion: 0x033f,
      extractVersion: 20,
      localExtractVersion: 20,
      flag: 4,
      method: 8,
      dosTime: 0,
      dosDate: 0,
      crc32: crc32(content),
      compressedSize: stored.length,
      uncompressedSize: declaredSize ?? content.length,
      internalAttrs: 0,
      externalAttrs: 0,
      diskStart: 0,
      extraCentral: new Uint8Array(0),
      extraLocal: new Uint8Array(0),
      comment: new Uint8Array(0),
    },
  }
}

describe('decompression bounds', () => {
  it('refuses an entry that expands past what it declares', () => {
    // The bomb: 2 MB of zeros compressed, but the header says it is small, so
    // no ratio check can see it coming.
    const payload = new Uint8Array(2 * 1024 * 1024)
    const e = entry('big.bin', payload, 1024)

    const { value, diagnostics } = readEntry(e)
    expect(value.length).toBe(0)
    expect(diagnostics.map((d) => d.code)).toContain('zip/inflate-failed')
  })

  it('accepts an honest entry of the same size', () => {
    const payload = new Uint8Array(2 * 1024 * 1024)
    const { value, diagnostics } = readEntry(entry('big.bin', payload))
    expect(value.length).toBe(payload.length)
    expect(diagnostics).toEqual([])
  })

  it('stops producing output rather than producing it and discarding it', () => {
    const payload = new Uint8Array(1024 * 1024)
    expect(inflateRawBounded(deflateRaw(payload), 4096)).toBeUndefined()
    expect(inflateRawBounded(deflateRaw(payload), payload.length)?.length).toBe(payload.length)
  })
})

describe('integrity', () => {
  it('reports a CRC mismatch instead of handing back the bytes', () => {
    const good = entry('data.csv', new TextEncoder().encode('a,b\n1,2\n'))
    const tampered: ZipEntry = { ...good, meta: { ...good.meta, crc32: good.meta.crc32 ^ 0xff } }

    const { value, diagnostics } = readEntry(tampered)
    expect(value.length).toBe(0)
    expect(diagnostics.map((d) => d.code)).toContain('zip/crc-mismatch')
  })

  it('can be asked to skip the check', () => {
    const good = entry('data.csv', new TextEncoder().encode('a,b\n1,2\n'))
    const tampered: ZipEntry = { ...good, meta: { ...good.meta, crc32: 0 } }
    expect(readEntry(tampered, { verifyCrc: false }).value.length).toBeGreaterThan(0)
  })

  it('round-trips a well-formed archive through the checks', () => {
    const archive: ZipArchive = {
      entries: [
        entry('a.txt', new TextEncoder().encode('hello')),
        entry('b.txt', new TextEncoder().encode('world')),
      ],
      comment: new Uint8Array(0),
    }
    const { value } = readZip(writeZip(archive))
    expect(value.entries).toHaveLength(2)
    for (const e of value.entries) {
      const r = readEntry(e)
      expect(r.diagnostics, e.name).toEqual([])
      expect(r.value.length).toBe(5)
    }
  })
})

describe('entry names that are unsafe to write to disk', () => {
  const rejected = [
    '../escape.txt',
    'a/../../escape.txt',
    '/absolute.txt',
    'C:/drive.txt',
    // Not a filename on NTFS: an alternate data stream hidden on readme.txt.
    'readme.txt:payload',
    'dir/CON/x.txt',
    'NUL.csv',
    'com1.txt',
    'a<b.txt',
    'a>b.txt',
    'a|b.txt',
    'a?b.txt',
    'a*b.txt',
    // Windows strips these, so two archive entries would collide on disk.
    'trailing./x.txt',
    'trailing /x.txt',
  ]
  it.each(rejected)('rejects %j', (name) => {
    expect(isSafeEntryName(name)).toBe(false)
  })

  const accepted = [
    'data/tables/9F3A4B2C-1111-2222-3333-444455556666/data.csv',
    'misc/used_fonts.bin',
    'graphs/A1B2/data.bin',
    'a name with spaces.json',
    'dashes-and_underscores.txt',
  ]
  it.each(accepted)('accepts %j', (name) => {
    expect(isSafeEntryName(name)).toBe(true)
  })
})

describe('ByteWriter', () => {
  it('grows from an empty initial capacity', () => {
    // Doubling from zero never terminates; this used to hang the caller.
    const w = new ByteWriter(0)
    w.u32(0x12345678)
    expect(w.length).toBe(4)
  })
})
