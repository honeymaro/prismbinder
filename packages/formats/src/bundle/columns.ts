import type { DataTable } from './types.js'

/**
 * Maps a table's datasets onto CSV columns.
 *
 * Verified against every table in the corpus: the computed width matches both
 * `content.json.numberOfColumns` and the parsed CSV, 72 of 72.
 *
 *   columns = (row titles ? 1 : 0)
 *           + (X, unless it is a generated series ? 1 : 0)
 *           + datasets x subcolumns per dataset
 *
 * Order is: row titles, then X, then each dataset's block in `dataSets` order.
 */

/** Subcolumns each dataset occupies, driven by the *table's* dataFormat. */
export function subcolumnsPerDataSet(
  dataFormat: string,
  replicatesCount: number | undefined,
): number {
  switch (dataFormat) {
    case 'text':
    case 'y_single':
      return 1
    case 'y_sd':
    case 'y_se':
    case 'y_cv':
      return 2
    // Not "value +/- error" but value plus two independently stored offsets.
    case 'y_plus_minus':
    case 'y_high_low':
    case 'y_sd_n':
    case 'y_se_n':
    case 'y_cv_n':
      return 3
    case 'y_replicates':
    case 'text_replicates':
      return replicatesCount ?? 1
    default:
      return 1
  }
}

/**
 * True when the X dataset contributes no CSV column.
 *
 * A `series` X is generated from a start value and an interval rather than
 * stored. Two tables in the corpus do this, both with 1000 rows; missing the
 * rule puts every one of their columns off by one.
 */
export function xOccupiesColumn(xDataSetFormat: string | undefined): boolean {
  // `undefined` means we could not resolve the dataset, not that it is a
  // series. Treating the two the same drops a real X column from the layout
  // and shifts every Y column left by one -- silently, and on the write path
  // as well as the read path. Two datasets in the corpus are `series` against
  // roughly five hundred that are not, so when the record is missing the only
  // defensible assumption is the common one, which is also what the documented
  // formula says: `xDataSet && xDataSet.format !== "series"`.
  return xDataSetFormat !== 'series'
}

export interface ColumnLayout {
  readonly total: number
  readonly rowTitleColumn: number | undefined
  readonly xColumn: number | undefined
  /** First CSV column of each dataset, parallel to `table.dataSets`. */
  readonly dataSetStarts: readonly number[]
  readonly subcolumnsPerDataSet: number
}

export function columnLayout(
  table: Pick<
    DataTable,
    'dataFormat' | 'replicatesCount' | 'rowTitlesDataSet' | 'xDataSet' | 'dataSets'
  >,
  xDataSetFormat: string | undefined,
): ColumnLayout {
  const per = subcolumnsPerDataSet(table.dataFormat, table.replicatesCount)
  let next = 0
  const rowTitleColumn = table.rowTitlesDataSet !== undefined ? next++ : undefined
  const hasX = table.xDataSet !== undefined && xOccupiesColumn(xDataSetFormat)
  const xColumn = hasX ? next++ : undefined
  const dataSetStarts: number[] = []
  for (let i = 0; i < table.dataSets.length; i++) {
    dataSetStarts.push(next)
    next += per
  }
  return {
    total: next,
    rowTitleColumn,
    xColumn,
    dataSetStarts,
    subcolumnsPerDataSet: per,
  }
}

/**
 * Whether the CSV holds displayed values or something Prism transforms first.
 *
 * Measured, in the corpus: `y_high_low` stores two independent offsets rather
 * than absolute bounds, and `y_plus_minus` likewise stores an up and a down
 * offset that are not equal to one another. `y_sd`, `y_se` and the `*_n`
 * variants store what their name says.
 *
 * `y_cv` and `y_cv_n` are the interesting case. Prism labels the column %CV,
 * but every dataset inside such a table declares its own `format` as `y_sd`
 * and `y_sd_n` respectively - so the number on disk is a standard deviation
 * and the percentage is computed for display. A reader that took the stored
 * value at face value under a %CV heading would be off by a factor of the
 * mean. That is `derived`, and it is why the two axes exist: the table says
 * how to show a column, the dataset says what is in it.
 */
/**
 * `bounds` is never returned from a bundle: that vocabulary has one name,
 * `y_high_low`, for both the offset layout and the absolute-limits layout that
 * `.pzfx` spells `upper-lower-limits`. The XML side can tell them apart and
 * says so rather than rounding down to the coarser answer.
 */
export type StorageSemantics = 'direct' | 'offsets' | 'bounds' | 'derived' | 'unknown'

export function storageSemantics(dataFormat: string): StorageSemantics {
  switch (dataFormat) {
    case 'y_single':
    case 'text':
    case 'text_replicates':
    case 'y_replicates':
    case 'y_sd':
    case 'y_se':
    case 'y_sd_n':
    case 'y_se_n':
      return 'direct'
    case 'y_plus_minus':
    case 'y_high_low':
      return 'offsets'
    case 'y_cv':
    case 'y_cv_n':
      return 'derived'
    default:
      return 'unknown'
  }
}
