import {
  type CsvTable,
  type Diagnostic,
  DiagnosticBag,
  decodeUtf8,
  encodeUtf8,
  getMember,
  type JsonDocument,
  type JsonNode,
  type JsonObject,
  jsonInt,
  jsonString,
  parseCsv,
  parseJson,
  printCsv,
  printJson,
  readEntry,
  setMember,
} from '@prismbinder/core'
import { columnLayout } from './columns.js'
import type { DataTable, PrismBundle } from './types.js'

/**
 * Editing a bundle.
 *
 * Changing one cell is not a local operation. The value lives in `data.csv`,
 * but `content.json` records the shape, `data.dt` carries a revision token, and
 * `data/sets/<uid>.json` holds statistics derived from the column's contents.
 * Writing only the CSV leaves a file that opens but shows the wrong thing.
 *
 * Which derived fields to recompute - and, just as importantly, which to leave
 * alone - was settled by measurement rather than guesswork:
 *
 *   recompute   replicates[].firstRow / lastRow      exact on 496/496 records
 *               categories[].usageCount              exact on 105/105
 *               categories[].firstRowIndex           exact on 105/105
 *               content.json row and column counts   exact on 72/72 tables
 *
 *   preserve    realsCount, integersCount, textsCount
 *               These are stale caches Prism does not maintain: 149 records in
 *               the corpus report zero over columns full of real numbers, and
 *               Prism opens them without complaint. Recomputing would rewrite
 *               192 records for no reason and break byte fidelity.
 *
 *   preserve    decimalsLength, significantDigitsCount, currentType, isManual,
 *               excludesCount - display settings and UI state, not derived.
 *
 *   preserve    valuesStorageData - an in-table formula. Its result is already
 *               materialised into the CSV, so the expression is provenance. We
 *               warn rather than silently recompute something we cannot.
 */

export interface CellEdit {
  readonly sheetId: string
  readonly row: number
  readonly column: number
  readonly value: string
}

export interface EditOptions {
  /**
   * Written into `document.json`.
   *
   * The default deliberately leaves `user` empty. Prism records the OS account
   * name of whoever saved the file, and a tool that quietly does the same would
   * stamp a real person's name into every document they exported.
   */
  readonly identity?: { name: string; user: string; version: string; platform: string }
  readonly modificationDate?: string | undefined
  /** Supplies the 32 hex characters for a changed table's revision token. */
  readonly revisionToken?: () => string
}

export interface EditResult {
  /** Entry name to new bytes, ready for `writeBundleWith`. */
  readonly updates: ReadonlyMap<string, Uint8Array>
  readonly diagnostics: readonly Diagnostic[]
}

const DEFAULT_IDENTITY = { name: 'prismbinder', user: '', version: '0.0.0', platform: 'web' }

function defaultToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Applies cell edits and everything that has to change alongside them. */
export function applyCellEdits(
  bundle: PrismBundle,
  edits: readonly CellEdit[],
  opts: EditOptions = {},
): EditResult {
  const bag = new DiagnosticBag()
  const updates = new Map<string, Uint8Array>()
  if (edits.length === 0) return { updates, diagnostics: bag.items }

  const bySheet = new Map<string, CellEdit[]>()
  for (const e of edits) {
    const list = bySheet.get(e.sheetId)
    if (list === undefined) bySheet.set(e.sheetId, [e])
    else list.push(e)
  }

  const token = opts.revisionToken ?? defaultToken
  let anyApplied = false

  for (const [sheetId, sheetEdits] of bySheet) {
    const sheet = bundle.dataSheets.find((s) => s.uid === sheetId)
    if (sheet?.table === undefined) {
      bag.error('edit/no-such-sheet', sheetId, 'no data sheet with this id, or it has no table')
      continue
    }
    const table = sheet.table
    const base = `data/tables/${table.uid}`

    // 1. The cells themselves.
    //
    //    An edit that was refused must leave no trace. Writing a fresh revision
    //    token and a new save timestamp for a table nothing reached would make
    //    the file look modified when it is not - the same objection that stops
    //    us regenerating tokens for untouched tables, one level down.
    const rows = table.rows.map((r) => r.slice())
    let applied = false
    for (const e of sheetEdits) {
      if (e.row < 0 || e.row >= rows.length) {
        bag.error('edit/row-out-of-range', `${base}#${e.row}`, `row ${e.row} does not exist`)
        continue
      }
      const row = rows[e.row] as string[]
      while (row.length <= e.column) row.push('')
      row[e.column] = e.value
      applied = true
    }
    if (!applied) continue

    anyApplied = true
    const csv: CsvTable = { rows }
    updates.set(`${base}/data.csv`, encodeUtf8(printCsv(csv)))

    // 2. The declared shape, which has to stay in step with the CSV.
    //    Prism keeps this exact in every table we have examined (72/72), so a
    //    drift here is a file we broke rather than a quirk to tolerate.
    const columns = Math.max(0, ...rows.map((r) => r.length))
    if (rows.length !== table.declaredRows || columns !== table.declaredColumns) {
      const content = contentJsonFor(bundle, base)
      if (content === undefined) {
        bag.warn(
          'edit/no-content-json',
          `${base}/content.json`,
          'table shape changed but the table has no content.json to update',
        )
      } else {
        let root = content.root
        if (root.kind === 'object') {
          root = setMember(root, 'numberOfRows', jsonInt(rows.length))
          root = setMember(root, 'numberOfColumns', jsonInt(columns))
          updates.set(`${base}/content.json`, encodeUtf8(printJson({ ...content, root })))
        }
      }
    }

    // 3. A fresh revision token for this table only. Regenerating tokens for
    //    untouched tables would make every save look like a whole-file change.
    updates.set(`${base}/data.dt`, encodeUtf8(token()))

    // 4. Derived statistics on each affected column.
    const xDataSet = table.xDataSet === undefined ? undefined : bundle.dataSets.get(table.xDataSet)
    if (table.xDataSet !== undefined && xDataSet === undefined) {
      // The column layout depends on what this dataset says, so without it we
      // are placing every Y column by assumption. Say so: the layout falls back
      // to the common case, and a silent guess on the *write* path is how an
      // edit ends up in the wrong column.
      bag.warn(
        'edit/x-dataset-unresolved',
        `data/sets/${table.xDataSet}.json`,
        'the X dataset record is missing, so the column layout assumes it occupies a column',
      )
    }
    const layout = columnLayout(table, xDataSet?.format)
    const touched = new Set(sheetEdits.map((e) => e.column))

    // Row titles and X are datasets too, and they carry the same derived spans
    // and category counts as a Y column. Recomputing only `table.dataSets`
    // leaves them stale the moment someone edits a row label.
    const affected: { uid: string; cols: number[] }[] = []
    if (table.rowTitlesDataSet !== undefined && layout.rowTitleColumn !== undefined) {
      affected.push({ uid: table.rowTitlesDataSet, cols: [layout.rowTitleColumn] })
    }
    if (table.xDataSet !== undefined && layout.xColumn !== undefined) {
      affected.push({ uid: table.xDataSet, cols: [layout.xColumn] })
    }
    table.dataSets.forEach((uid, i) => {
      const start = layout.dataSetStarts[i] ?? 0
      const cols: number[] = []
      for (let k = 0; k < layout.subcolumnsPerDataSet; k++) cols.push(start + k)
      affected.push({ uid, cols })
    })

    for (const { uid, cols } of affected) {
      if (!cols.some((c) => touched.has(c))) continue

      const ds = bundle.dataSets.get(uid)
      if (ds === undefined) continue

      if (getMember(ds.json.root, 'valuesStorageData') !== undefined) {
        bag.warn(
          'edit/formula-column-source-changed',
          `data/sets/${uid}.json`,
          'this column is produced by an in-table formula; its stored values were edited but the formula was left as recorded',
        )
      }

      const next = updateDataSet(ds.json, rows, cols)
      updates.set(`data/sets/${uid}.json`, encodeUtf8(printJson(next)))
    }
  }

  // 5. Document-level identity and timestamp - only if something changed.
  if (anyApplied) {
    const doc = updateDocument(bundle.document.json, opts)
    updates.set('document.json', encodeUtf8(printJson(doc)))
  }

  return { updates, diagnostics: bag.items }
}

/** The parsed content.json for a table, if the archive has one. */
function contentJsonFor(bundle: PrismBundle, base: string): JsonDocument | undefined {
  const entry = bundle.archive.entries.find((x) => x.name === `${base}/content.json`)
  if (entry === undefined) return undefined
  const content = readEntry(entry)
  if (content.diagnostics.some((d) => d.severity === 'error')) return undefined
  const { value } = parseJson(decodeUtf8(content.value), `${base}/content.json`)
  return value
}

/** Recomputes only the fields Prism actually keeps in step with the data. */
function updateDataSet(
  doc: JsonDocument,
  rows: readonly (readonly string[])[],
  columns: readonly number[],
): JsonDocument {
  const root = doc.root
  if (root.kind !== 'object') return doc

  // The span is the union across the dataset's subcolumns, not per subcolumn.
  let firstRow = -1
  let lastRow = -1
  for (let r = 0; r < rows.length; r++) {
    let nonEmpty = false
    for (const c of columns) {
      if ((rows[r]?.[c] ?? '') !== '') {
        nonEmpty = true
        break
      }
    }
    if (!nonEmpty) continue
    if (firstRow < 0) firstRow = r
    lastRow = r
  }

  let next: JsonObject = root

  const replicates = getMember(root, 'replicates')
  if (replicates?.kind === 'array') {
    const items = replicates.items.map((item) => {
      if (item.kind !== 'object') return item
      let r: JsonObject = item
      if (getMember(item, 'firstRow') !== undefined) r = setMember(r, 'firstRow', jsonInt(firstRow))
      if (getMember(item, 'lastRow') !== undefined) r = setMember(r, 'lastRow', jsonInt(lastRow))
      return r as JsonNode
    })
    next = setMember(next, 'replicates', { kind: 'array', items })
  }

  const categories = getMember(root, 'categories')
  if (categories?.kind === 'array') {
    const items = categories.items.map((item) => {
      if (item.kind !== 'object') return item
      const nameNode = getMember(item, 'name')
      const name = nameNode?.kind === 'scalar' ? String(nameNode.value) : undefined
      if (name === undefined) return item
      let count = 0
      let first = -1
      for (let r = 0; r < rows.length; r++) {
        for (const c of columns) {
          if ((rows[r]?.[c] ?? '') === name) {
            count++
            if (first < 0) first = r
          }
        }
      }
      let cat: JsonObject = item
      if (getMember(item, 'usageCount') !== undefined) {
        cat = setMember(cat, 'usageCount', jsonInt(count))
      }
      if (getMember(item, 'firstRowIndex') !== undefined) {
        cat = setMember(cat, 'firstRowIndex', jsonInt(first))
      }
      return cat as JsonNode
    })
    next = setMember(next, 'categories', { kind: 'array', items })
  }

  return { ...doc, root: next }
}

function updateDocument(doc: JsonDocument, opts: EditOptions): JsonDocument {
  const root = doc.root
  if (root.kind !== 'object') return doc
  const id = opts.identity ?? DEFAULT_IDENTITY

  let next: JsonObject = root
  if (getMember(root, 'modifiedBy') !== undefined) {
    next = setMember(next, 'modifiedBy', {
      kind: 'object',
      members: [
        { keyRaw: '"name"', key: 'name', value: jsonString(id.name) },
        { keyRaw: '"user"', key: 'user', value: jsonString(id.user) },
        { keyRaw: '"version"', key: 'version', value: jsonString(id.version) },
        { keyRaw: '"platform"', key: 'platform', value: jsonString(id.platform) },
      ],
    })
  }
  if (opts.modificationDate !== undefined && getMember(root, 'modificationDate') !== undefined) {
    next = setMember(next, 'modificationDate', jsonString(opts.modificationDate))
  }
  return { ...doc, root: next }
}

/**
 * Strips the identity of whoever saved the file.
 *
 * `createdBy.user` and `modifiedBy.user` hold an OS account name and are
 * present in every document examined; one shipped sample carries a full
 * personal name. Anyone publishing a Prism file as supplementary material
 * probably does not intend to publish that too.
 */
export function anonymizeBundle(bundle: PrismBundle): ReadonlyMap<string, Uint8Array> {
  const root = bundle.document.json.root
  if (root.kind !== 'object') return new Map()

  let next: JsonObject = root
  for (const key of ['createdBy', 'modifiedBy']) {
    const node = getMember(root, key)
    if (node?.kind !== 'object') continue
    next = setMember(next, key, setMember(node, 'user', jsonString('')))
  }

  return new Map([
    ['document.json', encodeUtf8(printJson({ ...bundle.document.json, root: next }))],
  ])
}

/** Parses CSV text into the row model, for callers building edits by hand. */
export function tableRowsFromCsv(text: string): readonly (readonly string[])[] {
  return parseCsv(text).rows
}

export type { DataTable }
