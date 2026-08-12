import { type ColumnView, marksFor, type TableView } from '@prismbinder/model'

/**
 * Reading a data table as plottable numbers.
 *
 * One job, and it is the one that decides whether every chart above it tells
 * the truth: work out what the subcolumns after the first one hold. The layout
 * name cannot say - `y_high_low` is what both a two-offset layout and an
 * absolute-limits layout are called once they reach the bundle vocabulary - so
 * this reads `storage`, which can.
 *
 * Excluded cells are dropped. Prism leaves them out of every analysis and every
 * graph, so a chart that plotted them would be showing data Prism does not use.
 */

/** What the subcolumns after the first one hold. */
export type Spread = 'replicates' | 'symmetric' | 'offsets' | 'bounds' | 'none'

export function spreadOf(table: TableView): Spread {
  if (table.dataFormat === 'y_replicates' || table.dataFormat === 'text_replicates') {
    return 'replicates'
  }
  switch (table.storage) {
    case 'offsets':
      return 'offsets'
    case 'bounds':
      return 'bounds'
    // `y_cv` and `y_cv_n` label the column %CV, but every dataset inside such a
    // table declares its own format as `y_sd`: the number stored is an SD.
    case 'derived':
      return 'symmetric'
    case 'direct':
      return table.dataFormat === 'y_sd' ||
        table.dataFormat === 'y_se' ||
        table.dataFormat === 'y_sd_n' ||
        table.dataFormat === 'y_se_n'
        ? 'symmetric'
        : 'none'
    default:
      return 'none'
  }
}

export interface Datum {
  /** Row in the source table, kept so a chart can point back at a cell. */
  readonly row: number
  readonly x: number
  readonly y: number
  readonly up: number | undefined
  readonly down: number | undefined
}

export interface Series {
  readonly label: string
  readonly data: readonly Datum[]
  /** Every value in the column, ungrouped, for charts that summarise. */
  readonly values: readonly number[]
  /** One entry per row, holding that row's replicates. Empty rows are kept. */
  readonly byRow: readonly (readonly number[])[]
}

export interface TableSeries {
  readonly series: readonly Series[]
  readonly spread: Spread
  readonly xLabel: string
  readonly yLabel: string
  /** True when the row number stands in for an X the table does not have. */
  readonly usedRowIndex: boolean
  /** Row titles, used as category labels where they exist. */
  readonly categories: readonly string[]
  readonly rowCount: number
}

export function readTable(table: TableView): TableSeries {
  const xColumn = table.columns.find((c) => c.role === 'x')
  const yColumns = table.columns.filter((c) => c.role === 'y')
  const usedRowIndex = xColumn === undefined
  const spread = spreadOf(table)
  const x = readXColumn(xColumn?.subcolumns[0] ?? [], table.rowCount)

  const series: Series[] = []
  for (const column of yColumns) {
    const first = column.subcolumns[0] ?? []
    const data: Datum[] = []
    const values: number[] = []
    const byRow: number[][] = []

    for (let row = 0; row < table.rowCount; row++) {
      const at = usedRowIndex ? row + 1 : x.values[row]
      const here: number[] = []
      byRow.push(here)
      if (at === undefined) continue

      if (spread === 'replicates') {
        column.subcolumns.forEach((sub, i) => {
          if (marksFor(column, i).excluded.has(row)) return
          const v = num(sub[row])
          if (v === undefined) return
          data.push({ row, x: at, y: v, up: undefined, down: undefined })
          values.push(v)
          here.push(v)
        })
        continue
      }

      if (marksFor(column, 0).excluded.has(row)) continue
      const y = num(first[row])
      if (y === undefined) continue
      data.push({ row, x: at, y, ...bar(spread, column, row, y) })
      values.push(y)
      here.push(y)
    }

    // A legend entry has to say something, and a column the file never named
    // gets its position rather than the word "untitled", which told a reader
    // nothing and read the same for all seven of them.
    series.push({
      label: column.title === '' ? `Column ${series.length + 1}` : column.title,
      data,
      values,
      byRow,
    })
  }

  return {
    series,
    spread,
    xLabel: usedRowIndex ? 'Row' : `${xColumn?.title ?? 'X'}${x.suffix}`,
    yLabel: '',
    usedRowIndex,
    categories: [...table.rowTitles],
    rowCount: table.rowCount,
  }
}

/** Half-lengths above and below the point, whatever form the file stores. */
function bar(
  spread: Spread,
  column: ColumnView,
  row: number,
  value: number,
): { up: number | undefined; down: number | undefined } {
  const a = num(column.subcolumns[1]?.[row])
  const b = num(column.subcolumns[2]?.[row])
  switch (spread) {
    case 'symmetric':
      // The `*_n` layouts put a count in the third subcolumn; it is not a bound.
      return { up: a, down: a }
    case 'offsets':
      return { up: a, down: b }
    case 'bounds': {
      // Absolute limits, upper then lower. Dropped rather than mirrored when
      // they do not actually bracket the value.
      if (a === undefined || b === undefined) return { up: undefined, down: undefined }
      if (a < value || b > value) return { up: undefined, down: undefined }
      return { up: a - value, down: value - b }
    }
    default:
      return { up: undefined, down: undefined }
  }
}

/**
 * One comma, digits on both sides. A decimal separator, not a thousands one.
 *
 * See `num` for why this reading is safe on real files.
 */
const COMMA_DECIMAL = /^[-+]?\d+,\d+(?:[eE][-+]?\d+)?$/

/**
 * A cell as a number, or nothing.
 *
 * **A comma is a decimal separator.** Prism writes cells in the locale the
 * document was saved in, and half the corpus was saved somewhere that uses a
 * comma: 36 documents of 71 store `82,90279` where the others store `82.90279`.
 * `Number` refuses those, so every value in them was silently dropped and the
 * chart came out blank - `Volcano plot.pzt` has 480 non-empty cells and drew
 * nothing at all, in every one of the seven styles offered for it.
 *
 * The reading is safe rather than merely convenient, and both halves were
 * measured over all 86,665 cells in the corpus:
 *
 * - **No document mixes the two.** Zero files hold both a `1,5` and a `1.5`, so
 *   a comma never has to mean two things in one place.
 * - **A comma is never a thousands separator.** 82 cells are shaped like one -
 *   `117,114`, `-1,962` - and every one of them sits in a document that is
 *   unambiguously comma-decimal elsewhere. None appears in a dot-decimal file.
 *   That follows from how Prism stores numbers: cells are written with `%.18g`,
 *   which never groups. Grouping is a display setting and does not reach a file.
 *
 * Text is left alone. `Mecca, Saudi Arabia` has a comma and is not a number,
 * which the shape above already refuses without needing to know it is a name.
 */
export function num(text: string | undefined): number | undefined {
  if (text === undefined) return undefined
  const v = text.trim()
  if (v === '') return undefined
  const n = Number(v)
  if (Number.isFinite(n)) return n
  if (COMMA_DECIMAL.test(v)) {
    const comma = Number(v.replace(',', '.'))
    return Number.isFinite(comma) ? comma : undefined
  }
  return hoursOf(v)
}

/**
 * An elapsed time, in hours.
 *
 * `H:MM:SS` with an optional fraction, and the hours run past 24 - the corpus
 * holds `27:00:00.000` and `30:00:00.000` - so this is a duration rather than a
 * clock reading. Prism offers an elapsed-time X axis and two sample documents
 * use it; before this they parsed as nothing, every row was skipped for want of
 * an X, and the chart came out blank with sixty-three numbers sitting in it.
 *
 * Hours, because that is the field the file leads with: `9:00:00.000` is 9,
 * which is the number a reader of the table already sees.
 */
const DURATION = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/

function hoursOf(v: string): number | undefined {
  const m = DURATION.exec(v)
  if (m === null) return undefined
  const [, h, min, sec, ms] = m
  return (
    Number(h) +
    Number(min) / 60 +
    Number(sec) / 3600 +
    Number((ms ?? '0').padEnd(3, '0')) / 3_600_000
  )
}

/** `13-Jul-2013`. The only date spelling any document in the corpus uses. */
const DATE = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Whole days since the Unix epoch, in UTC so no time zone can shift a date. */
function dayOf(v: string): number | undefined {
  const m = DATE.exec(v)
  if (m === null) return undefined
  const month = MONTHS.indexOf((m[2] as string).toLowerCase())
  if (month < 0) return undefined
  const day = Number(m[1])
  const year = Number(m[3])
  const t = Date.UTC(year, month, day)
  if (!Number.isFinite(t)) return undefined
  const back = new Date(t)
  // Rejects 31-Feb and friends, which roll over rather than fail.
  if (back.getUTCDate() !== day || back.getUTCMonth() !== month) return undefined
  return t / 86_400_000
}

function spellDay(days: number): string {
  const d = new Date(days * 86_400_000)
  const month = MONTHS[d.getUTCMonth()] ?? ''
  return `${d.getUTCDate()} ${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getUTCFullYear()}`
}

/**
 * The X column as numbers, and what to add to its title to say what they mean.
 *
 * Dates are handled here rather than in `num` because a date is only a number
 * once something has decided where zero is. Days since the Unix epoch would put
 * `13-Jul-2013` at 15899, and an axis labelled in the sixteen thousands says
 * nothing to anybody. Measuring from the earliest date in the column keeps the
 * spacing - which is the whole reason a date axis is not a category axis, since
 * the corpus sample steps by 24 days, then 46, then 20 - and the title carries
 * the origin so the numbers can be read back.
 */
function readXColumn(
  cells: readonly string[],
  rowCount: number,
): { values: (number | undefined)[]; suffix: string } {
  const days: (number | undefined)[] = []
  let dated = 0
  let numeric = 0
  for (let row = 0; row < rowCount; row++) {
    const raw = cells[row]?.trim() ?? ''
    const d = raw === '' ? undefined : dayOf(raw)
    days.push(d)
    if (d !== undefined) dated++
    else if (num(raw) !== undefined) numeric++
  }

  if (dated > 0 && dated >= numeric) {
    const known = days.filter((d): d is number => d !== undefined)
    const origin = Math.min(...known)
    return {
      values: days.map((d) => (d === undefined ? undefined : d - origin)),
      suffix: ` (days from ${spellDay(origin)})`,
    }
  }

  const values = Array.from({ length: rowCount }, (_, row) => num(cells[row]))
  // Only say "hours" where the file actually wrote a duration; a plain number
  // in an X column is whatever the column title already says it is.
  const elapsed = cells.slice(0, rowCount).some((c) => DURATION.test(c.trim()))
  return { values, suffix: elapsed ? ' (hours)' : '' }
}
