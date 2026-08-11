import { describe, expect, it } from 'vitest'
import { cellAsNumber, cellAt, columnCount, parseCsv, printCsv } from './csv.js'

const roundTrip = (t: string): string => printCsv(parseCsv(t))

describe('parsing', () => {
  it('reads a plain table', () => {
    const { rows } = parseCsv(',1,3\n,2,4\n')
    expect(rows).toEqual([
      ['', '1', '3'],
      ['', '2', '4'],
    ])
  })

  it('reads quoted fields containing commas', () => {
    const { rows } = parseCsv('"Cairo, Egypt",31.23,30.05\n')
    expect(rows).toEqual([['Cairo, Egypt', '31.23', '30.05']])
  })

  it('reads doubled quotes and embedded newlines', () => {
    // Not present in the corpus, but a user can type either into a cell.
    const { rows } = parseCsv('"say ""hi""","two\nlines"\n')
    expect(rows).toEqual([['say "hi"', 'two\nlines']])
  })

  it('keeps trailing empty fields', () => {
    expect(parseCsv('a,,\n').rows).toEqual([['a', '', '']])
  })

  it('does not invent a row from the final newline', () => {
    expect(parseCsv('a\n').rows).toHaveLength(1)
    expect(parseCsv('a\nb\n').rows).toHaveLength(2)
  })

  it('treats an empty file as an empty table', () => {
    expect(parseCsv('').rows).toEqual([])
  })

  it('preserves ragged rows rather than padding them', () => {
    const t = parseCsv('a,b,c\nd\n')
    expect(t.rows).toEqual([['a', 'b', 'c'], ['d']])
    expect(columnCount(t)).toBe(3)
    expect(cellAt(t, 1, 2)).toBe('')
  })
})

describe('printing', () => {
  it('quotes only when a field needs it', () => {
    // Minimal quoting: the corpus never quotes a field that does not contain
    // a comma, and re-quoting everything would change every file we touch.
    expect(printCsv({ rows: [['a', 'b,c', 'd']] })).toBe('a,"b,c",d\n')
    expect(printCsv({ rows: [['plain', '1.5', '']] })).toBe('plain,1.5,\n')
  })

  it('escapes quotes by doubling', () => {
    expect(printCsv({ rows: [['say "hi"']] })).toBe('"say ""hi"""\n')
  })

  it('always terminates the last row', () => {
    expect(printCsv({ rows: [['a']] })).toBe('a\n')
  })
})

describe('round trip', () => {
  it('reproduces a plain table', () => {
    const t = ',1,3\n,2,4\n,4,7\n'
    expect(roundTrip(t)).toBe(t)
  })

  it('reproduces quoted fields exactly as written', () => {
    const t = '"Cairo, Egypt",31.2300000000000004,30.0500000000000007,Cluster 3\n'
    expect(roundTrip(t)).toBe(t)
  })

  it('reproduces the empty file', () => {
    expect(roundTrip('')).toBe('')
  })

  it('reproduces analysis result tables with labels and blanks', () => {
    const t =
      'Number of values,14,14\n,,\nGeometric mean,35.55,52.00\nGeometric SD factor,6.798,6.249\n'
    expect(roundTrip(t)).toBe(t)
  })
})

describe('numeric text is not normalised', () => {
  it('keeps the %.18g spelling that a JS number would destroy', () => {
    // Two thirds of the corpus's numeric cells look like this. Storing them as
    // numbers would silently rewrite them on the next save.
    const t = ',2.35671923073764633,2.000,177.0,0.683066367709062039\n'
    expect(roundTrip(t)).toBe(t)

    const shortened = parseCsv(t).rows[0]!.map((c) => (c === '' ? '' : String(Number(c))))
    expect(shortened).toEqual(['', '2.3567192307376463', '2', '177', '0.683066367709062'])
  })

  it('offers a number view without changing what is stored', () => {
    expect(cellAsNumber('2.000')).toBe(2)
    expect(cellAsNumber('')).toBeUndefined()
    expect(cellAsNumber('Cluster 3')).toBeUndefined()
  })
})

describe('unicode', () => {
  it('round-trips non-ASCII cell text', () => {
    const t = '\u0130stanbul,\u03B7,\u00B2,\u0160,\u00ED,\u00E1\n'
    expect(roundTrip(t)).toBe(t)
  })
})
