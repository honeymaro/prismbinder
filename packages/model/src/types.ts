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

export interface GraphSheetView {
  readonly kind: 'graph'
  readonly id: string
  readonly title: string
  /** True when the geometry is a PCFF blob we carry but do not interpret. */
  readonly opaque: boolean
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

export interface ColumnView {
  readonly id: string
  readonly title: string
  readonly role: 'x' | 'y' | 'rowTitles'
  /** One entry per subcolumn; each is a column of raw cell text. */
  readonly subcolumns: readonly (readonly string[])[]
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
