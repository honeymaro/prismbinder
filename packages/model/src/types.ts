import type { JsonNode } from '@prismbinder/core'
import type { StorageSemantics } from '@prismbinder/formats'

/**
 * A format-neutral view of a Prism document.
 *
 * Deliberately thin. Its job is to let one grid, one exporter and one viewer
 * serve both the ZIP bundle and the XML document - not to be a lossless
 * representation of either. Round-tripping a file always goes back through the
 * codec it came from, never through here, because an abstraction that tried to
 * hold everything would end up holding it slightly wrong.
 *
 * Two properties survive from the underlying formats because ignoring them
 * loses data:
 *
 *  - **Cells are strings.** Prism writes `%.18g`, and two thirds of its numeric
 *    cells change if you route them through a JS number.
 *  - **Tables are ragged.** Subcolumns within one table can have different
 *    lengths - 29 of 124 XML tables do - so this models columns of cells rather
 *    than a rectangle of rows.
 */

export type SourceFormat = 'bundle' | 'pzfx'

export interface Project {
  readonly source: SourceFormat
  readonly title: string | undefined
  readonly formatVersion: string | undefined
  readonly minPrismVersion: string | undefined
  readonly sheets: readonly Sheet[]
  /** Things the source held that this view does not represent. */
  readonly notes: readonly string[]
}

export type Sheet = DataSheetView | AnalysisSheetView | GraphSheetView | InfoSheetView

export interface DataSheetView {
  readonly kind: 'data'
  readonly id: string
  readonly title: string
  readonly table: TableView
  /**
   * The axes of the graph Prism drew from this sheet, when there is one.
   *
   * A chart of this table can then use the range and scale Prism chose instead
   * of bounds derived from the numbers, which is the difference between a
   * picture of the same data and a picture of the same graph.
   */
  readonly graphAxes?: readonly GraphAxis[]
  /**
   * The kind of graph Prism drew from this sheet, as the file numbers them.
   *
   * A number, not a name: the enumeration is only partly known. See
   * `pcffGraphType` in `@prismbinder/formats` for which values have been
   * observed and on what evidence.
   */
  readonly graphType?: number
  /**
   * The analysis that produced this sheet, when one did.
   *
   * A results view is a table of numbers until you know what made it. The same
   * six columns are a survival curve if a SURVIVAL analysis wrote them and an
   * ordinary table if nothing did, and only a curve may be drawn as a
   * staircase.
   */
  readonly producedBy: { readonly analysisClass: string; readonly sheetTitle: string } | undefined
}

export interface AnalysisSheetView {
  readonly kind: 'analysis'
  readonly id: string
  readonly title: string
  readonly analysisClass: string | undefined
  /** Results are read and shown, never recomputed. */
  readonly hasResults: boolean
  /**
   * The stored results, as a tree that keeps each number's source text.
   *
   * Prism records these at full double precision while the rendered result
   * sheet shows them rounded for display, so this is the copy worth reading if
   * you intend to do anything further with the numbers.
   */
  readonly results: JsonNode | undefined
}

/**
 * A Multiple Variables graph, as far as this view carries it.
 *
 * The one graph family whose appearance the file states rather than hides. See
 * `docs/charts.md`: a `FENGraphSheet` keeps 250 bytes of JSON with no axis or
 * symbol setting in it at all, while an `MVGraph` keeps 11 to 15 KB naming its
 * figures, axis limits and colour scheme.
 */
export interface MvGraphView {
  readonly dataSheet: string | undefined
  readonly figures: readonly {
    readonly kind: string
    readonly colorScheme: string | undefined
    readonly branchesLink: string | undefined
    readonly clustersLink: string | undefined
  }[]
  readonly axisY:
    | {
        readonly min: number | undefined
        readonly max: number | undefined
        readonly interval: number | undefined
      }
    | undefined
}

export interface GraphSheetView {
  readonly kind: 'graph'
  readonly id: string
  readonly title: string
  /**
   * True when the geometry is a PCFF blob we carry but do not interpret.
   *
   * Not simply "a `data.bin` exists": four of the seven MV graphs in the corpus
   * carry a binary that is not PCFF and describe themselves fully in JSON, so
   * calling those opaque would be wrong in the one place it matters.
   */
  readonly opaque: boolean
  readonly mv: MvGraphView | undefined
  /**
   * The axes stated in the graph binary, when it states them.
   *
   * The blob stays opaque as a whole; this is the one part of it that is
   * framed, checkable and worth reading. See `@prismbinder/formats` for the
   * chunk layout and for why the order of the three is not assumed.
   */
  readonly axes?: readonly GraphAxis[]
  /** The kind of graph, as the file numbers them. See `pcffGraphType`. */
  readonly graphType?: number
  /**
   * The datasets this graph plots, by uid.
   *
   * What turns a graph sheet from a name into something drawable: it says which
   * table's numbers belong on those axes.
   */
  readonly inputDataSets: readonly string[]
}

/** One axis, as Prism drew it. */
export interface GraphAxis {
  /** Lowest and highest value plotted on this axis. */
  readonly dataMin: number
  readonly dataMax: number
  /** Where the drawn axis begins and ends, in data units. */
  readonly min: number
  readonly max: number
  readonly log: boolean
}

export interface InfoSheetView {
  readonly kind: 'info'
  readonly id: string
  readonly title: string
  readonly constants: readonly { name: string; value: string }[]
}

export interface TableView {
  /** Widest column, so a grid knows how many rows to offer. */
  readonly rowCount: number
  readonly rowTitles: readonly string[]
  readonly columns: readonly ColumnView[]
  readonly tableFormat: string
  readonly dataFormat: string
  /**
   * Whether the stored numbers are what Prism shows.
   *
   * `offsets` means the file holds deltas that Prism adds to a mean before
   * display; `unknown` means we have never seen this layout and will not
   * pretend the numbers mean what their column heading implies.
   */
  readonly storage: StorageSemantics
}

/**
 * Rows Prism marks inside one subcolumn.
 *
 * `excluded` is the one that changes an answer. Prism keeps such a value on the
 * table so the reading stays on the record, but leaves it out of every analysis
 * and every graph - so anything that reads these cells as ordinary data reports
 * numbers Prism itself does not use. `censored` carries the same weight for
 * survival tables, where it distinguishes "the subject died at t" from "we
 * stopped following the subject at t".
 */
export interface SubcolumnMarks {
  readonly excluded: ReadonlySet<number>
  readonly censored: ReadonlySet<number>
}

export interface ColumnView {
  readonly id: string
  readonly title: string
  readonly role: 'x' | 'y' | 'rowTitles'
  /** One entry per subcolumn; each is a column of raw cell text. */
  readonly subcolumns: readonly (readonly string[])[]
  /** Parallel to `subcolumns`. Empty sets when nothing is marked. */
  readonly marks: readonly SubcolumnMarks[]
  /**
   * True when the values were computed from a start value and an interval
   * rather than read from the file. Prism shows them; the table stores none.
   */
  readonly generated: boolean
}

export const NO_MARKS: SubcolumnMarks = { excluded: new Set(), censored: new Set() }

export function marksFor(column: ColumnView, subcolumn: number): SubcolumnMarks {
  return column.marks[subcolumn] ?? NO_MARKS
}

/** Reads a cell, tolerating ragged columns. */
export function cell(column: ColumnView, subcolumn: number, row: number): string {
  return column.subcolumns[subcolumn]?.[row] ?? ''
}

/** Numeric view of a cell. Blank stays blank rather than becoming zero. */
export function numericCell(
  column: ColumnView,
  subcolumn: number,
  row: number,
): number | undefined {
  const text = cell(column, subcolumn, row)
  if (text === '') return undefined
  const n = Number(text)
  return Number.isNaN(n) ? undefined : n
}
