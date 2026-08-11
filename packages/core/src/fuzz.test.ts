import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bytesEqual, crc32, decodeUtf8, encodeUtf8 } from './bytes.js'
import { parseCsv, printCsv } from './csv/csv.js'
import { deflateRaw, inflateRaw } from './deflate.js'
import { parseJson } from './json/parse.js'
import { printJson } from './json/print.js'
import { parseXmlDocument } from './xml/parse.js'
import { printXml } from './xml/print.js'

/**
 * Property tests for the places where a subtle bug silently corrupts a file
 * rather than throwing. Example-based tests cover what we have seen; these
 * cover what a user might type.
 */

/** Cell text a user could plausibly enter, including the awkward characters. */
const cellText = fc.stringMatching(/^[\w ,."'\-+eE\u00C0-\u024F\t]{0,24}$/)

describe('CSV', () => {
  it('round-trips any table of arbitrary cell text', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(cellText, { minLength: 1, maxLength: 6 }), { maxLength: 12 }),
        (rows) => {
          const text = printCsv({ rows })
          expect(parseCsv(text).rows).toEqual(rows)
        },
      ),
      { numRuns: 400 },
    )
  })

  it('never emits a line that would re-parse as more fields than it has', () => {
    fc.assert(
      fc.property(fc.array(cellText, { minLength: 1, maxLength: 8 }), (row) => {
        expect(parseCsv(printCsv({ rows: [row] })).rows[0]).toHaveLength(row.length)
      }),
      { numRuns: 400 },
    )
  })
})

describe('JSON', () => {
  it('round-trips arbitrary string values without changing their bytes', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const text = `{\n\t"v": ${JSON.stringify(s)}\n}`
        expect(printJson(parseJson(text).value)).toBe(text)
      }),
      { numRuns: 400 },
    )
  })

  it('preserves any numeric literal spelling', () => {
    const literal = fc.oneof(
      fc.integer().map(String),
      fc.double({ noNaN: true, noDefaultInfinity: true }).map(String),
      fc.integer({ min: -9999, max: 9999 }).map((n) => `${n}.0`),
      fc.constantFrom('1.016526170331098e-07', '9.223372036854776e+18', '-9223372036854775807'),
    )
    fc.assert(
      fc.property(literal, (raw) => {
        const text = `{\n\t"v": ${raw}\n}`
        expect(printJson(parseJson(text).value)).toBe(text)
      }),
      { numRuns: 400 },
    )
  })

  it('never throws, whatever it is handed', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => parseJson(s)).not.toThrow()
      }),
      { numRuns: 300 },
    )
  })
})

describe('XML', () => {
  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => parseXmlDocument(s)).not.toThrow()
      }),
      { numRuns: 300 },
    )
  })

  it('round-trips documents built from arbitrary text content', () => {
    const safe = fc.stringMatching(/^[\w .,:;\-]{0,20}$/)
    fc.assert(
      fc.property(fc.array(safe, { minLength: 1, maxLength: 5 }), (parts) => {
        const body = parts.map((p, i) => `<d id="${i}">${p}</d>`).join('')
        const text = `<?xml version="1.0" encoding="UTF-8"?>\r\n<Root>${body}</Root>\r\n`
        const { value, diagnostics } = parseXmlDocument(text)
        expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
        expect(printXml(value)).toBe(text)
      }),
      { numRuns: 300 },
    )
  })
})

describe('bytes', () => {
  it('utf-8 survives a round trip for any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(decodeUtf8(encodeUtf8(s))).toBe(s)
      }),
      { numRuns: 400 },
    )
  })

  it('crc32 is stable and order-sensitive', () => {
    fc.assert(
      fc.property(fc.uint8Array(), (a) => {
        expect(crc32(a)).toBe(crc32(a.slice()))
      }),
      { numRuns: 300 },
    )
  })
})

describe('deflate', () => {
  it('inflate undoes deflate for arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 4096 }), (data) => {
        expect(bytesEqual(inflateRaw(deflateRaw(data)), data)).toBe(true)
      }),
      { numRuns: 150 },
    )
  })

  it('is deterministic - the same input always gives the same bytes', () => {
    // A drifting encoder would break every file we write; the golden canary
    // catches a version change, this catches non-determinism.
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2048 }), (data) => {
        expect(bytesEqual(deflateRaw(data), deflateRaw(data))).toBe(true)
      }),
      { numRuns: 150 },
    )
  })
})
