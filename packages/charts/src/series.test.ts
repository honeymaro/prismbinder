import type { ColumnView, TableView } from '@prismbinder/model'
import { describe, expect, it } from 'vitest'
import { readTable, spreadOf } from './series.js'

/**
 * What the extra subcolumns hold, which every chart above this depends on.
 *
 * These assertions moved here from the editor when the drawing left it. Three
 * of them describe defects that shipped: a value with absolute limits of 70 and
 * 110 was drawn as a bar from 30 to 210, a table of three replicates showed one
 * of them, and a replicate count was read as a bound.
 */

function column(title: string, subcolumns: string[][], role: 'x' | 'y' = 'y'): ColumnView {
  return {
    id: title,
    title,
    role,
    subcolumns,
    marks: subcolumns.map(() => ({ excluded: new Set<number>(), censored: new Set<number>() })),
    generated: false,
  }
}

function table(over: Partial<TableView> & Pick<TableView, 'dataFormat' | 'storage'>): TableView {
  return { rowCount: 1, rowTitles: [], columns: [], tableFormat: 'xy', ...over }
}

const x = column('Dose', [['1']], 'x')

describe('what the extra subcolumns mean', () => {
  it('is read from storage, not from the layout name', () => {
    // `y_high_low` is what both layouts are called once they reach the bundle
    // vocabulary, so the name cannot tell them apart.
    expect(spreadOf(table({ dataFormat: 'y_high_low', storage: 'offsets' }))).toBe('offsets')
    expect(spreadOf(table({ dataFormat: 'y_high_low', storage: 'bounds' }))).toBe('bounds')
  })

  it('treats a stored SD as symmetric, including where the column says %CV', () => {
    for (const f of ['y_sd', 'y_se', 'y_sd_n', 'y_se_n']) {
      expect(spreadOf(table({ dataFormat: f, storage: 'direct' })), f).toBe('symmetric')
    }
    expect(spreadOf(table({ dataFormat: 'y_cv', storage: 'derived' }))).toBe('symmetric')
  })

  it('draws nothing extra for a layout it has not verified', () => {
    expect(spreadOf(table({ dataFormat: 'y_mystery', storage: 'unknown' }))).toBe('none')
  })
})

describe('error bar arithmetic', () => {
  const first = (t: TableView) => readTable(t).series[0]?.data[0]

  it('turns absolute limits into distances from the point', () => {
    const d = first(
      table({
        dataFormat: 'y_high_low',
        storage: 'bounds',
        columns: [x, column('A', [['100'], ['110'], ['70']])],
      }),
    )
    expect(d?.y).toBe(100)
    expect(d?.up).toBe(10)
    expect(d?.down).toBe(30)
  })

  it('keeps offsets as offsets', () => {
    const d = first(
      table({
        dataFormat: 'y_high_low',
        storage: 'offsets',
        columns: [x, column('A', [['100'], ['10'], ['30']])],
      }),
    )
    expect(d?.up).toBe(10)
    expect(d?.down).toBe(30)
  })

  it('refuses limits that do not bracket the value', () => {
    const d = first(
      table({
        dataFormat: 'y_high_low',
        storage: 'bounds',
        columns: [x, column('A', [['100'], ['70'], ['110']])],
      }),
    )
    expect(d?.up).toBeUndefined()
    expect(d?.down).toBeUndefined()
  })

  it('does not mistake a replicate count for a bound', () => {
    const d = first(
      table({
        dataFormat: 'y_sd_n',
        storage: 'direct',
        columns: [x, column('A', [['100'], ['10'], ['3']])],
      }),
    )
    expect(d?.up).toBe(10)
    expect(d?.down).toBe(10)
  })
})

describe('replicates', () => {
  it('are all read, not just the first', () => {
    const read = readTable(
      table({
        dataFormat: 'y_replicates',
        storage: 'direct',
        columns: [x, column('A', [['10'], ['20'], ['30']])],
      }),
    )
    expect(read.spread).toBe('replicates')
    expect(read.series[0]?.data.map((d) => d.y)).toEqual([10, 20, 30])
    expect(new Set(read.series[0]?.data.map((d) => d.x))).toEqual(new Set([1]))
    // A summary chart wants the row grouped; a point chart wants them flat.
    expect(read.series[0]?.byRow[0]).toEqual([10, 20, 30])
  })

  it('carry no error bars of their own', () => {
    const read = readTable(
      table({
        dataFormat: 'y_replicates',
        storage: 'direct',
        columns: [x, column('A', [['10'], ['20']])],
      }),
    )
    for (const d of read.series[0]?.data ?? []) {
      expect(d.up).toBeUndefined()
      expect(d.down).toBeUndefined()
    }
  })
})

describe('the horizontal axis', () => {
  it('uses the X column when there is one', () => {
    const read = readTable(
      table({ dataFormat: 'y_single', storage: 'direct', columns: [x, column('A', [['5']])] }),
    )
    expect(read.usedRowIndex).toBe(false)
    expect(read.xLabel).toBe('Dose')
  })

  it('falls back to the row number and flags that it did', () => {
    const read = readTable(
      table({
        dataFormat: 'y_single',
        storage: 'direct',
        tableFormat: 'column',
        rowCount: 3,
        columns: [column('A', [['5', '7', '6']])],
      }),
    )
    expect(read.usedRowIndex).toBe(true)
    expect(read.series[0]?.data.map((d) => d.x)).toEqual([1, 2, 3])
  })

  it('keeps a row with no value as an empty slot rather than shifting the rest', () => {
    // A bar chart puts one slot per row, so losing a blank row would move every
    // later bar under the wrong label.
    const read = readTable(
      table({
        dataFormat: 'y_single',
        storage: 'direct',
        tableFormat: 'column',
        rowCount: 3,
        columns: [column('A', [['5', '', '6']])],
      }),
    )
    expect(read.series[0]?.byRow).toEqual([[5], [], [6]])
    expect(read.series[0]?.data.map((d) => d.row)).toEqual([0, 2])
  })
})
