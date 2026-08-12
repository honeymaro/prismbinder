import type { GraphSheetView, Project } from '@prismbinder/model'
import { describe, expect, it } from 'vitest'
import { type Linkage, type MvContext, mvContext, planMvGraph } from './mv.js'
import type { Mark } from './types.js'

/**
 * The one family that is read rather than reconstructed.
 *
 * Two things have to hold or the distinction is worse than not having it: a
 * chart built from the graph sheet must say `read`, and a graph sheet we cannot
 * fully honour must produce nothing rather than a plausible guess wearing the
 * same label.
 */

function graph(over: Partial<GraphSheetView>): GraphSheetView {
  return {
    kind: 'graph',
    id: 'g1',
    title: 'A graph',
    opaque: false,
    mv: undefined,
    ...over,
  }
}

const LINKS: Linkage[] = [
  {
    node1: { id: 1, label: 'a' },
    node2: { id: 2, label: 'b' },
    distance: 0.5,
    cluster: { id: 10, label: 'C1' },
  },
  {
    node1: { id: 3, label: 'c' },
    node2: { id: 10, label: 'C1' },
    distance: 1.5,
    cluster: { id: 11, label: 'C2' },
  },
]

const ctx: MvContext = { tables: new Map(), linkage: () => LINKS }

const marksOf = <K extends Mark['kind']>(spec: { marks: readonly Mark[] }, kind: K) =>
  spec.marks.filter((m): m is Extract<Mark, { kind: K }> => m.kind === kind)

describe('a graph that is not a Multiple Variables graph', () => {
  it('produces nothing at all', () => {
    // Its JSON holds a uid, a title and a list of inputs. There is no chart to
    // read, and inventing one here would be tier 2 wearing a tier 1 label.
    expect(planMvGraph(graph({ opaque: true }), ctx)).toBeUndefined()
  })
})

describe('dendrogram', () => {
  const sheet = graph({
    title: 'Dendrogram',
    mv: {
      dataSheet: undefined,
      figures: [
        {
          kind: 'dendrogram',
          colorScheme: '29',
          branchesLink: '/rows/dendrogram',
          clustersLink: '/rows/clusters',
        },
      ],
      axisY: { min: 0, max: 2.5, interval: 0.5 },
    },
  })

  it('draws one join per stored link, at the stored height', () => {
    const spec = planMvGraph(sheet, ctx)
    if (spec === undefined) throw new Error('expected a spec')
    const links = marksOf(spec, 'dendrogram')[0]?.links ?? []
    expect(links).toHaveLength(2)
    expect(links.map((l) => l.height)).toEqual([0.5, 1.5])
    // The second join is a leaf against the cluster the first one made, so it
    // rises from that cluster's height rather than from the axis floor.
    expect(links[1]?.childHeight1).toBe(0)
    expect(links[1]?.childHeight2).toBe(0.5)
  })

  it('takes its axis limits from the file, not from the data', () => {
    const spec = planMvGraph(sheet, ctx)
    // The tallest join is 1.5; the file says the axis runs to 2.5.
    expect(spec?.axisY.min).toBe(0)
    expect(spec?.axisY.max).toBe(2.5)
    expect(spec?.axisY.tickInterval).toBe(0.5)
  })

  it('places every leaf once, in the order the joins introduce them', () => {
    const spec = planMvGraph(sheet, ctx)
    expect(spec?.axisX.categories).toEqual(['a', 'b', 'c'])
    expect(marksOf(spec as { marks: readonly Mark[] }, 'dendrogram')[0]?.leaves).toBe(3)
  })

  it('is labelled as read, and says nothing was re-clustered', () => {
    const spec = planMvGraph(sheet, ctx)
    expect(spec?.fidelity).toBe('read')
    expect(spec?.notes.join(' ')).toMatch(/Nothing was re-clustered/)
  })

  it('refuses when the branches it points at are not there', () => {
    const missing: MvContext = { tables: new Map(), linkage: () => undefined }
    const spec = planMvGraph(sheet, missing)
    expect(spec?.marks).toHaveLength(0)
    expect(spec?.notes.join(' ')).toMatch(/not in any analysis result/)
  })
})

describe('resolving the link into the analysis results', () => {
  /** The node shape the JSON reader produces. */
  const scalar = (value: unknown) => ({ kind: 'scalar', value })
  const object = (members: Record<string, unknown>) => ({
    kind: 'object',
    members: Object.entries(members).map(([key, value]) => ({ key, value })),
  })
  const array = (items: unknown[]) => ({ kind: 'array', items })

  const linkNode = object({
    node1: object({ id: scalar(1), label: scalar('a') }),
    node2: object({ id: scalar(2), label: scalar('b') }),
    distance: scalar(0.25),
    cluster: object({ id: scalar(9), label: scalar('C1') }),
  })

  function project(results: unknown): Project {
    return {
      source: 'bundle',
      title: undefined,
      formatVersion: undefined,
      minPrismVersion: undefined,
      notes: [],
      sheets: [
        {
          kind: 'analysis',
          id: 'a1',
          title: 'Clustering',
          analysisClass: 'HIERARCHICAL_CLUSTERING',
          hasResults: true,
          results: results as never,
        },
      ],
    }
  }

  it('reads a pointer relative to content, which is where Prism means it', () => {
    // `/rows/dendrogram` resolves against `content.rows.dendrogram`, not
    // against the top of the file - a convention read off one document.
    const results = object({
      $id: scalar('x'),
      content: object({ rows: object({ dendrogram: array([linkNode]) }) }),
    })
    const found = mvContext(project(results)).linkage('/rows/dendrogram')
    expect(found).toHaveLength(1)
    expect(found?.[0]?.distance).toBe(0.25)
    expect(found?.[0]?.node1.label).toBe('a')
  })

  it('also accepts a pointer that is already absolute', () => {
    const results = object({ rows: object({ dendrogram: array([linkNode]) }) })
    expect(mvContext(project(results)).linkage('/rows/dendrogram')).toHaveLength(1)
  })

  it('returns nothing rather than half a tree when the shape is wrong', () => {
    const results = object({
      content: object({ rows: object({ dendrogram: array([scalar(1)]) }) }),
    })
    expect(mvContext(project(results)).linkage('/rows/dendrogram')).toBeUndefined()
    expect(mvContext(project(results)).linkage('/nowhere')).toBeUndefined()
  })
})

describe('heat map', () => {
  it('refuses when the data sheet it names is missing', () => {
    const sheet = graph({
      mv: {
        dataSheet: 'gone',
        figures: [
          {
            kind: 'heatmap',
            colorScheme: 'Viridis',
            branchesLink: undefined,
            clustersLink: undefined,
          },
        ],
        axisY: undefined,
      },
    })
    const spec = planMvGraph(sheet, ctx)
    expect(spec?.marks).toHaveLength(0)
    expect(spec?.notes.join(' ')).toMatch(/data sheet this heat map draws from/)
  })

  it('says the colour scheme is a stand-in rather than implying a match', () => {
    const table = {
      rowCount: 2,
      rowTitles: ['r1', 'r2'],
      tableFormat: 'multivariable',
      dataFormat: 'y_single',
      storage: 'direct' as const,
      columns: [
        {
          id: 'A',
          title: 'A',
          role: 'y' as const,
          subcolumns: [['1', '2']],
          marks: [{ excluded: new Set<number>(), censored: new Set<number>() }],
          generated: false,
        },
      ],
    }
    const withTable: MvContext = {
      tables: new Map([['d1', { title: 'Data', table }]]),
      linkage: () => undefined,
    }
    const spec = planMvGraph(
      graph({
        mv: {
          dataSheet: 'd1',
          figures: [
            {
              kind: 'heatmap',
              colorScheme: 'Viridis',
              branchesLink: undefined,
              clustersLink: undefined,
            },
          ],
          axisY: undefined,
        },
      }),
      withTable,
    )
    expect(spec?.fidelity).toBe('read')
    expect(marksOf(spec as { marks: readonly Mark[] }, 'heatmap')[0]?.cells).toHaveLength(2)
    expect(spec?.notes.join(' ')).toMatch(/Viridis/)
    expect(spec?.notes.join(' ')).toMatch(/stand-in/)
  })
})
