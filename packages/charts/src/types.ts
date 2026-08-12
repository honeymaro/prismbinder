/**
 * The vocabulary a chart is described in, before anything is drawn.
 *
 * Three ideas keep this layer honest.
 *
 * **Marks carry data coordinates, never pixels.** Scaling happens once, in the
 * renderer, so every assertion a test wants to make - this bar reaches the
 * column total, this whisker does not cross its hinge - is about numbers from
 * the file rather than about geometry.
 *
 * **A chart says how much it knows.** `fidelity: 'read'` means the file told us
 * what to draw; `'reconstructed'` means we chose. Most of Prism's graphs are a
 * binary we do not decode, so the second is the common case and has to be
 * visible wherever a chart appears.
 *
 * **Nothing here imports a framework or a platform.** The same module renders
 * in a browser tab and in the CLI.
 */

export interface Point {
  readonly x: number
  readonly y: number
}

export interface ErrorBar {
  readonly x: number
  readonly y: number
  /** Distances from the point, never absolute bounds; the caller converts. */
  readonly up: number
  readonly down: number
}

export interface Bar {
  readonly x: number
  /** Top of the bar. May be below `base` for a negative value. */
  readonly y: number
  readonly base: number
  /** Full width in data units, centred on `x`. */
  readonly width: number
}

/** The five numbers, plus whatever the whisker rule left outside them. */
export interface Box {
  readonly x: number
  readonly width: number
  readonly lowerWhisker: number
  readonly q1: number
  readonly median: number
  readonly q3: number
  readonly upperWhisker: number
  readonly mean: number | undefined
  /** Values beyond the whiskers, which every rule except min-to-max produces. */
  readonly outliers: readonly number[]
}

export interface Violin {
  readonly x: number
  readonly width: number
  /** Half-widths as a fraction of `width`, sampled from low to high. */
  readonly density: readonly { readonly value: number; readonly halfWidth: number }[]
  readonly q1: number
  readonly median: number
  readonly q3: number
}

export interface Wedge {
  readonly label: string
  readonly value: number
  /** Turns, clockwise from twelve o'clock. */
  readonly start: number
  readonly end: number
  readonly series: number
  /** Distance to push the wedge out, as a fraction of the radius. */
  readonly explode: number
}

export interface Cell {
  readonly row: number
  readonly column: number
  readonly value: number | undefined
}

/** One join in a dendrogram, in the coordinates the tree is drawn in. */
export interface Link {
  readonly x1: number
  readonly x2: number
  readonly height: number
  readonly childHeight1: number
  readonly childHeight2: number
  readonly label: string | undefined
}

export type Mark =
  | { readonly kind: 'points'; readonly series: number; readonly points: readonly Point[] }
  | {
      readonly kind: 'line'
      readonly series: number
      readonly points: readonly Point[]
      /** A survival curve holds its value until the next event. */
      readonly step: boolean
    }
  | { readonly kind: 'errorBars'; readonly series: number; readonly bars: readonly ErrorBar[] }
  | { readonly kind: 'bars'; readonly series: number; readonly bars: readonly Bar[] }
  | { readonly kind: 'boxes'; readonly series: number; readonly boxes: readonly Box[] }
  | { readonly kind: 'violins'; readonly series: number; readonly violins: readonly Violin[] }
  | { readonly kind: 'wedges'; readonly wedges: readonly Wedge[]; readonly holeRadius: number }
  | {
      readonly kind: 'heatmap'
      readonly cells: readonly Cell[]
      readonly rows: number
      readonly columns: number
      readonly rowLabels: readonly string[]
      readonly columnLabels: readonly string[]
    }
  | { readonly kind: 'dendrogram'; readonly links: readonly Link[]; readonly leaves: number }
  | { readonly kind: 'hull'; readonly series: number; readonly points: readonly Point[] }
  | {
      readonly kind: 'ellipse'
      readonly series: number
      readonly cx: number
      readonly cy: number
      readonly rx: number
      readonly ry: number
      /** Radians, counterclockwise, in data space. */
      readonly rotation: number
    }
  /** A tick at a censored observation on a survival curve. */
  | { readonly kind: 'ticks'; readonly series: number; readonly points: readonly Point[] }

export type ScaleKind = 'linear' | 'log' | 'category'

export interface Axis {
  readonly kind: ScaleKind
  readonly title: string
  /** Data-space bounds. For a category axis these are indices. */
  readonly min: number
  readonly max: number
  /** One per category, in order. Empty for a numeric axis. */
  readonly categories: readonly string[]
  /** Set only where the file told us; otherwise the renderer picks. */
  readonly tickInterval: number | undefined
  readonly reversed: boolean
}

export interface SeriesInfo {
  readonly label: string
  /** Index into the palette, so a caller can restyle without re-deriving. */
  readonly colorIndex: number
}

export type ChartKind =
  | 'xy'
  | 'meanError'
  | 'scatter'
  | 'alignedDot'
  | 'bar'
  | 'stackedBar'
  | 'groupedBar'
  | 'box'
  | 'violin'
  | 'floatingBar'
  | 'beforeAfter'
  | 'symbolAtMean'
  | 'pie'
  | 'donut'
  | 'survival'
  | 'heatmap'
  | 'dendrogram'
  | 'bubble'
  | 'empty'

/**
 * Whether the file told us what to draw.
 *
 * `read` is reachable only for Multiple Variables graphs, whose settings Prism
 * writes as JSON. Everything else is our choice about how to show the numbers
 * and must say so.
 */
export type Fidelity = 'read' | 'reconstructed'

export interface ChartSpec {
  readonly kind: ChartKind
  readonly title: string
  readonly fidelity: Fidelity
  readonly axisX: Axis
  readonly axisY: Axis
  readonly series: readonly SeriesInfo[]
  readonly marks: readonly Mark[]
  /** Things a viewer has to be told, in the order they should be shown. */
  readonly notes: readonly string[]
  /** Horizontal bar charts swap the axes at render time. */
  readonly horizontal: boolean
}

/** A framework-free element, rendered to SVG text or to React nodes. */
export interface El {
  readonly tag: string
  readonly attrs: Readonly<Record<string, string | number>>
  readonly children: readonly (El | string)[]
}

export function el(
  tag: string,
  attrs: Readonly<Record<string, string | number>> = {},
  children: readonly (El | string)[] = [],
): El {
  return { tag, attrs, children }
}
