import { type Diagnostic, DiagnosticBag, type ParseResult } from '@prismbinder/core'
import {
  columnLayout,
  type PrismBundle,
  type PzfxDocument,
  readBundle,
  readPzfx,
  storageSemantics,
} from '@prismbinder/formats'
import type { ColumnView, Project, Sheet, TableView } from './types.js'

/** Sniffs the container and builds a format-neutral view. */
export function readProject(bytes: Uint8Array, path = ''): ParseResult<Project | undefined> {
  const bag = new DiagnosticBag()

  // Extensions lie: `.pzt` is XML, PCFF or ZIP depending on the file.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const r = readBundle(bytes)
    for (const d of r.diagnostics) bag.add(d)
    return bag.result(r.value === undefined ? undefined : fromBundle(r.value))
  }

  if (bytes[0] === 0x50 && bytes[1] === 0x43 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    bag.error(
      'project/legacy-binary',
      path,
      'this is the legacy PCFF binary format, which prismbinder does not read. Open it in Prism once and save it again to convert it.',
    )
    return bag.result(undefined)
  }

  const r = readPzfx(bytes, path)
  for (const d of r.diagnostics) bag.add(d)
  return bag.result(r.value === undefined ? undefined : fromPzfx(r.value))
}

export function fromBundle(bundle: PrismBundle): Project {
  const notes: string[] = []
  const sheets: Sheet[] = []

  for (const s of bundle.dataSheets) {
    const t = s.table
    if (t === undefined) continue
    const xFormat = t.xDataSet !== undefined ? bundle.dataSets.get(t.xDataSet)?.format : undefined
    const layout = columnLayout(t, xFormat)

    const columns: ColumnView[] = []
    if (layout.rowTitleColumn !== undefined && t.rowTitlesDataSet !== undefined) {
      columns.push({
        id: t.rowTitlesDataSet,
        title: bundle.dataSets.get(t.rowTitlesDataSet)?.title ?? '',
        role: 'rowTitles',
        subcolumns: [columnCells(t.rows, layout.rowTitleColumn)],
      })
    }
    if (layout.xColumn !== undefined && t.xDataSet !== undefined) {
      columns.push({
        id: t.xDataSet,
        title: bundle.dataSets.get(t.xDataSet)?.title ?? 'X',
        role: 'x',
        subcolumns: [columnCells(t.rows, layout.xColumn)],
      })
    }
    t.dataSets.forEach((uid, i) => {
      const start = layout.dataSetStarts[i] ?? 0
      const subcolumns: string[][] = []
      for (let k = 0; k < layout.subcolumnsPerDataSet; k++) {
        subcolumns.push(columnCells(t.rows, start + k))
      }
      columns.push({
        id: uid,
        title: bundle.dataSets.get(uid)?.title ?? `Column ${i + 1}`,
        role: 'y',
        subcolumns,
      })
    })

    const table: TableView = {
      rowCount: t.rows.length,
      rowTitles:
        layout.rowTitleColumn !== undefined ? columnCells(t.rows, layout.rowTitleColumn) : [],
      columns,
      tableFormat: t.format,
      dataFormat: t.dataFormat,
      storage: storageSemantics(t.dataFormat),
    }

    sheets.push({ kind: 'data', id: s.uid, title: s.title ?? 'Data', table })
  }

  for (const a of bundle.analyses) {
    sheets.push({
      kind: 'analysis',
      id: a.uid,
      title: a.title ?? 'Analysis',
      analysisClass: a.analysisClass,
      hasResults: a.results !== undefined,
      results: a.results?.root,
    })
  }

  for (const g of bundle.graphs) {
    sheets.push({ kind: 'graph', id: g.uid, title: g.title ?? 'Graph', opaque: g.hasBinary })
  }

  for (const i of bundle.infoSheets) {
    sheets.push({ kind: 'info', id: i.uid, title: i.title ?? 'Info', constants: [] })
  }

  if (bundle.opaqueEntries.length > 0) {
    notes.push(
      `${bundle.opaqueEntries.length} entries are carried through without being interpreted`,
    )
  }
  if (bundle.graphs.some((g) => g.hasBinary)) {
    notes.push('graph geometry is stored in an opaque binary and is not rendered')
  }

  return {
    source: 'bundle',
    title: undefined,
    formatVersion: bundle.document.version.formatVersion,
    minPrismVersion: bundle.document.version.minPrismVersion,
    sheets,
    notes,
  }
}

export function fromPzfx(doc: PzfxDocument): Project {
  const notes: string[] = []
  const sheets: Sheet[] = []

  doc.tables.forEach((t, idx) => {
    const columns: ColumnView[] = []
    if (t.rowTitles !== undefined) {
      columns.push({
        id: `${t.id ?? idx}-rowTitles`,
        title: t.rowTitles.title ?? '',
        role: 'rowTitles',
        subcolumns: t.rowTitles.subcolumns.map((s) => s.cells.map(cellText)),
      })
    }
    if (t.x !== undefined) {
      columns.push({
        id: `${t.id ?? idx}-x`,
        title: t.x.title ?? 'X',
        role: 'x',
        subcolumns: t.x.subcolumns.map((s) => s.cells.map(cellText)),
      })
    }
    t.yColumns.forEach((c, i) => {
      columns.push({
        id: `${t.id ?? idx}-y${i}`,
        title: c.title ?? `Column ${i + 1}`,
        role: 'y',
        subcolumns: c.subcolumns.map((s) => s.cells.map(cellText)),
      })
    })

    let rowCount = 0
    for (const c of columns) for (const s of c.subcolumns) rowCount = Math.max(rowCount, s.length)

    sheets.push({
      kind: 'data',
      id: t.id ?? `table-${idx}`,
      title: t.title ?? `Table ${idx + 1}`,
      table: {
        rowCount,
        rowTitles: columns.find((c) => c.role === 'rowTitles')?.subcolumns[0] ?? [],
        columns,
        tableFormat: t.tableType ?? 'undefined',
        dataFormat: t.yFormat ?? 'y_single',
        storage: 'direct',
      },
    })
  })

  if (doc.infoConstants.length > 0) {
    sheets.push({
      kind: 'info',
      id: 'info',
      title: 'Project info',
      constants: doc.infoConstants,
    })
  }

  if (doc.hasTemplate) {
    notes.push(
      'graphs, analyses and formatting are inside an opaque <Template> blob and are not shown',
    )
  }

  return {
    source: 'pzfx',
    title: undefined,
    formatVersion: doc.prismXmlVersion,
    minPrismVersion: undefined,
    sheets,
    notes,
  }
}

/** Prefers the display text when a cell stores a category index. */
function cellText(c: { text: string; userText: string | undefined }): string {
  return c.userText ?? c.text
}

function columnCells(rows: readonly (readonly string[])[], col: number): string[] {
  return rows.map((r) => r[col] ?? '')
}

export type { Diagnostic }
