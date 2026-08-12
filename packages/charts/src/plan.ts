import type { Project, TableView } from '@prismbinder/model'
import { num, readTable, type Series, type TableSeries } from './series.js'
import {
  density,
  describe,
  kaplanMeier,
  type Smoothing,
  type WhiskerRule,
  whiskers,
} from './summary.js'
import type { Axis, Bar, ChartKind, ChartSpec, Mark, Point, SeriesInfo, Wedge } from './types.js'

/**
 * Choosing a chart, and building its marks.
 *
 * **These defaults are ours, not Prism's.** Prism has no silent default to
 * copy: creating a table opens the Change Graph Type dialog and asks. So what
 * follows is a judgement about what is least misleading for each kind of data,
 * and every chart it produces says `reconstructed`.
 *
 * The judgement that matters most is negative. A connecting line asserts that
 * the horizontal axis is ordered. In a column, grouped, contingency or
 * multiple-variables table the rows are separate observations, so 141 of the
 * 256 data sheets in the corpus must not get one.
 */

/** What made a table, when anything did. */
export interface Provenance {
  readonly analysisClass: string
  readonly sheetTitle: string
}

export interface PlanOptions {
  readonly kind?: ChartKind
  /**
   * The analysis that produced this table.
   *
   * Prism writes an analysis results view as an ordinary data sheet whose kind
   * is always `view`, so the same six columns mean different things depending
   * on what wrote them. A SURVIVAL analysis writing "Survival proportions"
   * produced a curve that holds its value between events; drawn as a sloped
   * line it shows a gradual decline that never happened.
   */
  readonly producedBy?: Provenance
  readonly whiskers?: WhiskerRule
  /** What the bars on a mean-and-error chart show. Defaults to the SD. */
  readonly errorBars?: ErrorKind
  readonly smoothing?: Smoothing
  readonly logX?: boolean
  readonly logY?: boolean
  readonly horizontal?: boolean
  /** Interleaved is Prism's own wording for bars side by side within a slot. */
  readonly stacked?: boolean
}

/** The charts that put every repeat on the page rather than summarising them. */
const DRAWS_EVERY_REPLICATE = new Set<ChartKind>(['xy', 'scatter', 'alignedDot'])

/** Whether a table stores several measurements per row. */
function hasReplicates(table: TableView): boolean {
  return (
    (table.dataFormat === 'y_replicates' || table.dataFormat === 'text_replicates') &&
    table.columns.some((c) => c.role === 'y' && c.subcolumns.length > 1)
  )
}

/**
 * What each table kind gets when nobody chooses.
 *
 * `producedBy` is not optional decoration. An analysis results view has table
 * kind `view` whatever it holds, so the layout alone cannot tell a Kaplan-Meier
 * curve from a table of p values: the survival proportions a SURVIVAL analysis
 * writes were defaulting to a scatter plot, which draws the curve as loose dots
 * with no line at all. What wrote a sheet is the only thing that says what its
 * numbers mean.
 */
export function defaultKind(table: TableView, producedBy?: Provenance): ChartKind {
  if (isSurvivalCurve(producedBy)) return 'survival'
  const hasX = table.columns.some((c) => c.role === 'x')
  switch (table.tableFormat) {
    case 'xy':
      // Replicate data summarised, which is what Prism does with it. Drawing
      // every repeat scatters three dots around each point and buries the shape
      // the experiment was run to see; the raw values stay one choice away.
      return hasReplicates(table) ? 'meanError' : 'xy'
    case 'column':
      return 'scatter'
    case 'grouped':
    case 'contingency':
      return 'bar'
    case 'nested':
      return 'scatter'
    case 'partsofwhole':
      return 'pie'
    case 'survival':
      return 'survival'
    case 'multivariable':
      return 'scatter'
    default:
      return hasX ? 'xy' : 'scatter'
  }
}

/** Every style a given table kind can sensibly be shown as. */
export function allowedKinds(table: TableView, producedBy?: Provenance): readonly ChartKind[] {
  // A table with no number in it supports no style at all. The shape rules
  // below only ask what the layout permits, and left alone they offered six
  // ways to plot the forty-three city names in a clustering row table and six
  // more for a results view with no rows, every one of which drew a blank.
  if (!hasPlottableValues(table)) return []

  // Same reason as `defaultKind`: the layout of a results view says `view` or
  // `xy` and neither mentions that the numbers are a survival curve. Without
  // this the staircase was not even on the menu for the sheet that is one.
  if (isSurvivalCurve(producedBy)) return ['survival', 'xy', 'scatter']

  const wide = table.columns.some((c) => c.role === 'y' && c.subcolumns.length > 1)
  switch (table.tableFormat) {
    case 'xy':
      return wide
        ? ['meanError', 'xy', 'scatter', 'box', 'violin', 'bar']
        : ['xy', 'scatter', 'bar']
    case 'column':
    case 'nested':
      return [
        'scatter',
        'alignedDot',
        'beforeAfter',
        'bar',
        'box',
        'violin',
        'floatingBar',
        'symbolAtMean',
      ]
    case 'grouped':
      return ['bar', 'stackedBar', 'scatter', 'box', 'violin', 'alignedDot', 'beforeAfter']
    case 'contingency':
      return ['bar', 'stackedBar']
    case 'partsofwhole':
      return ['pie', 'donut', 'bar', 'scatter']
    case 'survival':
      return ['survival', 'scatter']
    default:
      return ['scatter', 'alignedDot', 'xy', 'bar', 'box', 'violin']
  }
}

/** Whether any Y cell in the table is a number a chart could draw. */
function hasPlottableValues(table: TableView): boolean {
  for (const column of table.columns) {
    if (column.role !== 'y') continue
    for (const sub of column.subcolumns) {
      for (const cell of sub) if (num(cell) !== undefined) return true
    }
  }
  return false
}

export function planChart(table: TableView, title: string, opts: PlanOptions = {}): ChartSpec {
  const read = readTable(table)
  const kind = opts.kind ?? defaultKind(table, opts.producedBy)
  const notes: string[] = []

  if (read.usedRowIndex && kind === 'xy') {
    // The only chart that still puts the row number on the axis. Everything
    // else for such a table now groups by column, where the values belong.
    notes.push(
      'This table has no X column, so the row number stands in for one. The points are not joined: the rows are separate observations, not a sequence.',
    )
  }
  if (read.usedRowIndex && (kind === 'scatter' || kind === 'alignedDot')) {
    notes.push(
      'One column per group, with its values stacked in it. The table has no X column, so there is no order to place them along.',
    )
  }
  // Only for the charts that actually draw them. Saying "every replicate is
  // drawn" under a chart of means is worse than saying nothing.
  if (read.spread === 'replicates' && DRAWS_EVERY_REPLICATE.has(kind)) {
    notes.push(
      'Every replicate is drawn, so one row can contribute several points. Where a line is drawn it follows the mean at each X, not the individual replicates.',
    )
  }
  if (read.spread === 'bounds') {
    notes.push(
      'The bars run between the limits the file stores, which for this layout are absolute values rather than distances from the point.',
    )
  }
  if (table.storage === 'derived') {
    notes.push(
      'This column is labelled %CV, but the number stored beside each value is a standard deviation, which is what the bars show.',
    )
  }
  if (isSurvivalCurve(opts.producedBy)) {
    notes.push(
      `These are the survival proportions the analysis computed, so the line holds its value between events rather than sloping between them. Nothing here was recalculated.`,
    )
  }
  if (table.storage === 'unknown' && read.series.some((s) => s.data.length > 0)) {
    notes.push(
      'The meaning of the extra subcolumns in this table has never been observed, so only the first is plotted.',
    )
  }

  const built = build(kind, read, table, opts)
  const series: readonly SeriesInfo[] =
    built.series ?? read.series.map((s, i) => ({ label: s.label, colorIndex: i }))

  return {
    kind: built.marks.length === 0 ? 'empty' : kind,
    title,
    fidelity: 'reconstructed',
    axisX: built.axisX,
    axisY: built.axisY,
    series,
    marks: built.marks,
    notes: [...notes, ...built.notes],
    horizontal: opts.horizontal === true,
  }
}

interface Built {
  readonly marks: readonly Mark[]
  readonly axisX: Axis
  readonly axisY: Axis
  readonly notes: readonly string[]
  /**
   * Legend entries, where a chart does not colour by column.
   *
   * Almost every style gives one colour to each Y column, so the default legend
   * is the column titles. A before-after plot gives one colour to each *row*
   * instead, and left to the default it produced a legend naming three columns
   * for fifteen differently coloured lines - marks referring to entries that
   * did not exist, and a key that explained the wrong thing.
   */
  readonly series?: readonly SeriesInfo[]
}

function build(kind: ChartKind, read: TableSeries, table: TableView, opts: PlanOptions): Built {
  switch (kind) {
    case 'xy':
    case 'scatter':
      // Without an X column the row number is not an axis, so the values are
      // stacked in their own column's slot instead of being strung out along a
      // sequence the table does not have.
      return read.usedRowIndex && kind === 'scatter'
        ? strip(read, opts, true)
        : points(read, opts, kind === 'xy' && !read.usedRowIndex)
    case 'meanError':
      return meanError(read, opts)
    case 'alignedDot':
      return read.usedRowIndex ? strip(read, opts, false) : points(read, opts, false)
    case 'beforeAfter':
      return beforeAfter(read, opts)
    case 'bar':
    case 'stackedBar':
    case 'groupedBar':
      return bars(read, opts, kind === 'stackedBar' || opts.stacked === true)
    case 'floatingBar':
      return floating(read, opts)
    case 'symbolAtMean':
      return symbolAtMean(read, opts)
    case 'box':
      return boxes(read, opts)
    case 'violin':
      return violins(read, opts)
    case 'pie':
    case 'donut':
      return wedges(read, kind === 'donut')
    case 'survival':
      return survival(read, table, opts)
    default:
      return {
        marks: [],
        axisX: numericAxis('', 0, 1, opts.logX),
        axisY: numericAxis('', 0, 1, opts.logY),
        notes: [],
      }
  }
}

/**
 * Whether a results view holds a survival curve.
 *
 * Keyed on the analysis class, which the file states, and the sheet title,
 * which Prism assigns. A SURVIVAL analysis also produces a "# at risk" sheet
 * and comparison tables, and those are ordinary numbers.
 */
function isSurvivalCurve(producedBy: Provenance | undefined): boolean {
  return (
    producedBy?.analysisClass === 'SURVIVAL' && /survival proportions/i.test(producedBy.sheetTitle)
  )
}

// ---------------------------------------------------------------- point charts

/**
 * One slot per column, every value of that column stacked inside it.
 *
 * This is what a column, grouped or multiple-variables table actually looks
 * like: the rows are separate observations, so there is no horizontal axis to
 * string them along. Prism calls the spread version a scatter dot plot and the
 * unspread one an aligned dot plot; the difference is only whether points that
 * share a value are pushed apart so they can be counted.
 */
function strip(read: TableSeries, opts: PlanOptions, spread: boolean): Built {
  const marks: Mark[] = []
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY

  read.series.forEach((s, i) => {
    if (s.values.length === 0) return
    const centre = i + 0.5
    const pts: Point[] = spread
      ? offsetTies(s.values, centre)
      : s.values.map((y) => ({ x: centre, y }))
    marks.push({ kind: 'points', series: i, points: pts })
    for (const v of s.values) {
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
  })

  return {
    marks,
    axisX: categoryAxis(
      '',
      read.series.map((s) => s.label),
    ),
    axisY: numericAxis(read.yLabel, lo, hi, opts.logY),
    notes: [],
  }
}

export type ErrorKind = 'sd' | 'sem' | 'range'

/** A series regrouped by X, so the repeats at one X can be summarised. */
function groupByX(s: Series): { x: number; values: number[] }[] {
  const out: { x: number; values: number[] }[] = []
  const byX = new Map<number, number[]>()
  for (const d of s.data) {
    const at = byX.get(d.x)
    if (at === undefined) {
      const fresh = [d.y]
      byX.set(d.x, fresh)
      out.push({ x: d.x, values: fresh })
    } else at.push(d.y)
  }
  return out.sort((a, b) => a.x - b.x)
}

const ERROR_LABELS: Record<ErrorKind, string> = {
  sd: 'one standard deviation',
  sem: 'one standard error of the mean',
  range: 'the full range of the repeats',
}

/**
 * One symbol per X at the mean, with a bar showing the spread of the repeats.
 *
 * What Prism draws for replicate data, and the reason it is the default here:
 * three dots scattered around every point hide the curve the experiment was run
 * to see. The repeats are one choice away, under "Points and line".
 *
 * The bar is computed - a standard deviation is a definition, not a model - and
 * the note says which one it is, because SD and SEM differ by a factor of the
 * square root of n and a reader cannot tell them apart by looking.
 */
function meanError(read: TableSeries, opts: PlanOptions): Built {
  const kind = opts.errorBars ?? 'sd'
  const marks: Mark[] = []
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY

  read.series.forEach((s, i) => {
    const centres: Point[] = []
    const bars: { x: number; y: number; up: number; down: number }[] = []

    groupByX(s).forEach(({ x, values }) => {
      const stats = describe(values)
      if (stats === undefined) return
      centres.push({ x, y: stats.mean })
      const spread =
        kind === 'range'
          ? { up: stats.max - stats.mean, down: stats.mean - stats.min }
          : {
              up: kind === 'sem' ? stats.sem : stats.sd,
              down: kind === 'sem' ? stats.sem : stats.sd,
            }
      if (spread.up > 0 || spread.down > 0) bars.push({ x, y: stats.mean, ...spread })
      lo = Math.min(lo, stats.mean - spread.down)
      hi = Math.max(hi, stats.mean + spread.up)
    })

    if (centres.length === 0) return
    if (centres.length >= 2 && !read.usedRowIndex) {
      marks.push({ kind: 'line', series: i, points: centres, step: false })
    }
    if (bars.length > 0) marks.push({ kind: 'errorBars', series: i, bars })
    marks.push({ kind: 'points', series: i, points: centres })
  })

  const xs = read.series.flatMap((s) => s.data.map((d) => d.x))
  return {
    marks,
    axisX: numericAxis(read.xLabel, min(xs), max(xs), opts.logX),
    axisY: numericAxis(read.yLabel, lo, hi, opts.logY),
    notes: [
      `Each symbol is the mean of the repeats at that X; the bars are ${ERROR_LABELS[kind]}, computed here from the values in the table.`,
    ],
  }
}

/**
 * One point per X, at the mean of whatever was measured there.
 *
 * Only the connecting line uses this. The replicates stay on the chart as
 * individual points, because the mean is a summary and the values are the data.
 */
function meanPerX(sorted: readonly Point[]): Point[] {
  const out: Point[] = []
  let i = 0
  while (i < sorted.length) {
    const x = (sorted[i] as Point).x
    let sum = 0
    let n = 0
    while (i < sorted.length && (sorted[i] as Point).x === x) {
      sum += (sorted[i] as Point).y
      i++
      n++
    }
    out.push({ x, y: sum / n })
  }
  return out
}

/** Nothing may leave the slot its category owns; a slot is one unit wide. */
const SLOT_HALF = 0.45
/** The spacing a tie gets when there is room for it. */
const TIE_STEP = 0.06

/**
 * Nudges points that share a value apart, so a stack of ten is not one dot.
 *
 * Deterministic: the offset comes from how many equal values have already been
 * placed, never from a random number, because a chart that moves between two
 * renders of the same file is a chart nobody can check.
 *
 * **Bounded by the slot.** A fixed step per tie is fine for a stack of ten and
 * ruinous for a stack of seventy: the survival table in the corpus has an Event
 * column of 135 zeroes and ones, which at a fixed sixth-of-a-slot spread ran
 * from `0.44` to `6.56` on an axis that ends at `4`. Points landed in other
 * columns and off the chart entirely. The widest tie group is measured first
 * and the step shrunk to fit, so a small stack looks exactly as it did and a
 * large one packs tighter instead of escaping.
 */
function offsetTies(values: readonly number[], centre: number): Point[] {
  const counts = new Map<number, number>()
  for (const y of values) counts.set(y, (counts.get(y) ?? 0) + 1)

  // The last tie placed sits at `ceil((n-1)/2)` steps from the centre.
  let furthest = 0
  for (const n of counts.values()) furthest = Math.max(furthest, Math.ceil((n - 1) / 2))
  const step = furthest === 0 ? TIE_STEP : Math.min(TIE_STEP, SLOT_HALF / furthest)

  const seen = new Map<number, number>()
  const out: Point[] = []
  for (const y of values) {
    const n = seen.get(y) ?? 0
    seen.set(y, n + 1)
    // 0, +1, -1, +2, -2 ...
    out.push({ x: centre + Math.ceil(n / 2) * (n % 2 === 1 ? 1 : -1) * step, y })
  }
  return out
}

/**
 * Paired observations, joined across the columns they were measured in.
 *
 * Each row is one subject, so the line connects that subject's value in every
 * column. A row missing a value in one column is drawn for the columns it has
 * rather than dropped, since the pairing that remains is still real.
 */
function beforeAfter(read: TableSeries, opts: PlanOptions): Built {
  const marks: Mark[] = []
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY

  for (let row = 0; row < read.rowCount; row++) {
    const pts: Point[] = []
    read.series.forEach((s, i) => {
      const v = s.byRow[row]?.[0]
      if (v === undefined) return
      pts.push({ x: i + 0.5, y: v })
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    })
    if (pts.length === 0) continue
    // One series index per row so each subject keeps a colour of its own.
    if (pts.length > 1) marks.push({ kind: 'line', series: row, points: pts, step: false })
    marks.push({ kind: 'points', series: row, points: pts })
  }

  return {
    marks,
    axisX: categoryAxis(
      '',
      read.series.map((s) => s.label),
    ),
    axisY: numericAxis(read.yLabel, lo, hi, opts.logY),
    notes: ['Each line is one row, joined across the columns it was measured in.'],
    // One entry per row, because that is what the colours distinguish here. The
    // marks are indexed by row and rows with nothing to draw are skipped, so
    // the list has to cover every row rather than only the drawn ones.
    series: Array.from({ length: read.rowCount }, (_, row) => ({
      label: read.categories[row] ?? `Row ${row + 1}`,
      colorIndex: row,
    })),
  }
}

function points(read: TableSeries, opts: PlanOptions, connect: boolean): Built {
  const marks: Mark[] = []
  // A survival curve holds its value until the next event. Sloping between the
  // points draws a decline that did not happen.
  const step = isSurvivalCurve(opts.producedBy)
  read.series.forEach((s, i) => {
    const pts: Point[] = s.data.map((d) => ({ x: d.x, y: d.y }))
    if (pts.length === 0) return
    const sorted = [...pts].sort((a, b) => a.x - b.x)
    if (connect) {
      // Through the mean at each X, not through every replicate. A polyline
      // over tied points doubles back vertically at each one, which looks like
      // an error bar, is not one, and ends on whichever replicate the sort
      // happened to leave last.
      const line = meanPerX(sorted)
      if (line.length >= 2) marks.push({ kind: 'line', series: i, points: line, step })
    }
    marks.push({ kind: 'points', series: i, points: sorted })
    const bars = s.data.filter((d) => d.up !== undefined || d.down !== undefined)
    if (bars.length > 0) {
      marks.push({
        kind: 'errorBars',
        series: i,
        bars: bars.map((d) => ({ x: d.x, y: d.y, up: d.up ?? 0, down: d.down ?? 0 })),
      })
    }
  })
  const xs = read.series.flatMap((s) => s.data.map((d) => d.x))
  const ys = read.series.flatMap((s) =>
    s.data.flatMap((d) => [d.y - (d.down ?? 0), d.y + (d.up ?? 0)]),
  )
  return {
    marks,
    axisX: numericAxis(read.xLabel, min(xs), max(xs), opts.logX),
    axisY: numericAxis(read.yLabel, min(ys), max(ys), opts.logY),
    notes: [],
  }
}

// ------------------------------------------------------------------ bar charts

/**
 * One slot per row, the series interleaved inside it - which is Prism's own
 * word for bars placed side by side rather than stacked.
 *
 * A stacked bar sums the series, so it is only offered where the values share a
 * total worth summing; the caller decides, and the sum is asserted in a test.
 */
function bars(read: TableSeries, opts: PlanOptions, stacked: boolean): Built {
  const rows = read.rowCount
  const n = read.series.length
  const marks: Mark[] = []
  const running = new Array<number>(rows).fill(0)
  let lo = 0
  let hi = 0

  read.series.forEach((s, i) => {
    const out: Bar[] = []
    for (let row = 0; row < rows; row++) {
      const values = s.byRow[row] ?? []
      if (values.length === 0) continue
      // A row holding replicates is summarised by its mean; one value is itself.
      const value = values.reduce((a, b) => a + b, 0) / values.length
      if (stacked) {
        const base = running[row] as number
        out.push({ x: row + 0.5, y: base + value, base, width: 0.72 })
        running[row] = base + value
        lo = Math.min(lo, base + value)
        hi = Math.max(hi, base + value)
      } else {
        const width = 0.72 / n
        const centre = row + 0.5 + (i - (n - 1) / 2) * width
        out.push({ x: centre, y: value, base: 0, width: width * 0.9 })
        lo = Math.min(lo, value)
        hi = Math.max(hi, value)
      }
    }
    if (out.length > 0) marks.push({ kind: 'bars', series: i, bars: out })

    if (!stacked) {
      const errors = s.data.filter((d) => d.up !== undefined || d.down !== undefined)
      if (errors.length > 0) {
        const width = 0.72 / n
        marks.push({
          kind: 'errorBars',
          series: i,
          bars: errors.map((d) => ({
            x: d.row + 0.5 + (i - (n - 1) / 2) * width,
            y: d.y,
            up: d.up ?? 0,
            down: d.down ?? 0,
          })),
        })
        for (const d of errors) {
          lo = Math.min(lo, d.y - (d.down ?? 0))
          hi = Math.max(hi, d.y + (d.up ?? 0))
        }
      }
    }
  })

  return {
    marks,
    axisX: categoryAxis(CATEGORY_TITLE, labelsFor(read)),
    axisY: numericAxis(read.yLabel, lo, hi, opts.logY),
    notes: [],
  }
}

/** Min to max as a floating box, with no baseline implied. */
function floating(read: TableSeries, opts: PlanOptions): Built {
  const marks: Mark[] = []
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  read.series.forEach((s, i) => {
    const stats = describe(s.values)
    if (stats === undefined) return
    marks.push({
      kind: 'bars',
      series: i,
      bars: [{ x: i + 0.5, y: stats.max, base: stats.min, width: 0.6 }],
    })
    lo = Math.min(lo, stats.min)
    hi = Math.max(hi, stats.max)
  })
  return {
    marks,
    axisX: categoryAxis(
      CATEGORY_TITLE,
      read.series.map((s) => s.label),
    ),
    axisY: numericAxis(read.yLabel, lo, hi, opts.logY),
    notes: [],
  }
}

function symbolAtMean(read: TableSeries, opts: PlanOptions): Built {
  const marks: Mark[] = []
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  read.series.forEach((s, i) => {
    const stats = describe(s.values)
    if (stats === undefined) return
    marks.push({ kind: 'points', series: i, points: [{ x: i + 0.5, y: stats.mean }] })
    marks.push({
      kind: 'errorBars',
      series: i,
      bars: [{ x: i + 0.5, y: stats.mean, up: stats.sd, down: stats.sd }],
    })
    lo = Math.min(lo, stats.mean - stats.sd)
    hi = Math.max(hi, stats.mean + stats.sd)
  })
  return {
    marks,
    axisX: categoryAxis(
      CATEGORY_TITLE,
      read.series.map((s) => s.label),
    ),
    axisY: numericAxis(read.yLabel, lo, hi, opts.logY),
    notes: ['Symbols are the column mean; bars are one standard deviation.'],
  }
}

// ------------------------------------------------------------ distributions

function boxes(read: TableSeries, opts: PlanOptions): Built {
  const rule = opts.whiskers ?? 'tukey'
  const marks: Mark[] = []
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  const skipped: string[] = []

  read.series.forEach((s, i) => {
    const stats = describe(s.values)
    // Prism requires four values before it will draw a box, and below that the
    // quartiles say more about the rule than about the data.
    if (stats === undefined || stats.n < 4) {
      if (stats !== undefined) skipped.push(s.label)
      return
    }
    const w = whiskers(s.values, rule)
    marks.push({
      kind: 'boxes',
      series: i,
      boxes: [
        {
          x: i + 0.5,
          width: 0.5,
          lowerWhisker: w.lower,
          q1: stats.q1,
          median: stats.median,
          q3: stats.q3,
          upperWhisker: w.upper,
          mean: stats.mean,
          outliers: w.outliers,
        },
      ],
    })
    if (w.allPoints) {
      marks.push({
        kind: 'points',
        series: i,
        points: s.values.map((v) => ({ x: i + 0.5, y: v })),
      })
    }
    lo = Math.min(lo, stats.min)
    hi = Math.max(hi, stats.max)
  })

  const notes = [`Whiskers: ${WHISKER_LABELS[rule]}.`]
  if (skipped.length > 0) {
    notes.push(`Too few values to draw a box for ${skipped.join(', ')}; four are needed.`)
  }
  return {
    marks,
    axisX: categoryAxis(
      CATEGORY_TITLE,
      read.series.map((s) => s.label),
    ),
    axisY: numericAxis(read.yLabel, lo, hi, opts.logY),
    notes,
  }
}

const WHISKER_LABELS: Record<WhiskerRule, string> = {
  minMax: 'minimum to maximum',
  tukey: 'Tukey, 1.5 interquartile ranges or the furthest point inside that',
  p10_90: '10th to 90th percentile',
  p5_95: '5th to 95th percentile',
  p2_5_97_5: '2.5th to 97.5th percentile',
  p1_99: '1st to 99th percentile',
  minMaxAllPoints: 'minimum to maximum, every value also drawn',
}

function violins(read: TableSeries, opts: PlanOptions): Built {
  const smoothing = opts.smoothing ?? 'medium'
  const marks: Mark[] = []
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  read.series.forEach((s, i) => {
    const stats = describe(s.values)
    if (stats === undefined || stats.n < 4) return
    const d = density(s.values, smoothing)
    if (d.length < 2) return
    marks.push({
      kind: 'violins',
      series: i,
      violins: [
        { x: i + 0.5, width: 0.7, density: d, q1: stats.q1, median: stats.median, q3: stats.q3 },
      ],
    })
    lo = Math.min(lo, stats.min)
    hi = Math.max(hi, stats.max)
  })
  return {
    marks,
    axisX: categoryAxis(
      CATEGORY_TITLE,
      read.series.map((s) => s.label),
    ),
    axisY: numericAxis(read.yLabel, lo, hi, opts.logY),
    notes: [
      `Outline smoothing: ${smoothing}. The bandwidth behind it is ours - Prism does not publish its scale - so the shape is a depiction. The quartile lines are computed from the values.`,
    ],
  }
}

// ------------------------------------------------------------- parts of whole

/**
 * Wedges from a single column of values.
 *
 * The question a parts-of-whole table answers is what fraction of the total
 * each value is, so the total is the sum of the column and a negative value
 * has no meaning here; those are dropped and reported.
 */
function wedges(read: TableSeries, donut: boolean): Built {
  const column = read.series[0]
  const empty: Built = {
    marks: [],
    axisX: categoryAxis('', []),
    axisY: numericAxis('', 0, 1, false),
    notes: [],
  }
  if (column === undefined) return empty

  const labels = read.categories
  const values = column.byRow.map((r) => (r.length === 0 ? undefined : (r[0] as number)))
  const usable = values.map((v) => (v === undefined || v <= 0 ? undefined : v))
  const total = usable.reduce<number>((a, v) => a + (v ?? 0), 0)
  if (total <= 0) return empty

  const out: Wedge[] = []
  let cursor = 0
  usable.forEach((v, row) => {
    if (v === undefined) return
    const share = v / total
    out.push({
      label: labels[row] ?? `Row ${row + 1}`,
      value: v,
      start: cursor,
      end: cursor + share,
      series: row,
      explode: 0,
    })
    cursor += share
  })

  const dropped = values.filter((v, i) => v !== undefined && usable[i] === undefined).length
  const notes = [`Wedges are shares of ${total}, the sum of the column.`]
  if (dropped > 0) notes.push(`${dropped} value(s) were zero or negative and have no share.`)
  if (read.series.length > 1) {
    notes.push('Only the first column is shown; a parts-of-whole graph has one total.')
  }

  return {
    marks: [{ kind: 'wedges', wedges: out, holeRadius: donut ? 0.55 : 0 }],
    axisX: categoryAxis('', []),
    axisY: numericAxis('', 0, 1, false),
    notes,
  }
}

// -------------------------------------------------------------------- survival

/**
 * A Kaplan-Meier curve from time and outcome columns.
 *
 * Prism's survival tables put elapsed time in X and a code in each Y column: 1
 * for the event, 0 for an observation that was still alive when watching
 * stopped. Each Y column is a group.
 */
function survival(read: TableSeries, table: TableView, opts: PlanOptions): Built {
  // A results view already holds the proportions. Below, Y is an event code and
  // the estimator turns it into a curve; here Y *is* the curve, and running the
  // estimator over it would read a survival of 1.0 as an event and every other
  // proportion as a censored observation. The project does not recompute what
  // Prism computed, and this is the sheet where getting that wrong would look
  // most convincing.
  //
  // Checked before the time column is, because a stored curve can still be
  // drawn in row order when the view carries no X of its own, whereas an
  // estimator with no times has nothing to work from.
  if (isSurvivalCurve(opts.producedBy)) return storedSurvival(read, opts)

  const x = table.columns.find((c) => c.role === 'x')
  if (x === undefined) {
    return {
      marks: [],
      axisX: numericAxis('Time', 0, 1, false),
      axisY: numericAxis('Survival', 0, 1, false),
      notes: ['A survival curve needs a time column, and this table has none.'],
    }
  }

  const marks: Mark[] = []
  let maxTime = 0
  read.series.forEach((s, i) => {
    const obs = s.data.map((d) => ({ time: d.x, event: d.y === 1 }))
    if (obs.length === 0) return
    const steps = kaplanMeier(obs)
    if (steps.length === 0) return
    const pts: Point[] = [{ x: 0, y: 1 }]
    for (const step of steps) pts.push({ x: step.time, y: step.survival })
    marks.push({ kind: 'line', series: i, points: pts, step: true })
    const censored = steps.filter((st) => st.censored > 0)
    if (censored.length > 0) {
      marks.push({
        kind: 'ticks',
        series: i,
        points: censored.map((st) => ({ x: st.time, y: st.survival })),
      })
    }
    maxTime = Math.max(maxTime, steps[steps.length - 1]?.time ?? 0)
  })

  return {
    marks,
    axisX: numericAxis(read.xLabel === 'Row' ? 'Time' : read.xLabel, 0, maxTime, opts.logX),
    axisY: { ...numericAxis('Fraction surviving', 0, 1, false), tickInterval: 0.25 },
    notes: [
      'Computed from the event codes with the Kaplan-Meier estimator: 1 is the event, 0 is an observation that ended before it. Ticks mark those.',
    ],
  }
}

/**
 * The curve as the analysis stored it, drawn rather than derived.
 *
 * The staircase is the whole point: these proportions hold their value between
 * events, so a sloped line between them shows a gradual decline that did not
 * happen. Where the table carries a confidence interval beside each proportion
 * - the layout is `y_plus_minus`, two independent offsets - it is drawn too,
 * because losing the interval is how a survival curve stops being honest.
 *
 * No censor ticks. Which observations were censored is not in this sheet; the
 * analysis writes it to a separate one, and marking ticks by guessing would put
 * a claim on the chart that nothing in the file supports.
 */
function storedSurvival(read: TableSeries, opts: PlanOptions): Built {
  const marks: Mark[] = []
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  let maxTime = 0

  read.series.forEach((s, i) => {
    if (s.data.length === 0) return
    const pts = s.data.map((d) => ({ x: d.x, y: d.y }))
    marks.push({ kind: 'line', series: i, points: pts, step: true })

    const bars = s.data
      .filter((d) => d.up !== undefined || d.down !== undefined)
      .map((d) => ({ x: d.x, y: d.y, up: d.up ?? 0, down: d.down ?? 0 }))
    if (bars.length > 0) marks.push({ kind: 'errorBars', series: i, bars })

    for (const d of s.data) {
      lo = Math.min(lo, d.y - (d.down ?? 0))
      hi = Math.max(hi, d.y + (d.up ?? 0))
      maxTime = Math.max(maxTime, d.x)
    }
  })

  // Not forced to zero and one: the same view stores a fraction in some files
  // and a percentage in others, and a hard-coded ceiling flattens one of them.
  return {
    marks,
    axisX: numericAxis(read.usedRowIndex ? 'Row' : read.xLabel, 0, maxTime, opts.logX),
    axisY: numericAxis('Fraction surviving', Math.min(0, lo), hi, false),
    // Said plainly rather than papered over. The steps are still in the order
    // the analysis wrote them, so the curve's shape is right and only its
    // spacing along the axis is not.
    notes: read.usedRowIndex
      ? [
          'This results view carries no time column, so the steps are placed in row order rather than along the times they happened at.',
        ]
      : [],
  }
}

// ---------------------------------------------------------------------- axes

function numericAxis(title: string, lo: number, hi: number, log: boolean | undefined): Axis {
  const usable = Number.isFinite(lo) && Number.isFinite(hi)
  return {
    kind: log === true && lo > 0 ? 'log' : 'linear',
    title,
    min: usable ? lo : 0,
    max: usable ? hi : 1,
    categories: [],
    tickInterval: undefined,
    reversed: false,
  }
}

function categoryAxis(title: string, categories: readonly string[]): Axis {
  return {
    kind: 'category',
    title,
    min: 0,
    max: Math.max(categories.length, 1),
    categories,
    tickInterval: undefined,
    reversed: false,
  }
}

/**
 * Category axes carry no title.
 *
 * The slots are columns or rows, so the X column's name - or the placeholder
 * "Row" that stands in when there is no X column - describes something else
 * entirely and reads as a mislabel.
 */
const CATEGORY_TITLE = ''

/** Row titles where the table has them, otherwise the row number. */
function labelsFor(read: TableSeries): string[] {
  const out: string[] = []
  for (let i = 0; i < read.rowCount; i++) {
    const title = read.categories[i]
    out.push(title !== undefined && title !== '' ? title : String(i + 1))
  }
  return out
}

function min(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.min(...values)
}

function max(values: readonly number[]): number {
  return values.length === 0 ? 1 : Math.max(...values)
}

/** Every data sheet in a project, planned with its default chart. */
export function planProject(project: Project, opts: PlanOptions = {}): ChartSpec[] {
  const out: ChartSpec[] = []
  for (const sheet of project.sheets) {
    if (sheet.kind !== 'data') continue
    out.push(planChart(sheet.table, sheet.title, { ...opts, ...provenanceOf(sheet) }))
  }
  return out
}

/** Spread into the options so an explicit caller choice still wins. */
export function provenanceOf(sheet: { producedBy?: Provenance | undefined }): {
  producedBy?: Provenance
} {
  return sheet.producedBy === undefined ? {} : { producedBy: sheet.producedBy }
}

export type { Series, TableSeries }
