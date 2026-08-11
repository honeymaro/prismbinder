import { describe, expect, it } from 'vitest'
import { jsonFloat, jsonInt, jsonObject, jsonString, setMember } from './build.js'
import { asNumber, asString, detectJsonFormat, getMember, parseJson } from './parse.js'
import { printJson, printJsonNode } from './print.js'
import { formatForEntry, JSON_FORMAT_TAB } from './types.js'

const roundTrip = (text: string): string => {
  const { value } = parseJson(text)
  return printJson(value)
}

describe('format detection', () => {
  it('recognises tabs without a trailing newline', () => {
    const f = detectJsonFormat('{\n\t"a": 1\n}')
    expect(f.indent).toBe('\t')
    expect(f.trailingNewline).toBe(false)
  })

  it('recognises four spaces with a trailing newline', () => {
    const f = detectJsonFormat('{\n    "a": 1\n}\n')
    expect(f.indent).toBe('    ')
    expect(f.trailingNewline).toBe(true)
  })

  it('maps content.json to the four-space style and everything else to tabs', () => {
    // Two styles coexist in one archive; the four-space one is confined to the
    // data/tables subtree, which is also the one with extractVersion 45.
    expect(formatForEntry('data/tables/ABC/content.json').indent).toBe('    ')
    expect(formatForEntry('data/tables/ABC/content.json').trailingNewline).toBe(true)
    expect(formatForEntry('document.json').indent).toBe('\t')
    expect(formatForEntry('data/sets/ABC.json').indent).toBe('\t')
  })
})

describe('number fidelity', () => {
  it('keeps the .0 suffix that JSON.stringify would drop', () => {
    const text = '{\n\t"sum": 1676.0,\n\t"level": 95.0,\n\t"zero": 0.0\n}'
    expect(roundTrip(text)).toBe(text)
    // For contrast, the standard round trip loses all three.
    expect(JSON.stringify(JSON.parse(text))).toBe('{"sum":1676,"level":95,"zero":0}')
  })

  it('keeps an integer larger than 2^53 that a JS number cannot hold', () => {
    const text = '{\n\t"min": -9223372036854775807\n}'
    expect(roundTrip(text)).toBe(text)

    // The decoded value is lossy - it rounds to -9223372036854775808 - which is
    // exactly why `raw` rather than `value` is the authoritative form.
    const node = getMember(parseJson(text).value.root, 'min')
    const decoded = asNumber(node)
    expect(String(decoded)).toBe('-9223372036854776000')
    expect(node?.kind === 'scalar' && node.raw).toBe('-9223372036854775807')
    // Writing the decoded value back would corrupt the file.
    expect(String(decoded)).not.toBe('-9223372036854775807')
  })

  it('keeps exponent spelling', () => {
    const text = '{\n\t"a": 1.016526170331098e-07,\n\t"b": 9.223372036854776e+18\n}'
    expect(roundTrip(text)).toBe(text)
  })

  it('keeps full precision that shortest-round-trip would shorten', () => {
    const text = '{\n\t"h": 535.3333129882813,\n\t"w": 244.66665649414063\n}'
    expect(roundTrip(text)).toBe(text)
  })
})

describe('key order', () => {
  it('keeps numeric-looking keys in their original, non-ascending order', () => {
    // A plain JS object would reorder these to 0,1,2,3,4 and move the string
    // key last; real files contain exactly this shape.
    const text = '{\n\t"2": 1,\n\t"1": 2,\n\t"4": 3,\n\t"3": 4,\n\t"0": 5\n}'
    expect(roundTrip(text)).toBe(text)
    expect(Object.keys(JSON.parse(text))).toEqual(['0', '1', '2', '3', '4'])
  })

  it('keeps ordinary key order', () => {
    const text = '{\n\t"z": 1,\n\t"a": 2,\n\t"m": 3\n}'
    expect(roundTrip(text)).toBe(text)
  })
})

describe('string fidelity', () => {
  it('keeps the escapes the format actually uses', () => {
    // \r is the paragraph separator inside Prism's rich text.
    const text = '{\n\t"note": "line one\\r\\rline two\\ttab \\"quoted\\" back\\\\slash"\n}'
    expect(roundTrip(text)).toBe(text)
  })

  it('keeps raw non-ASCII rather than re-escaping it', () => {
    const text = '{\n\t"city": "\u0130stanbul",\n\t"unit": "\u00B5M"\n}'
    expect(roundTrip(text)).toBe(text)
  })
})

describe('structure', () => {
  it('round-trips empty containers, nesting and mixed types', () => {
    const text =
      '{\n\t"warning": [],\n\t"empty": {},\n\t"nested": {\n\t\t"list": [\n\t\t\t1,\n\t\t\t2.5,\n\t\t\ttrue,\n\t\t\tnull,\n\t\t\t"s"\n\t\t]\n\t}\n}'
    expect(roundTrip(text)).toBe(text)
  })

  it('round-trips the four-space style with its trailing newline', () => {
    const text = '{\n    "numberOfColumns": 3,\n    "numberOfRows": 8,\n    "version": 1\n}\n'
    expect(roundTrip(text)).toBe(text)
  })
})

describe('strictness', () => {
  it('reports comments rather than silently accepting JSONC', () => {
    const { diagnostics } = parseJson('{\n\t// nope\n\t"a": 1\n}')
    expect(diagnostics.some((d) => d.code === 'json/syntax')).toBe(true)
  })

  it('reports trailing commas', () => {
    const { diagnostics } = parseJson('{\n\t"a": 1,\n}')
    expect(diagnostics.some((d) => d.code === 'json/syntax')).toBe(true)
  })

  it('reports a duplicate key without dropping either member', () => {
    const { value, diagnostics } = parseJson('{\n\t"a": 1,\n\t"a": 2\n}')
    expect(diagnostics.some((d) => d.code === 'json/duplicate-key')).toBe(true)
    expect(value.root.kind === 'object' && value.root.members).toHaveLength(2)
  })

  it('does not throw on malformed input', () => {
    expect(() => parseJson('{"a":')).not.toThrow()
    expect(() => parseJson('')).not.toThrow()
  })
})

describe('building', () => {
  it('writes floats with a decimal point and integers without', () => {
    const node = jsonObject([
      ['count', jsonInt(14)],
      ['mean', jsonFloat(119.71428571428571)],
      ['level', jsonFloat(95)],
      ['title', jsonString('Control')],
    ])
    expect(printJsonNode(node, JSON_FORMAT_TAB)).toBe(
      '{\n\t"count": 14,\n\t"mean": 119.71428571428571,\n\t"level": 95.0,\n\t"title": "Control"\n}',
    )
  })

  it('replaces a member in place rather than moving it to the end', () => {
    const { value } = parseJson('{\n\t"a": 1,\n\t"b": 2,\n\t"c": 3\n}')
    const root = value.root
    if (root.kind !== 'object') throw new Error('expected object')
    const next = setMember(root, 'b', jsonInt(99))
    expect(printJsonNode(next, JSON_FORMAT_TAB)).toBe('{\n\t"a": 1,\n\t"b": 99,\n\t"c": 3\n}')
  })
})

describe('accessors', () => {
  it('reads members by key', () => {
    const { value } = parseJson('{"@class":"Document","formatVersion":"1-6-0","n":3}')
    expect(asString(getMember(value.root, '@class'))).toBe('Document')
    expect(asString(getMember(value.root, 'formatVersion'))).toBe('1-6-0')
    expect(asNumber(getMember(value.root, 'n'))).toBe(3)
    expect(getMember(value.root, 'missing')).toBeUndefined()
  })
})
