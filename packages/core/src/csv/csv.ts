/**
 * CSV for Prism's data tables.
 *
 * The single most important decision here is that **cells are strings**.
 *
 * Prism writes numbers with `%.18g`, and 69% of the numeric cells in the sample
 * corpus do not survive a trip through a JS number: `2.35671923073764633`
 * shortens to `2.3567192307376463`, `2.000` becomes `2`, `177.0` becomes `177`.
 * A grid that stores cells as numbers would silently rewrite two thirds of
 * every table it touched. So the stored text is authoritative, and callers ask
 * for a number only when they want one.
 *
 * The dialect, measured across every `data.csv` in the corpus:
 *
 *   - UTF-8, no BOM
 *   - LF line endings, and the file always ends with one
 *   - quoting is minimal and, in practice, only ever triggered by a comma
 *   - no embedded newlines and no doubled quotes have ever appeared
 *
 * We still implement the full RFC 4180 quoting rules, because a user typing a
 * quote into a cell is a case the corpus simply has not shown us yet.
 */

export interface CsvTable {
  /** Rows of raw cell text. Ragged input is preserved rather than padded. */
  readonly rows: readonly (readonly string[])[]
}

const QUOTE = '"'

/** True when a field cannot be written bare. */
function needsQuoting(field: string): boolean {
  return (
    field.includes(',') || field.includes(QUOTE) || field.includes('\n') || field.includes('\r')
  )
}

export function parseCsv(text: string): CsvTable {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  // Tracks whether the current row has any content, so a trailing newline does
  // not produce a spurious final row.
  let started = false

  while (i < text.length) {
    const ch = text[i] as string

    if (inQuotes) {
      if (ch === QUOTE) {
        if (text[i + 1] === QUOTE) {
          field += QUOTE
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === QUOTE && field === '') {
      inQuotes = true
      started = true
      i++
      continue
    }

    if (ch === ',') {
      row.push(field)
      field = ''
      started = true
      i++
      continue
    }

    if (ch === '\n' || ch === '\r') {
      // Accept CRLF defensively even though Prism writes LF.
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      started = false
      i++
      continue
    }

    field += ch
    started = true
    i++
  }

  if (started || field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return { rows }
}

export function printCsv(table: CsvTable): string {
  const out: string[] = []
  for (const row of table.rows) {
    for (let c = 0; c < row.length; c++) {
      const field = row[c] as string
      if (c > 0) out.push(',')
      out.push(needsQuoting(field) ? QUOTE + field.replaceAll(QUOTE, '""') + QUOTE : field)
    }
    out.push('\n')
  }
  return out.join('')
}

/** Cell text at a position, or '' when the table is ragged there. */
export function cellAt(table: CsvTable, row: number, col: number): string {
  return table.rows[row]?.[col] ?? ''
}

/** Widest row. Tables can be ragged, so this is a maximum rather than a shape. */
export function columnCount(table: CsvTable): number {
  let n = 0
  for (const r of table.rows) if (r.length > n) n = r.length
  return n
}

/**
 * Interprets a cell as a number.
 *
 * Deliberately separate from storage: the text stays authoritative, and this is
 * a view of it. Blank cells are `undefined` rather than 0, because a missing
 * observation is not a measurement of zero.
 */
export function cellAsNumber(text: string): number | undefined {
  if (text === '') return undefined
  const n = Number(text)
  return Number.isNaN(n) ? undefined : n
}
