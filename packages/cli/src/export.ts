import { printCsv } from '@prismbinder/core'
import type { Project, Sheet } from '@prismbinder/model'

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

export interface ExportedTable {
  readonly filename: string
  readonly content: string
}

function slug(s: string, fallback: string): string {
  const cleaned = s
    .replace(/[^\w .\-]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned === '' ? fallback : cleaned.slice(0, 80)
}

/** Flattens a sheet into a grid: one column per subcolumn, with header rows. */
function gridFor(sheet: Extract<Sheet, { kind: 'data' }>): string[][] {
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
      columns.push(cells)
    })
  }

  const rows: string[][] = [headers]
  if (anySubheader) rows.push(subheaders)
  for (let r = 0; r < t.rowCount; r++) {
    rows.push(columns.map((col) => col[r] ?? ''))
  }
  return rows
}

export function exportTables(project: Project, format: ExportFormat): ExportedTable[] {
  const out: ExportedTable[] = []
  const used = new Set<string>()

  project.sheets.forEach((sheet, i) => {
    if (sheet.kind !== 'data') return
    let name = slug(sheet.title, `sheet-${i + 1}`)
    let n = 2
    while (used.has(name)) name = `${slug(sheet.title, `sheet-${i + 1}`)} (${n++})`
    used.add(name)

    if (format === 'csv') {
      out.push({ filename: `${name}.csv`, content: printCsv({ rows: gridFor(sheet) }) })
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
              subcolumns: c.subcolumns,
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
