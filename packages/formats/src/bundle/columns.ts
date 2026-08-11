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
 * offset that are not equal to one another. `y_sd` stores the SD directly.
 *
 * The `*_cv` and `*_n` variants do not appear in any file we have, so we do not
 * claim to know what they hold. Callers get `unknown` and can decide whether to
 * refuse the table rather than display a number that might be wrong.
 */
export type StorageSemantics = 'direct' | 'offsets' | 'unknown'

export function storageSemantics(dataFormat: string): StorageSemantics {
  switch (dataFormat) {
    case 'y_single':
    case 'text':
    case 'text_replicates':
    case 'y_replicates':
    case 'y_sd':
      return 'direct'
    case 'y_plus_minus':
    case 'y_high_low':
      return 'offsets'
    default:
      return 'unknown'
  }
}
