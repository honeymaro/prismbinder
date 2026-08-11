import { printCsv } from '@prismbinder/core'
import { marksFor, type Project, type Sheet } from '@prismbinder/model'

/**
 * Getting the data out.
 *
 * This is the thing most people actually want from a Prism file, and the part
 * no existing tool does from JavaScript. It is deliberately plain: a table per
 * sheet, cells exactly as stored.
 *
 * Cells are emitted as written rather than reformatted. Prism writes numbers
 * with `%.18g`, and two thirds of them change if routed through a JS number, so
 * "tidying" the output would quietly alter the data on the way out.
 */

export type ExportFormat = 'csv' | 'json'

/**
 * What to do with a value Prism excludes.
 *
 * Prism's own export dialog asks the same question and offers the same three
 * answers, because there is no standard way to say "excluded" in a CSV. An
 * excluded value is left out of every analysis and every graph, so emitting it
 * as an ordinary number hands the reader data Prism does not use.
 *
 * `value` is the default only because it is what this command already did;
 * changing it silently would alter existing output. The count is reported
 * either way, which is the part that was missing.
 */
export type ExcludedPolicy = 'value' | 'asterisk' | 'blank'

export const EXCLUDED_POLICIES: readonly ExcludedPolicy[] = ['value', 'asterisk', 'blank']

export interface ExportedTable {
  readonly filename: string
  readonly content: string
}

function applyPolicy(text: string, excluded: boolean, policy: ExcludedPolicy): string {
  if (!excluded || text === '') return text
  if (policy === 'blank') return ''
  if (policy === 'asterisk') return `${text}*`
  return text
}

/** How many cells in a project are marked excluded. */
export function countExcluded(project: Project): number {
  let n = 0
  for (const sheet of project.sheets) {
    if (sheet.kind !== 'data') continue
    for (const c of sheet.table.columns) {
      for (let i = 0; i < c.subcolumns.length; i++) n += marksFor(c, i).excluded.size
    }
  }
  return n
}

function slug(s: string, fallback: string): string {
  const cleaned = s
    .replace(/[^\w .\-]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned === '' ? fallback : cleaned.slice(0, 80)
}

/** Flattens a sheet into a grid: one column per subcolumn, with header rows. */
function gridFor(sheet: Extract<Sheet, { kind: 'data' }>, policy: ExcludedPolicy): string[][] {
  const t = sheet.table
  const headers: string[] = []
  const subheaders: string[] = []
  const columns: (readonly string[])[] = []
  let anySubheader = false

  for (const c of t.columns) {
    c.subcolumns.forEach((cells, i) => {
      headers.push(i === 0 ? c.title : '')
      const sub = c.subcolumns.length > 1 ? `${i + 1}` : ''
      if (sub !== '') anySubheader = true
      subheaders.push(sub)
      const excluded = marksFor(c, i).excluded
      columns.push(
        excluded.size === 0
          ? cells
          : cells.map((text, row) => applyPolicy(text, excluded.has(row), policy)),
      )
    })
  }

  const rows: string[][] = [headers]
  if (anySubheader) rows.push(subheaders)
  for (let r = 0; r < t.rowCount; r++) {
    rows.push(columns.map((col) => col[r] ?? ''))
  }
  return rows
}

export function exportTables(
  project: Project,
  format: ExportFormat,
  policy: ExcludedPolicy = 'value',
): ExportedTable[] {
  const out: ExportedTable[] = []
  const used = new Set<string>()

  project.sheets.forEach((sheet, i) => {
    if (sheet.kind !== 'data') return
    let name = slug(sheet.title, `sheet-${i + 1}`)
    let n = 2
    while (used.has(name)) name = `${slug(sheet.title, `sheet-${i + 1}`)} (${n++})`
    used.add(name)

    if (format === 'csv') {
      out.push({ filename: `${name}.csv`, content: printCsv({ rows: gridFor(sheet, policy) }) })
    } else {
      out.push({
        filename: `${name}.json`,
        content: `${JSON.stringify(
          {
            title: sheet.title,
            tableFormat: sheet.table.tableFormat,
            dataFormat: sheet.table.dataFormat,
            // Says whether the numbers below are what Prism displays.
            storage: sheet.table.storage,
            rowCount: sheet.table.rowCount,
            columns: sheet.table.columns.map((c) => ({
              title: c.title,
              role: c.role,
              ...(c.generated ? { generated: true } : {}),
              subcolumns: c.subcolumns,
              // Row indices Prism leaves out of its analyses and graphs. JSON
              // can carry this where a CSV cell cannot, so it is reported here
              // regardless of the policy.
              excludedRows: c.subcolumns.map((_, i) => [...marksFor(c, i).excluded]),
              censoredRows: c.subcolumns.map((_, i) => [...marksFor(c, i).censored]),
            })),
          },
          null,
          2,
        )}\n`,
      })
    }
  })

  return out
}
