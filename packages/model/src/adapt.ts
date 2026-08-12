import { type Diagnostic, DiagnosticBag, type ParseResult } from '@prismbinder/core'
import {
  type CellFlagRange,
  columnLayout,
  type DataSetSeries,
  dataFormatFromPzfx,
  type PrismBundle,
  type PzfxColumn,
  type PzfxDocument,
  pzfxStoresAbsoluteBounds,
  readBundle,
  readPzfx,
  storageSemantics,
  tableFormatFromPzfx,
} from '@prismbinder/formats'
import {
  type ColumnView,
  NO_MARKS,
  type Project,
  type Sheet,
  type SubcolumnMarks,
  type TableView,
} from './types.js'

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
  const generatedX: string[] = []

  // Which analysis produced which results view. Prism writes those views as
  // ordinary data sheets, so without this link a computed survival curve is
  // indistinguishable from a table someone typed.
  const producedBy = new Map<string, { analysisClass: string; sheetTitle: string }>()
  for (const a of bundle.analyses) {
    if (a.analysisClass === undefined) continue
    for (const r of a.resultSheets) {
      // Keyed on the data sheet the view points at, not on the view's own uid,
      // which matches nothing.
      if (r.dataSheet === undefined) continue
      producedBy.set(r.dataSheet, { analysisClass: a.analysisClass, sheetTitle: r.title })
    }
  }

  for (const s of bundle.dataSheets) {
    const t = s.table
    if (t === undefined) continue
    const xFormat = t.xDataSet !== undefined ? bundle.dataSets.get(t.xDataSet)?.format : undefined
    const layout = columnLayout(t, xFormat)

    // The CSV, never `declaredRows`. `content.json` can claim any number it
    // likes and nothing validates it, so a two-hundred-byte entry saying
    // `"numberOfRows": 20000000` would size the generated X column below - a
    // 1.3 KB archive that exhausts the heap, in a library whose main consumer
    // opens files a stranger sent. Producing a row costs a row of bytes;
    // claiming one costs ten characters. The two agree on all 95 tables in the
    // corpus, and where they do not the reader already warns.
    const rowCount = t.rows.length

    const columns: ColumnView[] = []
    if (layout.rowTitleColumn !== undefined && t.rowTitlesDataSet !== undefined) {
      columns.push({
        id: t.rowTitlesDataSet,
        title: bundle.dataSets.get(t.rowTitlesDataSet)?.title ?? '',
        role: 'rowTitles',
        subcolumns: [columnCells(t.rows, layout.rowTitleColumn)],
        marks: marksFromFlags(bundle.dataSets.get(t.rowTitlesDataSet)?.cellFlags, 1, rowCount),
        generated: false,
      })
    }
    if (t.xDataSet !== undefined) {
      const xSet = bundle.dataSets.get(t.xDataSet)
      if (layout.xColumn !== undefined) {
        columns.push({
          id: t.xDataSet,
          title: xSet?.title ?? 'X',
          role: 'x',
          subcolumns: [columnCells(t.rows, layout.xColumn)],
          marks: marksFromFlags(xSet?.cellFlags, 1, rowCount),
          generated: false,
        })
      } else if (xSet?.series !== undefined) {
        // A generated X occupies no CSV column, so reading only the stored
        // columns drops it entirely and the sheet looks like a table with no X
        // at all. Prism shows these values; they are simply computed.
        columns.push({
          id: t.xDataSet,
          title: xSet.title ?? 'X',
          role: 'x',
          subcolumns: [seriesCells(xSet.series, rowCount)],
          marks: [NO_MARKS],
          generated: true,
        })
        generatedX.push(s.title ?? s.uid)
      }
    }
    t.dataSets.forEach((uid, i) => {
      const start = layout.dataSetStarts[i] ?? 0
      const subcolumns: string[][] = []
      for (let k = 0; k < layout.subcolumnsPerDataSet; k++) {
        subcolumns.push(columnCells(t.rows, start + k))
      }
      columns.push({
        id: uid,
        // Empty when the file says nothing, never a name of our own. 97 of the
        // 513 Y columns in the corpus carry no `title` at all - the first column
        // of a clustering distance matrix, every column of a tabular results
        // view - and Prism draws a blank header for them. Inventing `Column 3`
        // here put an invented name on a chart legend and in an export, where
        // nothing marks it as ours. What looks like a header on those sheets in
        // Prism is a row of the data itself, flagged `SECTION_TITLE`.
        title: bundle.dataSets.get(uid)?.title ?? '',
        role: 'y',
        subcolumns,
        marks: marksFromFlags(bundle.dataSets.get(uid)?.cellFlags, subcolumns.length, rowCount),
        generated: false,
      })
    })

    const table: TableView = {
      rowCount,
      rowTitles:
        layout.rowTitleColumn !== undefined ? columnCells(t.rows, layout.rowTitleColumn) : [],
      columns,
      tableFormat: t.format,
      dataFormat: t.dataFormat,
      storage: storageSemantics(t.dataFormat),
    }

    sheets.push({
      kind: 'data',
      id: s.uid,
      title: s.title ?? 'Data',
      table,
      producedBy: producedBy.get(s.uid),
    })
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
    sheets.push({
      kind: 'graph',
      id: g.uid,
      title: g.title ?? 'Graph',
      // A graph that describes itself is not opaque, whatever sits beside it.
      opaque: g.hasBinary && g.mv === undefined,
      mv:
        g.mv === undefined
          ? undefined
          : {
              dataSheet: g.mv.dataSheet,
              figures: g.mv.figures.map((f) => ({
                kind: f.kind,
                colorScheme: f.colorScheme,
                branchesLink: f.branchesLink,
                clustersLink: f.clustersLink,
              })),
              axisY:
                g.mv.axisY === undefined
                  ? undefined
                  : {
                      min: g.mv.axisY.lowerLimit,
                      max: g.mv.axisY.upperLimit,
                      interval: g.mv.axisY.interval,
                    },
            },
    })
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
  if (generatedX.length > 0) {
    notes.push(
      `X values were computed from a start value and an interval in ${generatedX.length} sheet(s) (${generatedX.join(', ')}); the file stores no X column for them`,
    )
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
        marks: pzfxMarks(t.rowTitles),
        generated: false,
      })
    }
    if (t.x !== undefined) {
      columns.push({
        id: `${t.id ?? idx}-x`,
        title: t.x.title ?? 'X',
        role: 'x',
        subcolumns: t.x.subcolumns.map((s) => s.cells.map(cellText)),
        marks: pzfxMarks(t.x),
        generated: false,
      })
    }
    t.yColumns.forEach((c, i) => {
      columns.push({
        id: `${t.id ?? idx}-y${i}`,
        title: c.title ?? '',
        role: 'y',
        subcolumns: c.subcolumns.map((s) => s.cells.map(cellText)),
        marks: pzfxMarks(c),
        generated: false,
      })
    })

    let rowCount = 0
    for (const c of columns) for (const s of c.subcolumns) rowCount = Math.max(rowCount, s.length)

    sheets.push({
      kind: 'data',
      id: t.id ?? `table-${idx}`,
      title: t.title ?? `Table ${idx + 1}`,
      // The XML generation stores no analysis results at all, so nothing here
      // can be attributed to one.
      producedBy: undefined,
      table: {
        rowCount,
        rowTitles: columns.find((c) => c.role === 'rowTitles')?.subcolumns[0] ?? [],
        columns,
        // Both axes are translated into the bundle's vocabulary. Passing the
        // XML spellings straight through meant the same table read as
        // `low-high` from one file and `y_high_low` from the other, and made
        // `storage` a constant `direct` - which is wrong for exactly the two
        // layouts the field exists to warn about.
        tableFormat: tableFormatFromPzfx(t.tableType, t.extTableType),
        dataFormat: dataFormatFromPzfx(t.yFormat),
        storage: pzfxStoresAbsoluteBounds(t.yFormat)
          ? 'bounds'
          : storageSemantics(dataFormatFromPzfx(t.yFormat)),
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

/**
 * Expands the bundle's inclusive row ranges into per-row marks.
 *
 * Two bounds, and both are load-bearing. Each range is clipped to the rows the
 * table has, because `lastRow` comes from the file. And the total expansion per
 * subcolumn is capped at the row count, because the *number* of ranges comes
 * from the file too: nothing stops a few kilobytes of JSON from repeating the
 * same full-width range five thousand times, which costs half a billion
 * iterations and ninety seconds of a frozen tab. A subcolumn cannot have more
 * marked cells than it has cells, so a run that reaches the cap has already
 * been handed something that is not a real document.
 */
function marksFromFlags(
  flags: readonly (readonly CellFlagRange[])[] | undefined,
  subcolumns: number,
  rowLimit: number,
): SubcolumnMarks[] {
  const out: SubcolumnMarks[] = []
  for (let i = 0; i < subcolumns; i++) {
    const ranges = flags?.[i] ?? []
    if (ranges.length === 0) {
      out.push(NO_MARKS)
      continue
    }
    const excluded = new Set<number>()
    const censored = new Set<number>()
    let budget = rowLimit
    for (const range of ranges) {
      if (budget <= 0) break
      const marksExcluded = range.attributes.includes('EXCLUDED')
      const marksCensored = range.attributes.includes('CENSORED')
      if (!marksExcluded && !marksCensored) continue
      const last = Math.min(range.lastRow, rowLimit - 1, range.firstRow + budget - 1)
      for (let r = range.firstRow; r <= last; r++) {
        if (marksExcluded) excluded.add(r)
        if (marksCensored) censored.add(r)
        budget--
      }
    }
    out.push({ excluded, censored })
  }
  return out
}

/** `.pzfx` marks exclusion per cell rather than per range. */
function pzfxMarks(column: PzfxColumn): SubcolumnMarks[] {
  return column.subcolumns.map((s) => {
    if (!s.cells.some((c) => c.excluded)) return NO_MARKS
    const excluded = new Set<number>()
    s.cells.forEach((c, i) => {
      if (c.excluded) excluded.add(i)
    })
    return { excluded, censored: new Set<number>() }
  })
}

/**
 * Rebuilds a generated X column.
 *
 * `startValue + i * interval`, computed rather than accumulated so the
 * thousandth value does not carry a thousand roundings. The text is our own
 * shortest round-trip spelling: unlike every other cell in this model there is
 * no stored text to preserve, because the file stores no such column.
 */
function seriesCells(series: DataSetSeries, rowCount: number): string[] {
  const out: string[] = []
  for (let i = 0; i < rowCount; i++) out.push(String(series.startValue + i * series.interval))
  return out
}

function columnCells(rows: readonly (readonly string[])[], col: number): string[] {
  return rows.map((r) => r[col] ?? '')
}

export type { Diagnostic }
