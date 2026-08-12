import type { GraphSheetView, Project, TableView } from '@prismbinder/model'
import { num } from './series.js'
import type { Axis, ChartSpec, Link, Mark, SeriesInfo } from './types.js'

/**
 * The one graph family the file actually describes.
 *
 * Every other Prism graph keeps its geometry in a PCFF blob and can only be
 * reconstructed - guessed at, honestly and with a badge. A Multiple Variables
 * graph writes its figures, axis limits and colour scheme as JSON, and points
 * at the analysis result holding a dendrogram's branches. What comes out of
 * here is therefore `fidelity: 'read'`, and the distinction has to survive all
 * the way to the screen or the badge on everything else stops meaning anything.
 *
 * The bound on the claim: all seven MV graphs in the corpus are analysis output
 * - heat maps, dendrograms, clustered-data views, PC scores - so a
 * user-authored MV scatter or bubble plot has never been seen. Figures we do
 * not recognise are reported rather than drawn.
 */

/** A dendrogram join, as Prism stores it. */
export interface Linkage {
  readonly node1: { readonly id: number; readonly label: string }
  readonly node2: { readonly id: number; readonly label: string }
  readonly distance: number
  readonly cluster: { readonly id: number; readonly label: string }
}

export interface MvContext {
  /** Data sheets by uid, for the table a figure draws from. */
  readonly tables: ReadonlyMap<string, { title: string; table: TableView }>
  /** Resolves a link such as `/rows/dendrogram` to a stored linkage list. */
  readonly linkage: (pointer: string) => readonly Linkage[] | undefined
}

export function mvContext(project: Project): MvContext {
  const tables = new Map<string, { title: string; table: TableView }>()
  for (const s of project.sheets) {
    if (s.kind === 'data') tables.set(s.id, { title: s.title, table: s.table })
  }

  const results = project.sheets.filter((s) => s.kind === 'analysis').map((s) => s.results)

  return {
    tables,
    linkage: (pointer) => {
      // The link names a path inside an analysis result, and a document has
      // few analyses, so the one holding that path is the one meant.
      //
      // The pointer is relative to `content`, not to the top of the file:
      // `/rows/dendrogram` resolves against `content.rows.dendrogram`. Both are
      // tried, because that is a convention read off one document rather than
      // a rule anyone wrote down.
      for (const root of results) {
        for (const base of [member(root, 'content'), root]) {
          const list = asLinkage(resolvePointer(base, pointer))
          if (list !== undefined) return list
        }
      }
      return undefined
    },
  }
}

/** A JSON pointer, over the lossless node tree the reader produces. */
function resolvePointer(root: unknown, pointer: string): unknown {
  let node: unknown = root
  for (const raw of pointer.split('/')) {
    if (raw === '') continue
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    node = member(node, key)
    if (node === undefined) return undefined
  }
  return node
}

function member(node: unknown, key: string): unknown {
  if (node === null || typeof node !== 'object') return undefined
  const n = node as {
    kind?: string
    members?: { key: string; value: unknown }[]
    items?: unknown[]
  }
  if (n.kind === 'object') return n.members?.find((m) => m.key === key)?.value
  if (n.kind === 'array') {
    const i = Number(key)
    return Number.isInteger(i) ? n.items?.[i] : undefined
  }
  return undefined
}

function scalar(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return undefined
  const n = node as { kind?: string; value?: unknown }
  return n.kind === 'scalar' ? n.value : undefined
}

function asLinkage(node: unknown): readonly Linkage[] | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const n = node as { kind?: string; items?: unknown[] }
  if (n.kind !== 'array' || n.items === undefined || n.items.length === 0) return undefined
  const out: Linkage[] = []
  for (const item of n.items) {
    const distance = scalar(member(item, 'distance'))
    if (typeof distance !== 'number') return undefined
    out.push({
      node1: nodeRef(member(item, 'node1')),
      node2: nodeRef(member(item, 'node2')),
      distance,
      cluster: nodeRef(member(item, 'cluster')),
    })
  }
  return out
}

function nodeRef(node: unknown): { id: number; label: string } {
  const id = scalar(member(node, 'id'))
  const label = scalar(member(node, 'label'))
  return {
    id: typeof id === 'number' ? id : -1,
    label: typeof label === 'string' ? label : '',
  }
}

/**
 * Plans the chart a Multiple Variables graph sheet describes.
 *
 * Returns `undefined` when the sheet is not one - which is every other family,
 * whose JSON holds a uid, a title and a list of inputs and nothing else.
 */
export function planMvGraph(graph: GraphSheetView, ctx: MvContext): ChartSpec | undefined {
  const mv = graph.mv
  if (mv === undefined) return undefined

  const notes: string[] = []
  const kinds = mv.figures.map((f) => f.kind)

  const dendrogram = mv.figures.find((f) => f.kind === 'dendrogram')
  if (dendrogram !== undefined && dendrogram.branchesLink !== undefined) {
    const links = ctx.linkage(dendrogram.branchesLink)
    if (links === undefined) {
      return refusal(
        graph,
        `the branches this graph points at (${dendrogram.branchesLink}) are not in any analysis result in this document`,
      )
    }
    return dendrogramSpec(graph, links, mv.axisY, notes)
  }

  const heatmap = mv.figures.find((f) => f.kind === 'heatmap')
  if (heatmap !== undefined) {
    const source = mv.dataSheet === undefined ? undefined : ctx.tables.get(mv.dataSheet)
    if (source === undefined) {
      return refusal(graph, 'the data sheet this heat map draws from is not in this document')
    }
    return heatmapSpec(graph, source.table, heatmap.colorScheme, notes)
  }

  // Symbols and confidence ellipses are the remaining figure kinds in the
  // corpus. They are plotted from the data sheet like any scatter, so the
  // ordinary planner handles them better than a half-read one would.
  return refusal(
    graph,
    `this graph draws ${kinds.join(' and ')}, which is read from its data sheet rather than from the graph`,
  )
}

function refusal(graph: GraphSheetView, why: string): ChartSpec {
  return {
    kind: 'empty',
    title: graph.title,
    fidelity: 'read',
    axisX: blankAxis(),
    axisY: blankAxis(),
    series: [],
    marks: [],
    notes: [why],
    horizontal: false,
  }
}

/**
 * A dendrogram, drawn from the linkage list Prism computed.
 *
 * Nothing is clustered here. The joins, their heights and their labels are all
 * read; the only arithmetic is placing each leaf along the axis, which is what
 * turns a list of joins into a picture.
 */
function dendrogramSpec(
  graph: GraphSheetView,
  links: readonly Linkage[],
  axisY:
    | { min: number | undefined; max: number | undefined; interval: number | undefined }
    | undefined,
  notes: string[],
): ChartSpec {
  // Each join creates a cluster with a new id; a leaf is anything never
  // created that way. Positions are assigned by walking the joins in order.
  const position = new Map<number, number>()
  const height = new Map<number, number>()
  const created = new Set(links.map((l) => l.cluster.id))
  const leaves: { id: number; label: string }[] = []
  for (const l of links) {
    for (const n of [l.node1, l.node2]) {
      if (!created.has(n.id) && !position.has(n.id)) {
        position.set(n.id, leaves.length + 0.5)
        leaves.push({ id: n.id, label: n.label })
      }
    }
  }

  const out: Link[] = []
  for (const l of links) {
    const x1 = position.get(l.node1.id)
    const x2 = position.get(l.node2.id)
    if (x1 === undefined || x2 === undefined) continue
    out.push({
      x1,
      x2,
      height: l.distance,
      childHeight1: height.get(l.node1.id) ?? 0,
      childHeight2: height.get(l.node2.id) ?? 0,
      label: l.cluster.label === '' ? undefined : l.cluster.label,
    })
    position.set(l.cluster.id, (x1 + x2) / 2)
    height.set(l.cluster.id, l.distance)
  }

  const tallest = Math.max(...links.map((l) => l.distance), 0)
  return {
    kind: 'dendrogram',
    title: graph.title,
    fidelity: 'read',
    axisX: {
      kind: 'category',
      title: '',
      min: 0,
      max: Math.max(leaves.length, 1),
      categories: leaves.map((l) => l.label),
      tickInterval: undefined,
      reversed: false,
    },
    axisY: {
      kind: 'linear',
      title: 'Distance',
      // The axis limits come from the file where it states them.
      min: axisY?.min ?? 0,
      max: axisY?.max ?? tallest,
      categories: [],
      tickInterval: axisY?.interval,
      reversed: false,
    },
    series: [],
    marks: [{ kind: 'dendrogram', links: out, leaves: leaves.length }],
    notes: [
      ...notes,
      'The branches, their heights and their labels are read from the clustering result Prism stored. Nothing was re-clustered.',
    ],
    horizontal: false,
  }
}

function heatmapSpec(
  graph: GraphSheetView,
  table: TableView,
  colorScheme: string | undefined,
  notes: string[],
): ChartSpec {
  const columns = table.columns.filter((c) => c.role === 'y')
  const cells: { row: number; column: number; value: number | undefined }[] = []
  for (let row = 0; row < table.rowCount; row++) {
    columns.forEach((c, i) => {
      cells.push({ row, column: i, value: num(c.subcolumns[0]?.[row]) })
    })
  }

  const scheme = colorScheme ?? 'unnamed'
  return {
    kind: 'heatmap',
    title: graph.title,
    fidelity: 'read',
    axisX: {
      kind: 'category',
      title: '',
      min: 0,
      max: Math.max(columns.length, 1),
      categories: columns.map((c) => c.title),
      tickInterval: undefined,
      reversed: false,
    },
    axisY: {
      kind: 'category',
      title: '',
      min: 0,
      max: Math.max(table.rowCount, 1),
      categories: [...table.rowTitles],
      tickInterval: undefined,
      reversed: false,
    },
    series: [],
    marks: [
      {
        kind: 'heatmap',
        cells,
        rows: table.rowCount,
        columns: columns.length,
        rowLabels: [...table.rowTitles],
        columnLabels: columns.map((c) => c.title),
      },
    ],
    notes: [
      ...notes,
      // The file names the scheme; matching its exact stops would need a
      // rendered graph to sample, which we do not have.
      `The file asks for the ${scheme} colour scheme. The ramp drawn here is a grayscale stand-in, so read the shape and not the hue.`,
    ],
    horizontal: false,
  }
}

function blankAxis(): Axis {
  return {
    kind: 'linear',
    title: '',
    min: 0,
    max: 1,
    categories: [],
    tickInterval: undefined,
    reversed: false,
  }
}

export type { Mark, SeriesInfo }
