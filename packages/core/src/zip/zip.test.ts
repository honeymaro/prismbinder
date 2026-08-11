import { describe, expect, it } from 'vitest'
import { bytesEqual, crc32, decodeUtf8, encodeUtf8 } from '../bytes.js'
import { deflateRaw } from '../deflate.js'
import { readEntry, replaceEntryContent, withEntryContents } from './entry.js'
import { isSafeEntryName, readZip } from './read.js'
import type { ZipArchive, ZipEntry } from './types.js'
import { writeZip } from './write.js'

/**
 * Builds an entry that mimics Prism's own header choices, so the round-trip
 * tests exercise the field combinations we actually have to reproduce:
 * directories stored with flag 0x0, files deflated with flag 0x4, and the
 * extractVersion 45 that Prism uses under data/tables/ without any ZIP64 extra.
 */
function makeEntry(name: string, content: Uint8Array | null, extractVersion = 20): ZipEntry {
  const isDir = content === null
  const body = isDir ? new Uint8Array(0) : content
  const stored = isDir ? body : deflateRaw(body)
  return {
    name,
    isDirectory: isDir,
    meta: {
      createVersion: 0x033f,
      extractVersion,
      localExtractVersion: extractVersion,
      flag: isDir ? 0x0 : 0x4,
      method: isDir ? 0 : 8,
      dosTime: 0x6bc7,
      dosDate: 0x58e7,
      crc32: crc32(body),
      compressedSize: stored.length,
      uncompressedSize: body.length,
      internalAttrs: 0,
      externalAttrs: isDir ? 0x41ff0000 : 0x81b60000,
      diskStart: 0,
      extraCentral: new Uint8Array(0),
      extraLocal: new Uint8Array(0),
      comment: new Uint8Array(0),
    },
    stored,
  }
}

function sampleArchive(): ZipArchive {
  const json = encodeUtf8('{\n\t"@class": "Document",\n\t"n": 1676.0\n}')
  const csv = encodeUtf8(',1,3\n,2,4\n')
  return {
    entries: [
      makeEntry('data/', null),
      makeEntry('data/sheets/', null),
      makeEntry('document.json', json),
      makeEntry('data/tables/abc/data.csv', csv, 45),
    ],
    comment: new Uint8Array(0),
  }
}

describe('crc32', () => {
  it('matches the published check value', () => {
    // The CRC-32 of "123456789" is the standard conformance vector.
    expect(crc32(encodeUtf8('123456789'))).toBe(0xcbf43926)
  })

  it('is zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('isSafeEntryName', () => {
  it('accepts ordinary bundle paths', () => {
    expect(isSafeEntryName('data/tables/abc/data.csv')).toBe(true)
    expect(isSafeEntryName('document.json')).toBe(true)
  })

  it('rejects traversal, absolute paths, drive letters, backslashes and NUL', () => {
    expect(isSafeEntryName('../etc/passwd')).toBe(false)
    expect(isSafeEntryName('a/../../b')).toBe(false)
    expect(isSafeEntryName('/etc/passwd')).toBe(false)
    expect(isSafeEntryName('C:/Windows/system32')).toBe(false)
    expect(isSafeEntryName('a\\b')).toBe(false)
    expect(isSafeEntryName('a\0b')).toBe(false)
  })
})

describe('zip round trip', () => {
  it('reproduces its own output byte-for-byte', () => {
    const original = writeZip(sampleArchive())
    const { value, diagnostics } = readZip(original)
    expect(diagnostics).toEqual([])
    expect(bytesEqual(writeZip(value), original)).toBe(true)
  })

  it('preserves every header field through a parse', () => {
    const archive = sampleArchive()
    const { value } = readZip(writeZip(archive))
    expect(value.entries.map((e) => e.name)).toEqual(archive.entries.map((e) => e.name))
    for (let i = 0; i < archive.entries.length; i++) {
      expect(value.entries[i]?.meta).toEqual(archive.entries[i]?.meta)
    }
  })

  it('keeps the mixed extractVersion that Prism writes', () => {
    const { value } = readZip(writeZip(sampleArchive()))
    const versions = value.entries.map((e) => e.meta.extractVersion)
    expect(versions).toEqual([20, 20, 20, 45])
    // 45 normally implies ZIP64; Prism uses it without any ZIP64 extra field,
    // so we must not synthesise one.
    expect(value.entries[3]?.meta.extraCentral.length).toBe(0)
  })

  it('reads entry contents back', () => {
    const { value } = readZip(writeZip(sampleArchive()))
    const doc = value.entries.find((e) => e.name === 'document.json')
    expect(doc).toBeDefined()
    expect(new TextDecoder().decode(readEntry(doc as ZipEntry).value)).toContain('1676.0')
  })
})

describe('editing', () => {
  it('rewrites one entry and leaves the others byte-identical', () => {
    const { value: before } = readZip(writeZip(sampleArchive()))
    const after = withEntryContents(
      before,
      new Map([['document.json', encodeUtf8('{\n\t"@class": "Document",\n\t"n": 2.0\n}')]]),
    )

    // Only the edited entry changed; every other stored payload is the same object.
    for (let i = 0; i < before.entries.length; i++) {
      const a = before.entries[i]!
      const b = after.entries[i]!
      if (a.name === 'document.json') {
        expect(bytesEqual(a.stored, b.stored)).toBe(false)
      } else {
        expect(bytesEqual(a.stored, b.stored)).toBe(true)
      }
    }

    const reread = readZip(writeZip(after)).value
    const doc = reread.entries.find((e) => e.name === 'document.json')!
    expect(new TextDecoder().decode(readEntry(doc).value)).toContain('2.0')
  })

  it('recomputes crc and sizes when content is replaced', () => {
    const entry = makeEntry('a.txt', encodeUtf8('hello'))
    const next = replaceEntryContent(entry, encodeUtf8('a longer replacement value'))
    expect(next.meta.uncompressedSize).toBe(26)
    expect(next.meta.crc32).toBe(crc32(encodeUtf8('a longer replacement value')))
    expect(next.meta.compressedSize).toBe(next.stored.length)
  })

  it('refuses to update an entry that does not exist', () => {
    const { value } = readZip(writeZip(sampleArchive()))
    expect(() => withEntryContents(value, new Map([['nope.json', new Uint8Array(1)]]))).toThrow(
      /no such entry/,
    )
  })
})

describe('hostile input', () => {
  it('reports a truncated archive instead of throwing', () => {
    const { value, diagnostics } = readZip(new Uint8Array(4))
    expect(value.entries).toEqual([])
    expect(diagnostics[0]?.code).toBe('zip/truncated')
  })

  it('reports a missing EOCD instead of throwing', () => {
    const { diagnostics } = readZip(new Uint8Array(64))
    expect(diagnostics[0]?.code).toBe('zip/no-eocd')
  })

  it('rejects an entry whose declared ratio is a decompression bomb', () => {
    const bomb = writeZip({
      entries: [
        {
          ...makeEntry('bomb', encodeUtf8('x')),
          meta: { ...makeEntry('bomb', encodeUtf8('x')).meta, uncompressedSize: 10_000_000 },
        },
      ],
      comment: new Uint8Array(0),
    })
    const { value, diagnostics } = readZip(bomb)
    expect(value.entries).toHaveLength(0)
    expect(diagnostics.some((d) => d.code === 'zip/ratio-exceeded')).toBe(true)
  })

  it('enforces the entry count limit', () => {
    const { diagnostics } = readZip(writeZip(sampleArchive()), { limits: { maxEntries: 2 } })
    expect(diagnostics.some((d) => d.code === 'zip/too-many-entries')).toBe(true)
  })

  it('flags unsafe entry names without refusing to parse', () => {
    const evil = writeZip({
      entries: [makeEntry('../escape.txt', encodeUtf8('x'))],
      comment: new Uint8Array(0),
    })
    const { value, diagnostics } = readZip(evil)
    expect(value.entries).toHaveLength(1)
    expect(diagnostics.some((d) => d.code === 'zip/unsafe-name')).toBe(true)
  })
})

describe('utf-8 round trip', () => {
  it('preserves a BOM instead of silently eating it', () => {
    // Two XML documents in the corpus start with a BOM. TextDecoder strips it
    // by default, which shortened them by three bytes on every round trip.
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e])
    expect(encodeUtf8(decodeUtf8(withBom))).toEqual(withBom)
  })

  it('round-trips non-ASCII', () => {
    const s = '\u0130stanbul \u03B7 \u00B2 \u0160 \u00ED \u00E1 \u00B5M'
    expect(decodeUtf8(encodeUtf8(s))).toBe(s)
  })
})
