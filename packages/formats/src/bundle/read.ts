import {
  asNumber,
  asString,
  type Diagnostic,
  DiagnosticBag,
  decodeUtf8,
  getMember,
  type JsonDocument,
  type ParseResult,
  parseCsv,
  parseJson,
  type ReadZipOptions,
  readEntry,
  readZip,
  stringArray,
  type ZipArchive,
  type ZipEntry,
} from '@prismbinder/core'
import type {
  AnalysisSheet,
  BundleDocument,
  BundleIdentity,
  DataSet,
  DataSheet,
  DataTable,
  GraphSheet,
  PrismBundle,
  SimpleSheet,
} from './types.js'

/** Entry paths we understand. Anything else is carried through untouched. */
const RE_DATA_SHEET = /^data\/sheets\/([^/]+)\/sheet\.json$/
const RE_DATA_SET = /^data\/sets\/([^/]+)\.json$/
const RE_TABLE_CONTENT = /^data\/tables\/([^/]+)\/content\.json$/
const RE_ANALYSIS_SHEET = /^analyses\/([^/]+)\/sheet\.json$/
const RE_GRAPH_SHEET = /^graphs\/([^/]+)\/sheet\.json$/
const RE_INFO_SHEET = /^info\/([^/]+)\/sheet\.json$/
const RE_LAYOUT_SHEET = /^layouts\/([^/]+)\/sheet\.json$/

const MODELLED = [
  RE_DATA_SHEET,
  RE_DATA_SET,
  RE_TABLE_CONTENT,
  RE_ANALYSIS_SHEET,
  RE_GRAPH_SHEET,
  RE_INFO_SHEET,
  RE_LAYOUT_SHEET,
]

export interface ReadBundleOptions extends ReadZipOptions {}

interface Ctx {
  readonly archive: ZipArchive
  readonly bag: DiagnosticBag
  readonly byName: ReadonlyMap<string, ZipEntry>
}

function text(ctx: Ctx, name: string): string | undefined {
  const e = ctx.byName.get(name)
  if (e === undefined) return undefined
  try {
    // A refused entry - a bomb, a CRC failure - reports through diagnostics
    // rather than throwing, so its verdict has to be carried, not discarded.
    const { value, diagnostics } = readEntry(e)
    for (const d of diagnostics) ctx.bag.add(d)
    if (diagnostics.some((d) => d.severity === 'error')) return undefined
    return decodeUtf8(value)
  } catch (err) {
    ctx.bag.error('bundle/entry-unreadable', name, 'entry could not be decompressed', err)
    return undefined
  }
}

function json(ctx: Ctx, name: string): JsonDocument | undefined {
  const t = text(ctx, name)
  if (t === undefined) return undefined
  const { value, diagnostics } = parseJson(t, name)
  for (const d of diagnostics) ctx.bag.add(d)
  return value
}

function identity(doc: JsonDocument, key: string): BundleIdentity | undefined {
  const node = getMember(doc.root, key)
  if (node?.kind !== 'object') return undefined
  return {
    name: asString(getMember(node, 'name')) ?? '',
    user: asString(getMember(node, 'user')) ?? '',
    version: asString(getMember(node, 'version')) ?? '',
    platform: asString(getMember(node, 'platform')) ?? '',
  }
}

function readDocument(ctx: Ctx): BundleDocument | undefined {
  const doc = json(ctx, 'document.json')
  if (doc === undefined) {
    ctx.bag.error('bundle/no-document', 'document.json', 'archive has no document.json')
    return undefined
  }

  const sheets = new Map<string, readonly string[]>()
  const sheetsNode = getMember(doc.root, 'sheets')
  if (sheetsNode?.kind === 'object') {
    for (const m of sheetsNode.members) sheets.set(m.key, stringArray(m.value))
  }

  const sheetTitles = new Map<string, string>()
  const attrs = getMember(doc.root, 'sheetAttributesMap')
  if (attrs?.kind === 'object') {
    for (const m of attrs.members) {
      const title = asString(getMember(m.value, 'title'))
      if (title !== undefined) sheetTitles.set(m.key, title)
    }
  }

  const version = {
    formatVersion: asString(getMember(doc.root, 'formatVersion')) ?? '',
    minFormatVersion: asString(getMember(doc.root, 'minFormatVersion')) ?? '',
    minPrismVersion: asString(getMember(doc.root, 'minPrismVersion')) ?? '',
  }
  if (version.formatVersion === '') {
    ctx.bag.warn(
      'bundle/no-format-version',
      'document.json',
      'document.json declares no formatVersion',
    )
  }

  return {
    json: doc,
    version,
    createdBy: identity(doc, 'createdBy'),
    modifiedBy: identity(doc, 'modifiedBy'),
    creationDate: asString(getMember(doc.root, 'creationDate')),
    modificationDate: asString(getMember(doc.root, 'modificationDate')),
    sheets,
    sheetTitles,
  }
}

function readTable(ctx: Ctx, sheetJson: JsonDocument, sheetName: string): DataTable | undefined {
  const tableNode = getMember(sheetJson.root, 'table')
  if (tableNode?.kind !== 'object') return undefined
  const uid = asString(getMember(tableNode, 'uid'))
  if (uid === undefined) {
    ctx.bag.warn('bundle/table-no-uid', sheetName, 'data sheet has a table with no uid')
    return undefined
  }

  const content = json(ctx, `data/tables/${uid}/content.json`)
  const csvText = text(ctx, `data/tables/${uid}/data.csv`)
  if (content === undefined || csvText === undefined) {
    ctx.bag.warn(
      'bundle/table-missing-storage',
      `data/tables/${uid}`,
      'table has no content.json or data.csv',
    )
  }

  const declaredRows =
    content !== undefined ? (asNumber(getMember(content.root, 'numberOfRows')) ?? 0) : 0
  const declaredColumns =
    content !== undefined ? (asNumber(getMember(content.root, 'numberOfColumns')) ?? 0) : 0
  const rows = csvText !== undefined ? parseCsv(csvText).rows : []

  if (csvText !== undefined && content !== undefined && rows.length !== declaredRows) {
    // The invariant a writer has to maintain when rows are added or removed.
    ctx.bag.warn(
      'bundle/row-count-mismatch',
      `data/tables/${uid}`,
      `content.json says ${declaredRows} rows but data.csv has ${rows.length}`,
    )
  }

  return {
    uid,
    format: asString(getMember(tableNode, 'format')) ?? 'undefined',
    dataFormat: asString(getMember(tableNode, 'dataFormat')) ?? 'y_single',
    replicatesCount: asNumber(getMember(tableNode, 'replicatesCount')),
    rowTitlesDataSet: asString(getMember(tableNode, 'rowTitlesDataSet')),
    subcolumnTitlesDataSet: asString(getMember(tableNode, 'subcolumnTitlesDataSet')),
    xDataSet: asString(getMember(tableNode, 'xDataSet')),
    dataSets: stringArray(getMember(tableNode, 'dataSets')),
    declaredRows,
    declaredColumns,
    rows,
  }
}

/**
 * Parses a bundle.
 *
 * Nothing here throws because of file content. A graph directory with no
 * `sheet.json` exists in the wild - `Wine.prismt` has two, referenced from
 * nowhere - so iterating directories and assuming a sibling is present would
 * crash on a file Prism itself opens happily.
 */
export function readBundle(
  bytes: Uint8Array,
  opts: ReadBundleOptions = {},
): ParseResult<PrismBundle | undefined> {
  const bag = new DiagnosticBag()
  const zip = readZip(bytes, opts)
  for (const d of zip.diagnostics) bag.add(d)

  const archive = zip.value
  const byName = new Map(archive.entries.map((e) => [e.name, e]))
  const ctx: Ctx = { archive, bag, byName }

  const document = readDocument(ctx)
  if (document === undefined) return bag.result(undefined)

  const dataSets = new Map<string, DataSet>()
  const dataSheets: DataSheet[] = []
  const analyses: AnalysisSheet[] = []
  const graphs: GraphSheet[] = []
  const infoSheets: SimpleSheet[] = []
  const layoutSheets: SimpleSheet[] = []

  for (const entry of archive.entries) {
    if (entry.isDirectory) continue
    const name = entry.name

    let m = RE_DATA_SET.exec(name)
    if (m !== null) {
      const doc = json(ctx, name)
      if (doc === undefined) continue
      const uid = asString(getMember(doc.root, 'uid')) ?? (m[1] as string)
      dataSets.set(uid, {
        uid,
        title: asString(getMember(doc.root, 'title')),
        format: asString(getMember(doc.root, 'format')) ?? 'y_single',
        json: doc,
      })
      continue
    }

    m = RE_DATA_SHEET.exec(name)
    if (m !== null) {
      const doc = json(ctx, name)
      if (doc === undefined) continue
      const uid = asString(getMember(doc.root, 'uid')) ?? (m[1] as string)
      dataSheets.push({
        uid,
        title: asString(getMember(doc.root, 'title')) ?? document.sheetTitles.get(uid),
        json: doc,
        table: readTable(ctx, doc, name),
      })
      continue
    }

    m = RE_ANALYSIS_SHEET.exec(name)
    if (m !== null) {
      const doc = json(ctx, name)
      if (doc === undefined) continue
      const id = m[1] as string
      const uid = asString(getMember(doc.root, 'uid')) ?? id
      analyses.push({
        uid,
        title: asString(getMember(doc.root, 'title')) ?? document.sheetTitles.get(uid),
        analysisClass: asString(getMember(doc.root, 'analysisClass')),
        json: doc,
        parameters: json(ctx, `analyses/${id}/parameters.json`),
        results: json(ctx, `analyses/${id}/results.json`),
        inputDataSets: refIds(getMember(doc.root, 'inputDataSets')),
        inputSheets: refIds(getMember(doc.root, 'inputSheets')),
      })
      continue
    }

    m = RE_GRAPH_SHEET.exec(name)
    if (m !== null) {
      const doc = json(ctx, name)
      if (doc === undefined) continue
      const id = m[1] as string
      const uid = asString(getMember(doc.root, 'uid')) ?? id
      graphs.push({
        uid,
        title: asString(getMember(doc.root, 'title')) ?? document.sheetTitles.get(uid),
        json: doc,
        hasBinary: byName.has(`graphs/${id}/data.bin`),
        inputDataSets: stringArray(getMember(doc.root, 'inputDataSets')),
      })
      continue
    }

    m = RE_INFO_SHEET.exec(name)
    if (m !== null) {
      const doc = json(ctx, name)
      if (doc !== undefined) infoSheets.push(simpleSheet(doc, m[1] as string, document))
      continue
    }

    m = RE_LAYOUT_SHEET.exec(name)
    if (m !== null) {
      const doc = json(ctx, name)
      if (doc !== undefined) layoutSheets.push(simpleSheet(doc, m[1] as string, document))
      continue
    }
  }

  // Graph directories with no sheet.json, referenced from nowhere. Real files
  // contain these; they are carried as opaque rather than treated as an error.
  for (const entry of archive.entries) {
    const orphan = /^graphs\/([^/]+)\/data\.bin$/.exec(entry.name)
    if (orphan !== null && !byName.has(`graphs/${orphan[1]}/sheet.json`)) {
      bag.info(
        'bundle/orphan-graph',
        entry.name,
        'graph directory has no sheet.json and is referenced from nowhere; carried through verbatim',
      )
    }
  }

  const opaqueEntries = archive.entries
    .filter((e) => !e.isDirectory && e.name !== 'document.json')
    .filter((e) => !MODELLED.some((re) => re.test(e.name)))
    .filter((e) => !/^data\/tables\/[^/]+\/(data\.csv|data\.dt)$/.test(e.name))
    .filter((e) => !/^analyses\/[^/]+\/(parameters|results)\.json$/.test(e.name))
    .map((e) => e.name)

  return bag.result({
    archive,
    document,
    dataSheets,
    dataSets,
    analyses,
    graphs,
    infoSheets,
    layoutSheets,
    opaqueEntries,
  })
}

function simpleSheet(doc: JsonDocument, id: string, document: BundleDocument): SimpleSheet {
  const uid = asString(getMember(doc.root, 'uid')) ?? id
  return {
    uid,
    title: asString(getMember(doc.root, 'title')) ?? document.sheetTitles.get(uid),
    json: doc,
  }
}

/** `inputDataSets` is sometimes a list of ids and sometimes a list of `{uid, title}`. */
function refIds(node: ReturnType<typeof getMember>): string[] {
  if (node?.kind !== 'array') return []
  const out: string[] = []
  for (const item of node.items) {
    if (item.kind === 'scalar' && typeof item.value === 'string') out.push(item.value)
    else {
      const uid = asString(getMember(item, 'uid'))
      if (uid !== undefined) out.push(uid)
    }
  }
  return out
}

export type { Diagnostic }
