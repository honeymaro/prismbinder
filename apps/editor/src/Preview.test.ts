import type { ColumnView, TableView } from '@prismbinder/model'
import { describe, expect, it } from 'vitest'
import { build, spreadOf } from './Preview.js'

/**
 * What the reconstructed plot claims about the numbers.
 *
 * This is the last place a misread becomes a picture, and a picture is what a
 * person will believe. Three of the cases below were wrong: a value with
 * absolute limits of 70 and 110 was drawn as a bar from 30 to 210, a table of
 * three replicates showed only the first, and rows that are separate
 * observations were joined into a trend.
 */

function column(title: string, subcolumns: string[][]): ColumnView {
  return {
    id: title,
    title,
    role: 'y',
    subcolumns,
    marks: subcolumns.map(() => ({ excluded: new Set<number>(), censored: new Set<number>() })),
    generated: false,
  }
}

function table(over: Partial<TableView> & Pick<TableView, 'dataFormat' | 'storage'>): TableView {
  return {
    rowCount: 1,
    rowTitles: [],
    columns: [],
    tableFormat: 'xy',
    ...over,
  }
}

const xColumn: ColumnView = {
  id: 'x',
  title: 'Dose',
  role: 'x',
  subcolumns: [['1']],
  marks: [{ excluded: new Set<number>(), censored: new Set<number>() }],
  generated: false,
}

describe('what the extra subcolumns mean', () => {
  it('reads the meaning from storage, not from the layout name', () => {
    // `y_high_low` is what both layouts are called once they reach the bundle
    // vocabulary, so the name cannot tell them apart and `storage` must.
    expect(spreadOf(table({ dataFormat: 'y_high_low', storage: 'offsets' }))).toBe('offsets')
    expect(spreadOf(table({ dataFormat: 'y_high_low', storage: 'bounds' }))).toBe('bounds')
  })

  it('treats a stored SD as symmetric, including where the column says %CV', () => {
    for (const f of ['y_sd', 'y_se', 'y_sd_n', 'y_se_n']) {
      expect(spreadOf(table({ dataFormat: f, storage: 'direct' })), f).toBe('symmetric')
    }
    // Every dataset inside a y_cv table declares its own format as y_sd.
    expect(spreadOf(table({ dataFormat: 'y_cv', storage: 'derived' }))).toBe('symmetric')
  })

  it('draws nothing extra for a layout it has not verified', () => {
    expect(spreadOf(table({ dataFormat: 'y_mystery', storage: 'unknown' }))).toBe('none')
  })
})

describe('the bars that get drawn', () => {
  const at = (t: TableView) => build(t).series[0]?.points[0]

  it('turns absolute limits into distances from the point', () => {
    // Stored 100 with limits 110 and 70. Read as offsets this becomes a bar
    // from 30 to 210 - three times too long, and centred wrong.
    const p = at(
      table({
        dataFormat: 'y_high_low',
        storage: 'bounds',
        columns: [xColumn, column('A', [['100'], ['110'], ['70']])],
      }),
    )
    expect(p?.y).toBe(100)
    expect(p?.up).toBe(10)
    expect(p?.down).toBe(30)
  })

  it('keeps offsets as offsets', () => {
    const p = at(
      table({
        dataFormat: 'y_high_low',
        storage: 'offsets',
        columns: [xColumn, column('A', [['100'], ['10'], ['30']])],
      }),
    )
    expect(p?.up).toBe(10)
    expect(p?.down).toBe(30)
  })

  it('refuses limits that do not bracket the value', () => {
    // Rather than mirroring them into something plausible-looking.
    const p = at(
      table({
        dataFormat: 'y_high_low',
        storage: 'bounds',
        columns: [xColumn, column('A', [['100'], ['70'], ['110']])],
      }),
    )
    expect(p?.up).toBeUndefined()
    expect(p?.down).toBeUndefined()
  })

  it('does not mistake a replicate count for a bound', () => {
    // y_sd_n stores mean, SD, n. The third subcolumn is a count.
    const p = at(
      table({
        dataFormat: 'y_sd_n',
        storage: 'direct',
        columns: [xColumn, column('A', [['100'], ['10'], ['3']])],
      }),
    )
    expect(p?.up).toBe(10)
    expect(p?.down).toBe(10)
  })
})

describe('replicates', () => {
  it('plots every one of them, not just the first', () => {
    const { series, spread } = build(
      table({
        dataFormat: 'y_replicates',
        storage: 'direct',
        columns: [xColumn, column('A', [['10'], ['20'], ['30']])],
      }),
    )
    expect(spread).toBe('replicates')
    // Three measurements at one X, which is what the table holds.
    expect(series[0]?.points.map((p) => p.y)).toEqual([10, 20, 30])
    expect(new Set(series[0]?.points.map((p) => p.x))).toEqual(new Set([1]))
  })

  it('does not draw error bars around them', () => {
    const { series } = build(
      table({
        dataFormat: 'y_replicates',
        storage: 'direct',
        columns: [xColumn, column('A', [['10'], ['20']])],
      }),
    )
    for (const p of series[0]?.points ?? []) {
      expect(p.up).toBeUndefined()
      expect(p.down).toBeUndefined()
    }
  })
})

describe('the horizontal axis', () => {
  it('uses the X column when there is one', () => {
    const { usedRowIndex, xLabel } = build(
      table({
        dataFormat: 'y_single',
        storage: 'direct',
        columns: [xColumn, column('A', [['5']])],
      }),
    )
    expect(usedRowIndex).toBe(false)
    expect(xLabel).toBe('Dose')
  })

  it('falls back to the row number, and says so', () => {
    // A column table's rows are separate observations. The caller uses this
    // flag to suppress the connecting line, because joining them would draw a
    // trend across things that have no order.
    const { usedRowIndex, series } = build(
      table({
        dataFormat: 'y_single',
        storage: 'direct',
        tableFormat: 'column',
        columns: [column('A', [['5', '7', '6']])],
      }),
    )
    expect(usedRowIndex).toBe(true)
    expect(series[0]?.points.map((p) => p.x)).toEqual([1, 2, 3])
  })
})
