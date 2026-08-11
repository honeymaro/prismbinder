import { describe, expect, it } from 'vitest'
import { columnLayout } from './columns.js'
import { createBundle } from './create.js'
import { applyCellEdits } from './edit.js'
import { readBundle } from './read.js'

const IDS = () => {
  let n = 0
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}

function bundle(opts: Parameters<typeof createBundle>[0]) {
  const { value } = readBundle(
    createBundle({
      ...opts,
      creationDate: '2026-01-01T00:00:00Z',
      newId: IDS(),
      newToken: () => 'a'.repeat(32),
    }),
  )
  if (value === undefined) throw new Error('could not read our own bundle')
  return value
}

describe('an edit that does not apply', () => {
  it('leaves the archive completely alone', () => {
    const b = bundle({ tables: [{ title: 'T', columns: [{ title: 'A', cells: ['1', '2'] }] }] })
    const sheetId = b.dataSheets[0]?.uid as string

    const { updates, diagnostics } = applyCellEdits(b, [
      { sheetId, row: 99, column: 0, value: 'x' },
    ])

    // A rejected edit used to still mint a revision token and rewrite
    // document.json, so the saved file looked modified with nothing changed.
    expect(diagnostics.map((d) => d.code)).toEqual(['edit/row-out-of-range'])
    expect([...updates.keys()]).toEqual([])
  })

  it('still records the edits that did apply, in the same call', () => {
    const b = bundle({ tables: [{ title: 'T', columns: [{ title: 'A', cells: ['1', '2'] }] }] })
    const sheetId = b.dataSheets[0]?.uid as string

    const { updates, diagnostics } = applyCellEdits(b, [
      { sheetId, row: 99, column: 0, value: 'x' },
      { sheetId, row: 0, column: 0, value: '42' },
    ])
    expect(diagnostics.map((d) => d.code)).toEqual(['edit/row-out-of-range'])
    expect([...updates.keys()].some((n) => n.endsWith('data.csv'))).toBe(true)
    expect(updates.has('document.json')).toBe(true)
  })
})

describe('derived statistics cover every dataset role', () => {
  it('recomputes the row-titles dataset when a row label is edited', () => {
    const b = bundle({
      tables: [
        {
          title: 'T',
          rowTitles: ['first', 'second', 'third'],
          columns: [{ title: 'A', cells: ['1', '2', '3'] }],
        },
      ],
    })
    const sheetId = b.dataSheets[0]?.uid as string
    const rowTitlesUid = b.dataSheets[0]?.table?.rowTitlesDataSet as string

    // Column 0 is the row-title column, which used to be outside the
    // recompute loop entirely: only `table.dataSets` was walked.
    const { updates } = applyCellEdits(b, [{ sheetId, row: 2, column: 0, value: '' }])
    expect([...updates.keys()]).toContain(`data/sets/${rowTitlesUid}.json`)
  })

  it('recomputes the X dataset when an X value is edited', () => {
    const b = bundle({
      tables: [
        {
          title: 'T',
          xColumn: { title: 'Dose', cells: ['1', '2', '3'] },
          columns: [{ title: 'A', cells: ['1', '2', '3'] }],
        },
      ],
    })
    const sheetId = b.dataSheets[0]?.uid as string
    const xUid = b.dataSheets[0]?.table?.xDataSet as string

    const { updates } = applyCellEdits(b, [{ sheetId, row: 0, column: 0, value: '9' }])
    expect([...updates.keys()]).toContain(`data/sets/${xUid}.json`)
  })
})

describe('column layout when the X dataset cannot be resolved', () => {
  it('keeps the X column rather than assuming the rarest case', () => {
    const table = {
      dataFormat: 'y_single',
      replicatesCount: undefined,
      rowTitlesDataSet: undefined,
      xDataSet: 'missing-uid',
      dataSets: ['a', 'b'],
    }
    // `series` is 2 datasets out of roughly 500. Treating "we could not look it
    // up" as "it must be the rare one" shifts every Y column left by one - on
    // the write path as well as the read path.
    expect(columnLayout(table, 'number').dataSetStarts).toEqual([1, 2])
    expect(columnLayout(table, undefined).dataSetStarts).toEqual([1, 2])
    expect(columnLayout(table, 'series').dataSetStarts).toEqual([0, 1])
  })

  it('says so, rather than guessing silently', () => {
    const b = bundle({
      tables: [
        {
          title: 'T',
          xColumn: { title: 'Dose', cells: ['1', '2'] },
          columns: [{ title: 'A', cells: ['1', '2'] }],
        },
      ],
    })
    const sheetId = b.dataSheets[0]?.uid as string
    const broken = { ...b, dataSets: new Map() }

    const { diagnostics } = applyCellEdits(broken, [{ sheetId, row: 0, column: 1, value: '5' }])
    expect(diagnostics.map((d) => d.code)).toContain('edit/x-dataset-unresolved')
  })
})

describe('createBundle records each column against its own data', () => {
  it('writes a per-column row span, not the table height', () => {
    const b = bundle({
      tables: [
        {
          title: 'T',
          columns: [
            { title: 'A', cells: ['1', '2', '3'] },
            { title: 'B', cells: ['', '', '', '4', '5'] },
          ],
        },
      ],
    })

    const spans = [...b.dataSets.values()].map((ds) => {
      const reps =
        ds.json.root.kind === 'object'
          ? ds.json.root.members.find((m) => m.key === 'replicates')?.value
          : undefined
      const first = reps?.kind === 'array' ? reps.items[0] : undefined
      const get = (k: string) => {
        const m =
          first?.kind === 'object' ? first.members.find((x) => x.key === k)?.value : undefined
        return m?.kind === 'scalar' ? m.raw : undefined
      }
      return `${get('firstRow')}..${get('lastRow')}`
    })

    // `edit.ts` computes this same field as the column's own non-blank span,
    // so a table-wide value here would change on the first edit that touched
    // nothing.
    expect(spans).toEqual(['0..2', '3..4'])
  })
})
