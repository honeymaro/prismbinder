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

/** A column of values. Prism keeps derived statistics here, some of which go stale. */
export interface DataSet {
  readonly uid: string
  readonly title: string | undefined
  readonly format: DataFormat | string
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
}

export interface GraphSheet {
  readonly uid: string
  readonly title: string | undefined
  readonly json: JsonDocument
  /**
   * True when the graph's geometry lives in an opaque `data.bin` (the PCFF
   * binary). We carry that blob through untouched and never try to author it.
   */
  readonly hasBinary: boolean
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
