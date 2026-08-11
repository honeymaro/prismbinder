import type { DataFormat, TableFormat } from '../bundle/types.js'

/**
 * The vocabulary `.pzfx` uses for table shape.
 *
 * These are not our inference. GraphPad ships `PrismXMLSchema.xml` in the Prism
 * program folder and the user guide points programmers at it precisely so other
 * software can write this format; the enumerations below are copied from it.
 * Every value is also attested in the corpus, which is how the one gap between
 * the two came to light: the schema is a Prism 9 document and does not list
 * `Nested` under `ExtTableType`, while real Prism 11 files write it.
 *
 * Getting this wrong is not a cosmetic matter. A value outside these sets is
 * one a strict reader is entitled to reject, and the whole reason the `.pzfx`
 * write path exists is to be the route that works when the bundle route does
 * not.
 */

export const PZFX_X_FORMATS = [
  'none',
  'text',
  'numbers',
  'error',
  'series',
  'date',
  'startenddate',
  'time',
] as const

export const PZFX_Y_FORMATS = [
  'replicates',
  'SD',
  'SE',
  'CV',
  'SDN',
  'SEN',
  'CVN',
  'low-high',
  'text',
  'upper-lower-limits',
] as const

export const PZFX_TABLE_TYPES = [
  'Result',
  'Legacy',
  'XY',
  'OneWay',
  'TwoWay',
  'Contingency',
  'Survival',
  'PartsOfWhole',
] as const

export type PzfxXFormat = (typeof PZFX_X_FORMATS)[number]
export type PzfxYFormat = (typeof PZFX_Y_FORMATS)[number]
export type PzfxTableType = (typeof PZFX_TABLE_TYPES)[number]

/**
 * Translates a `.pzfx` `YFormat` into the bundle's `dataFormat` vocabulary.
 *
 * The two generations name the same layouts differently, and the neutral model
 * has to pick one spelling or it reports the same table two ways depending on
 * which file it was read from.
 *
 * `low-high` and `upper-lower-limits` both occupy three subcolumns and are
 * genuinely different: in the corpus the first stores a value with two offsets
 * (100, 10, 30) and the second stores a value with the absolute limits that
 * bracket it (100, 110, 70). The bundle vocabulary has one name for both, so
 * this direction loses the distinction - which is recorded rather than hidden,
 * because a caller that draws error bars needs to know which it has.
 */
export function dataFormatFromPzfx(yFormat: string | undefined): DataFormat {
  switch (yFormat) {
    case 'replicates':
      return 'y_replicates'
    case 'SD':
      return 'y_sd'
    case 'SE':
      return 'y_se'
    case 'CV':
      return 'y_cv'
    case 'SDN':
      return 'y_sd_n'
    case 'SEN':
      return 'y_se_n'
    case 'CVN':
      return 'y_cv_n'
    case 'low-high':
    case 'upper-lower-limits':
      return 'y_high_low'
    case 'text':
      return 'text'
    default:
      // Absent is the common case: 52 tables in the corpus omit the attribute,
      // and every one of them has exactly one subcolumn per column.
      return 'y_single'
  }
}

/**
 * Translates `TableType` (and `ExtTableType`) into the bundle's table vocabulary.
 *
 * The eight table kinds the user guide describes are spelled one way in the XML
 * and another in the bundle, and two of them are not a `TableType` at all: a
 * multiple-variables table is a `OneWay` carrying `ExtTableType`, and a nested
 * table is a `TwoWay` carrying it. The extended attribute therefore wins where
 * it is present.
 */
export function tableFormatFromPzfx(
  tableType: string | undefined,
  extTableType: string | undefined,
): TableFormat | string {
  if (extTableType === 'MultipleVariables') return 'multivariable'
  if (extTableType === 'Nested') return 'nested'
  switch (tableType) {
    case 'XY':
      return 'xy'
    case 'OneWay':
      return 'column'
    case 'TwoWay':
      return 'grouped'
    case 'Contingency':
      return 'contingency'
    case 'Survival':
      return 'survival'
    case 'PartsOfWhole':
      return 'partsofwhole'
    case 'Result':
      return 'view'
    // `Legacy` is deliberately absent. It is in the schema and in no document
    // we have, and nothing says it means the same thing as the bundle's `view`.
    // Guessing would put an unmeasured claim into a field callers switch on.
    default:
      return 'undefined'
  }
}

/**
 * The reverse: what to write for a table the bundle vocabulary describes.
 *
 * Undefined means "let the writer decide from the shape of the columns", which
 * is right for single-value and replicate layouts and wrong for every other
 * one. A mean-and-SD pair written as `YFormat="replicates" Replicates="2"` is
 * not a mislabel, it is a different number: Prism averages the two subcolumns,
 * so `(100, 10)` reads as 55.
 *
 * `y_plus_minus` and `y_high_low` both become `low-high`. Both store a value
 * with two offsets, and the bundle keeps no record of which of the two things
 * `.pzfx` calls `low-high` and `upper-lower-limits` a table was. Choosing the
 * offset spelling keeps the one fact that matters - these are error bounds and
 * not repeated measurements - and the imprecision is reported as a loss.
 */
export function pzfxYFormatFor(dataFormat: string): PzfxYFormat | undefined {
  switch (dataFormat) {
    case 'y_replicates':
    case 'text_replicates':
      return 'replicates'
    case 'y_sd':
      return 'SD'
    case 'y_se':
      return 'SE'
    case 'y_cv':
      return 'CV'
    case 'y_sd_n':
      return 'SDN'
    case 'y_se_n':
      return 'SEN'
    case 'y_cv_n':
      return 'CVN'
    case 'y_high_low':
    case 'y_plus_minus':
      return 'low-high'
    default:
      return undefined
  }
}

/**
 * What the stored numbers mean, for the layouts the bundle vocabulary conflates.
 *
 * `upper-lower-limits` is the one case where `.pzfx` is more precise than the
 * bundle: the second and third subcolumns are absolute bounds, not offsets, so
 * routing it through `storageSemantics('y_high_low')` would label real limits
 * as deltas.
 */
export function pzfxStoresAbsoluteBounds(yFormat: string | undefined): boolean {
  return yFormat === 'upper-lower-limits'
}
