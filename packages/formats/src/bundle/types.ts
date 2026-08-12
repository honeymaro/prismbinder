import type { JsonDocument, JsonNode, ZipArchive } from '@prismbinder/core'

/**
 * The modern Prism container: a ZIP holding JSON structure and CSV data.
 *
 * `.prism` and `.prismt` are the same format. That is measured, not assumed -
 * comparing eight real documents against eleven shipped templates found zero
 * differences in `document.json` key paths, zero in ZIP entry shapes, and an
 * identical entry-metadata profile. The extension is the only distinction.
 */

/** How a table's subcolumns are laid out. Drives the CSV column mapping. */
export type DataFormat =
  | 'y_single'
  | 'y_replicates'
  | 'y_sd'
  | 'y_se'
  | 'y_cv'
  | 'y_sd_n'
  | 'y_se_n'
  | 'y_cv_n'
  | 'y_plus_minus'
  | 'y_high_low'
  | 'text'
  | 'text_replicates'
  | 'series'

/** The table's shape as Prism categorises it. A separate axis from `dataFormat`. */
export type TableFormat =
  | 'xy'
  | 'column'
  | 'grouped'
  | 'contingency'
  | 'survival'
  | 'partsofwhole'
  | 'multivariable'
  | 'nested'
  | 'view'
  | 'undefined'

export interface BundleVersion {
  /** e.g. "1-6-0". Hyphens, not dots. */
  readonly formatVersion: string
  readonly minFormatVersion: string
  readonly minPrismVersion: string
}

export interface BundleIdentity {
  readonly name: string
  /** The OS account of whoever saved the file. Populated in every document we have seen. */
  readonly user: string
  readonly version: string
  readonly platform: string
}

export interface BundleDocument {
  readonly json: JsonDocument
  readonly version: BundleVersion
  readonly createdBy: BundleIdentity | undefined
  readonly modifiedBy: BundleIdentity | undefined
  readonly creationDate: string | undefined
  readonly modificationDate: string | undefined
  /** Folder name to sheet ids, e.g. `graphs -> [uuid, ...]`. `data` is always present and last. */
  readonly sheets: ReadonlyMap<string, readonly string[]>
  readonly sheetTitles: ReadonlyMap<string, string>
}

/**
 * An X column Prism generates instead of storing.
 *
 * Such a dataset occupies no CSV column at all; the values come from these two
 * numbers. The rule is arithmetic - `x[i] = startValue + i * interval` - which
 * three documents agree on: two of them land on exactly 1000.0 and 72.0 at the
 * thousandth row, where a geometric reading gives 0.2459 and 1.0.
 */
export interface DataSetSeries {
  readonly startValue: number
  readonly interval: number
}

/**
 * Rows Prism marks within one subcolumn.
 *
 * Stored as inclusive ranges: `"34"` for a single row, `"0~1"` for a span.
 * `EXCLUDED` is the important one - such a value stays visible in the table but
 * is left out of every analysis and every graph, so a reader that ignores the
 * flag reports data Prism does not use.
 */
export interface CellFlagRange {
  readonly firstRow: number
  readonly lastRow: number
  readonly attributes: readonly string[]
}

/** A column of values. Prism keeps derived statistics here, some of which go stale. */
export interface DataSet {
  readonly uid: string
  readonly title: string | undefined
  readonly format: DataFormat | string
  /** Present only when `format` is `series`; the values are then generated. */
  readonly series: DataSetSeries | undefined
  /** One entry per replicate (subcolumn), in order. Usually empty. */
  readonly cellFlags: readonly (readonly CellFlagRange[])[]
  readonly json: JsonDocument
}

export interface DataTable {
  readonly uid: string
  readonly format: TableFormat | string
  readonly dataFormat: DataFormat | string
  readonly replicatesCount: number | undefined
  readonly rowTitlesDataSet: string | undefined
  readonly subcolumnTitlesDataSet: string | undefined
  readonly xDataSet: string | undefined
  readonly dataSets: readonly string[]
  /** Declared shape from content.json. */
  readonly declaredRows: number
  readonly declaredColumns: number
  /** Raw cell text. Never numbers: see the CSV module for why. */
  readonly rows: readonly (readonly string[])[]
}

export interface DataSheet {
  readonly uid: string
  readonly title: string | undefined
  readonly json: JsonDocument
  readonly table: DataTable | undefined
}

export interface AnalysisSheet {
  readonly uid: string
  readonly title: string | undefined
  readonly analysisClass: string | undefined
  readonly json: JsonDocument
  readonly parameters: JsonDocument | undefined
  readonly results: JsonDocument | undefined
  readonly inputDataSets: readonly string[]
  readonly inputSheets: readonly string[]
  /**
   * The views this analysis produced, each naming the data sheet holding it.
   *
   * The link a results view needs in order to know what it is. A sheet called
   * "Survival proportions" is a table of numbers until you know a SURVIVAL
   * analysis made it; then it is a curve that has to be drawn as a staircase.
   *
   * `dataSheet` comes from `analyses/<id>/result_sheets/<uid>.json`, an
   * `AnalysisView` record that points at the data sheet by uid. The uid listed
   * in the analysis sheet is the *view's* own and matches no data sheet, so the
   * link has to be followed rather than assumed - and the alternative, matching
   * the composed title, is a naming convention rather than a stored fact.
   */
  readonly resultSheets: readonly {
    readonly uid: string
    readonly title: string
    readonly dataSheet: string | undefined
  }[]
}

/** One axis segment, as far as a chart needs it. */
export interface AxisSegment {
  readonly lowerLimit: number | undefined
  readonly upperLimit: number | undefined
  readonly interval: number | undefined
  readonly startTicksValue: number | undefined
  readonly categorical: boolean
}

/**
 * A drawing on a Multiple Variables graph.
 *
 * `kind` is Prism's own word, taken from `gdoTypesExt.defaults`: `heatmap`,
 * `dendrogram`, `symbols`, `confidence ellipses`. The links are JSON pointers
 * into an analysis result, which is where a dendrogram's branches live.
 */
export interface MvFigure {
  readonly kind: string
  readonly colorScheme: string | undefined
  readonly branchesLink: string | undefined
  readonly clustersLink: string | undefined
}

/**
 * A Multiple Variables graph, which is described in JSON rather than in PCFF.
 *
 * This is the one graph family whose appearance the file actually states. A
 * `FENGraphSheet` keeps 250 bytes of JSON and everything else in the binary; an
 * `MVGraph` keeps 11 to 15 KB naming its axes, limits, colour scheme, legends
 * and figures, and three of the seven in the corpus have no binary at all.
 */
export interface MvGraph {
  /** The data sheet the figures are drawn from. */
  readonly dataSheet: string | undefined
  readonly figures: readonly MvFigure[]
  readonly axisX: AxisSegment | undefined
  readonly axisY: AxisSegment | undefined
}

export interface GraphSheet {
  readonly uid: string
  readonly title: string | undefined
  readonly json: JsonDocument
  /**
   * True when a `data.bin` sits beside this graph. Not the same as opaque: four
   * of the seven MV graphs carry a binary whose magic is not `PCFFGRA4`, and
   * their geometry is in the JSON regardless.
   */
  readonly hasBinary: boolean
  /** Present only for a Multiple Variables graph. */
  readonly mv: MvGraph | undefined
  readonly inputDataSets: readonly string[]
}

export interface SimpleSheet {
  readonly uid: string
  readonly title: string | undefined
  readonly json: JsonDocument
}

export interface PrismBundle {
  /** The archive exactly as read, including entries we do not model. */
  readonly archive: ZipArchive
  readonly document: BundleDocument
  readonly dataSheets: readonly DataSheet[]
  readonly dataSets: ReadonlyMap<string, DataSet>
  readonly analyses: readonly AnalysisSheet[]
  readonly graphs: readonly GraphSheet[]
  readonly infoSheets: readonly SimpleSheet[]
  readonly layoutSheets: readonly SimpleSheet[]
  /**
   * Entries carried through verbatim because we do not model them: PCFF graph
   * blobs, `misc/used_fonts.bin`, and anything a future Prism adds.
   *
   * Keeping this list explicit is the difference between "we preserved it" and
   * "we hope we preserved it".
   */
  readonly opaqueEntries: readonly string[]
}

/** Reads a member from a parsed JSON document's root. */
export type JsonLookup = (doc: JsonDocument, key: string) => JsonNode | undefined
