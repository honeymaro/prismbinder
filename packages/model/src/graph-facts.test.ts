import type { GraphSheet, PrismBundle } from '@prismbinder/formats'
import { describe, expect, it } from 'vitest'
import { fromBundle } from './adapt.js'

/**
 * Which graph's stated axes a table gets, when more than one graph draws it.
 *
 * A document may draw the same numbers twice and the drawings need not agree:
 * `Geometric mean.pzt` draws one table linearly and again logarithmically, and
 * `Time line.pzt` draws one whole and again zoomed. Taking whichever graph the
 * archive listed first picks an answer by entry order and then tells the reader
 * it was Prism's.
 *
 * The corpus covers the disagreement itself. What it cannot cover is a graph
 * that states nothing - every graph in it either states axes or never reaches
 * this code - so the case where silence meets an opinion is built here. That
 * case is the one a stranger's file produces: a graph whose binary is missing,
 * unreadable, or of a kind this project does not decode.
 */

const AXES_A = [{ dataMin: 0, dataMax: 10, min: 0, max: 12, log: false }] as const
const AXES_B = [{ dataMin: 0, dataMax: 10, min: 0, max: 100, log: true }] as const

function graph(over: Partial<GraphSheet>): GraphSheet {
  return {
    uid: 'g',
    title: 'A graph',
    json: undefined as never,
    hasBinary: true,
    mv: undefined,
    inputDataSets: ['ds1'],
    axes: undefined,
    graphType: undefined,
    ...over,
  }
}

/**
 * One data sheet holding one dataset, plus whatever graphs are given.
 *
 * Everything the adapter does not look at for this question is left empty,
 * which is what keeps the test about the question.
 */
function bundle(graphs: readonly GraphSheet[]): PrismBundle {
  return {
    archive: { entries: [] } as never,
    document: {
      sheetTitles: new Map(),
      order: [],
      version: { formatVersion: '1-6-0', minPrismVersion: '11.0.0' },
    } as never,
    dataSheets: [
      {
        uid: 'sheet1',
        title: 'Data 1',
        json: undefined as never,
        table: {
          uid: 't1',
          format: 'column',
          dataFormat: 'y_single',
          rows: [['1'], ['2'], ['3']],
          declaredRows: 3,
          dataSets: ['ds1'],
          rowTitlesDataSet: undefined,
          xDataSet: undefined,
          subcolumnTitlesDataSet: undefined,
        } as never,
      } as never,
    ],
    dataSets: new Map(),
    analyses: [],
    graphs,
    infoSheets: [],
    layoutSheets: [],
    opaqueEntries: [],
  }
}

const sheetOf = (b: PrismBundle) => {
  const s = fromBundle(b).sheets.find((x) => x.kind === 'data')
  if (s?.kind !== 'data') throw new Error('expected a data sheet')
  return s
}

describe('a table drawn by more than one graph', () => {
  it('uses the stated axes when only one graph has an opinion', () => {
    // Silence is not a second opinion. Treating it as one let a graph with no
    // readable binary throw away a real reading from the graph beside it.
    const s = sheetOf(bundle([graph({ axes: AXES_A, graphType: 3 }), graph({ uid: 'g2' })]))
    expect(s.graphAxes).toEqual(AXES_A)
    expect(s.graphType).toBe(3)
  })

  it('uses them whichever order the graphs are listed in', () => {
    const s = sheetOf(bundle([graph({ uid: 'g2' }), graph({ axes: AXES_A, graphType: 3 })]))
    expect(s.graphAxes).toEqual(AXES_A)
    expect(s.graphType).toBe(3)
  })

  it('uses neither when two graphs draw it differently', () => {
    const s = sheetOf(
      bundle([
        graph({ axes: AXES_A, graphType: 3 }),
        graph({ uid: 'g2', axes: AXES_B, graphType: 3 }),
      ]),
    )
    expect(s.graphAxes).toBeUndefined()
    expect(s.graphType).toBeUndefined()
  })

  it('uses neither when two graphs disagree on the kind alone', () => {
    const s = sheetOf(
      bundle([
        graph({ axes: AXES_A, graphType: 3 }),
        graph({ uid: 'g2', axes: AXES_A, graphType: 4 }),
      ]),
    )
    expect(s.graphAxes).toBeUndefined()
    expect(s.graphType).toBeUndefined()
  })

  it('says so on the document rather than leaving the reader to wonder', () => {
    const p = fromBundle(
      bundle([
        graph({ axes: AXES_A, graphType: 3 }),
        graph({ uid: 'g2', axes: AXES_B, graphType: 3 }),
      ]),
    )
    expect(p.notes.join(' ')).toMatch(/more than one graph and those graphs disagree/)
  })

  it('stays contested once contested, whatever a third graph says', () => {
    const s = sheetOf(
      bundle([
        graph({ axes: AXES_A, graphType: 3 }),
        graph({ uid: 'g2', axes: AXES_B, graphType: 3 }),
        graph({ uid: 'g3', axes: AXES_A, graphType: 3 }),
      ]),
    )
    expect(s.graphAxes).toBeUndefined()
  })
})
