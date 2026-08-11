import { crc32, deflateRaw, writeZip, type ZipEntry } from '@prismbinder/core'
import { describe, expect, it } from 'vitest'
import { readProject } from './adapt.js'
import { marksFor } from './types.js'

/**
 * Small files that ask for a lot of work.
 *
 * The ZIP layer already refuses decompression bombs, and none of these are
 * one: every entry here is a few hundred bytes and inflates to a few hundred
 * bytes. The amplification is a plain integer in a JSON file, which is exactly
 * the shape the existing defences do not cover.
 *
 * Both cases below were live. `numberOfRows: 20000000` in a 1.3 KB archive
 * exhausted the heap, and five thousand copies of one full-width cell range in
 * a 2.7 KB archive burned ninety seconds of CPU. The library's main consumer is
 * a browser page that opens whatever it is handed.
 */

const T = 'AAAAAAAA-0000-4000-8000-000000000001'
const S = 'AAAAAAAA-0000-4000-8000-000000000002'
const X = 'AAAAAAAA-0000-4000-8000-000000000003'
const Y = 'AAAAAAAA-0000-4000-8000-000000000004'

function bundle(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder()
  const entries: ZipEntry[] = Object.entries(files).map(([name, text]) => {
    const body = enc.encode(text)
    const stored = deflateRaw(body)
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
        crc32: crc32(body),
        compressedSize: stored.length,
        uncompressedSize: body.length,
        internalAttrs: 0,
        externalAttrs: 0,
        diskStart: 0,
        extraCentral: new Uint8Array(0),
        extraLocal: new Uint8Array(0),
        comment: new Uint8Array(0),
      },
    }
  })
  return writeZip({ entries, comment: new Uint8Array(0) })
}

const document = JSON.stringify({
  '@class': 'Document',
  formatVersion: '1-6-0',
  minFormatVersion: '1-0-0',
  minPrismVersion: '10',
  sheets: { data: [S] },
  sheetAttributesMap: { [S]: { title: 'T' } },
})

/** A table claiming a great many rows while storing none. */
function inflatedRowCount(rows: number, extra: Record<string, string> = {}): Uint8Array {
  return bundle({
    'document.json': document,
    [`data/sheets/${S}/sheet.json`]: JSON.stringify({
      '@class': 'DataSheet',
      uid: S,
      title: 'T',
      table: {
        '@class': 'XYDataTable',
        uid: T,
        format: 'xy',
        dataFormat: 'y_single',
        xDataSet: X,
        dataSets: [],
      },
    }),
    [`data/sets/${X}.json`]: JSON.stringify({
      '@class': 'DataSet',
      uid: X,
      format: 'series',
      title: 'X',
      replicates: [{ '@class': 'SeriesReplicate', startValue: 0, interval: 1 }],
    }),
    [`data/tables/${T}/content.json`]: JSON.stringify({
      numberOfRows: rows,
      numberOfColumns: 1,
    }),
    [`data/tables/${T}/data.csv`]: '',
    ...extra,
  })
}

describe('a claimed size is not a real one', () => {
  it('does not size a generated X column from an unvalidated row count', () => {
    const bytes = inflatedRowCount(20_000_000)
    expect(bytes.length, 'the archive itself stays tiny').toBeLessThan(4096)

    const started = Date.now()
    const { value } = readProject(bytes, 'hostile.prism')
    expect(Date.now() - started, 'must not attempt twenty million rows').toBeLessThan(2000)

    const sheet = value?.sheets.find((s) => s.kind === 'data')
    if (sheet?.kind !== 'data') throw new Error('expected a data sheet')
    // The CSV holds no rows, so neither does the view. Prism would show none
    // either: the values are generated per stored row, not per claimed row.
    expect(sheet.table.rowCount).toBe(0)
    for (const c of sheet.table.columns) {
      for (const sub of c.subcolumns) expect(sub.length).toBe(0)
    }
  })

  it('still says the two row counts disagree', () => {
    // Ignoring the claim is not the same as not noticing it.
    const { diagnostics } = readProject(inflatedRowCount(20_000_000), 'hostile.prism')
    expect(diagnostics.map((d) => d.code)).toContain('bundle/row-count-mismatch')
  })

  it('bounds the work one subcolumn of cell ranges can ask for', () => {
    // Five thousand copies of the same full-width range. Deduplicated by the
    // set either way; the cost is in expanding them.
    //
    // The cell values are all different on purpose: a column of one repeated
    // number compresses about 1000:1 and the ZIP reader rejects it as a bomb
    // before any of this is reached, which is the existing guard doing its job
    // and not the one under test here.
    const rows = 50_000
    const csv = `${Array.from({ length: rows }, (_, i) => (i * 1.6180339887).toFixed(6)).join('\n')}\n`
    const bytes = bundle({
      'document.json': document,
      [`data/sheets/${S}/sheet.json`]: JSON.stringify({
        '@class': 'DataSheet',
        uid: S,
        title: 'T',
        table: {
          '@class': 'DataTable',
          uid: T,
          format: 'column',
          dataFormat: 'y_single',
          dataSets: [Y],
        },
      }),
      [`data/sets/${Y}.json`]: JSON.stringify({
        '@class': 'DataSet',
        uid: Y,
        format: 'y_single',
        title: 'A',
        replicates: [
          {
            '@class': 'DriverReplicate',
            cellAttributes: Array.from({ length: 5000 }, () => ({
              rows: `0~${rows - 1}`,
              attributes: ['EXCLUDED'],
            })),
          },
        ],
      }),
      [`data/tables/${T}/content.json`]: JSON.stringify({
        numberOfRows: rows,
        numberOfColumns: 1,
      }),
      [`data/tables/${T}/data.csv`]: csv,
    })

    const started = Date.now()
    const { value } = readProject(bytes, 'hostile.prism')
    expect(Date.now() - started, 'five hundred million expansions took 92 s').toBeLessThan(10_000)

    const sheet = value?.sheets.find((s) => s.kind === 'data')
    if (sheet?.kind !== 'data') throw new Error('expected a data sheet')
    const column = sheet.table.columns[0]
    if (column === undefined) throw new Error('expected a column')
    // The first range alone covers the table, so the honest answer is unchanged
    // by the cap: every row is excluded.
    expect(marksFor(column, 0).excluded.size).toBe(rows)
  })
})

describe('malformed cell ranges', () => {
  const withRange = (rows: unknown) =>
    bundle({
      'document.json': document,
      [`data/sheets/${S}/sheet.json`]: JSON.stringify({
        '@class': 'DataSheet',
        uid: S,
        title: 'T',
        table: {
          '@class': 'DataTable',
          uid: T,
          format: 'column',
          dataFormat: 'y_single',
          dataSets: [Y],
        },
      }),
      [`data/sets/${Y}.json`]: JSON.stringify({
        '@class': 'DataSet',
        uid: Y,
        format: 'y_single',
        title: 'A',
        replicates: [
          { '@class': 'DriverReplicate', cellAttributes: [{ rows, attributes: ['EXCLUDED'] }] },
        ],
      }),
      [`data/tables/${T}/content.json`]: JSON.stringify({
        numberOfRows: 3,
        numberOfColumns: 1,
      }),
      [`data/tables/${T}/data.csv`]: '1\n2\n3\n',
    })

  function excludedRows(rows: unknown): number[] {
    const { value } = readProject(withRange(rows), 'x.prism')
    const sheet = value?.sheets.find((s) => s.kind === 'data')
    if (sheet?.kind !== 'data') throw new Error('expected a data sheet')
    const column = sheet.table.columns[0]
    if (column === undefined) throw new Error('expected a column')
    return [...marksFor(column, 0).excluded]
  }

  it('reads the two forms Prism writes', () => {
    expect(excludedRows('1')).toEqual([1])
    expect(excludedRows('0~1')).toEqual([0, 1])
  })

  it('does not read an empty or half-written range as row 0', () => {
    // `Number("")` is 0, so coercing rather than matching turned a truncated
    // field into a confident claim about the first row.
    for (const bad of ['', '~5', '0~', ' 1 ', '1~2~3', '0x2', '1e0']) {
      expect(excludedRows(bad), JSON.stringify(bad)).toEqual([])
    }
  })

  it('says so rather than dropping the mark in silence', () => {
    // An ignored exclusion turns a value Prism never uses into ordinary data.
    const { diagnostics } = readProject(withRange('~5'), 'x.prism')
    expect(diagnostics.map((d) => d.code)).toContain('bundle/unreadable-cell-range')
  })
})

describe('a series that cannot be rebuilt', () => {
  it('warns instead of inventing values', () => {
    const bytes = bundle({
      'document.json': document,
      [`data/sheets/${S}/sheet.json`]: JSON.stringify({
        '@class': 'DataSheet',
        uid: S,
        title: 'T',
        table: {
          '@class': 'XYDataTable',
          uid: T,
          format: 'xy',
          dataFormat: 'y_single',
          xDataSet: X,
          dataSets: [],
        },
      }),
      // Declares itself generated, records nothing to generate from.
      [`data/sets/${X}.json`]: JSON.stringify({
        '@class': 'DataSet',
        uid: X,
        format: 'series',
        title: 'X',
        replicates: [{ '@class': 'SeriesReplicate' }],
      }),
      [`data/tables/${T}/content.json`]: JSON.stringify({
        numberOfRows: 0,
        numberOfColumns: 0,
      }),
      [`data/tables/${T}/data.csv`]: '',
    })
    const { value, diagnostics } = readProject(bytes, 'x.prism')
    expect(diagnostics.map((d) => d.code)).toContain('bundle/series-without-parameters')
    const sheet = value?.sheets.find((s) => s.kind === 'data')
    if (sheet?.kind !== 'data') throw new Error('expected a data sheet')
    expect(sheet.table.columns.filter((c) => c.role === 'x')).toEqual([])
  })
})
