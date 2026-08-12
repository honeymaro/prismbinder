import type { TableView } from '@prismbinder/model'
import { describe, expect, it } from 'vitest'
import { planChart, provenanceOf } from './plan.js'
import type { Mark } from './types.js'

/**
 * What a results view is, which its own table cannot say.
 *
 * Prism writes analysis output as an ordinary data sheet, and every one of them
 * has `tableFormat: 'view'`. The same six columns are a survival curve if a
 * SURVIVAL analysis wrote them and an ordinary table otherwise, so the chart
 * has to be chosen from what produced the sheet rather than from its shape.
 */

const column = (title: string, cells: string[], role: 'x' | 'y' = 'y') => ({
  id: title,
  title,
  role,
  subcolumns: [cells],
  marks: [{ excluded: new Set<number>(), censored: new Set<number>() }],
  generated: false,
})

const proportions: TableView = {
  rowCount: 4,
  rowTitles: [],
  tableFormat: 'view',
  dataFormat: 'y_single',
  storage: 'direct',
  columns: [
    column('Days elapsed', ['0', '10', '25', '45'], 'x'),
    column('Control', ['100', '90', '78', '65']),
  ],
}

const line = (marks: readonly Mark[]) =>
  marks.find((m): m is Extract<Mark, { kind: 'line' }> => m.kind === 'line')

describe('a survival proportions view', () => {
  it('holds its value between events rather than sloping', () => {
    const spec = planChart(proportions, 'Survival proportions', {
      producedBy: { analysisClass: 'SURVIVAL', sheetTitle: 'Survival proportions' },
    })
    expect(line(spec.marks)?.step).toBe(true)
    expect(spec.notes.join(' ')).toMatch(/holds its value between events/)
    expect(spec.notes.join(' ')).toMatch(/Nothing here was recalculated/)
  })

  it('is an ordinary line when nothing says what produced it', () => {
    // The table alone cannot tell. Guessing from the shape of the numbers -
    // monotone, starting at 100 - would step tables that are not curves.
    expect(line(planChart(proportions, 'T').marks)?.step).toBe(false)
  })

  it('does not step the other sheets the same analysis produced', () => {
    // A SURVIVAL analysis also writes "# at risk" and comparison tables, and
    // those are counts and statistics rather than a curve.
    for (const sheetTitle of ['# at risk', 'Curve comparison', 'Data summary']) {
      const spec = planChart(proportions, sheetTitle, {
        producedBy: { analysisClass: 'SURVIVAL', sheetTitle },
      })
      expect(line(spec.marks)?.step, sheetTitle).toBe(false)
    }
  })

  it('does not step a proportions sheet from a different analysis', () => {
    const spec = planChart(proportions, 'T', {
      producedBy: { analysisClass: 'COLUMN_STATISTICS', sheetTitle: 'Survival proportions' },
    })
    expect(line(spec.marks)?.step).toBe(false)
  })
})

describe('provenanceOf', () => {
  it('omits the key entirely when a sheet has no analysis behind it', () => {
    // Spread into the options, so an explicit `undefined` would override a
    // caller's own choice rather than leaving it alone.
    expect(provenanceOf({ producedBy: undefined })).toEqual({})
    expect(Object.hasOwn(provenanceOf({ producedBy: undefined }), 'producedBy')).toBe(false)
  })

  it('passes it through when there is one', () => {
    const p = { analysisClass: 'SURVIVAL', sheetTitle: 'Survival proportions' }
    expect(provenanceOf({ producedBy: p })).toEqual({ producedBy: p })
  })
})
