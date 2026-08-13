import {
  asNumber,
  asString,
  type Diagnostic,
  DiagnosticBag,
  decodeUtf8,
  getMember,
  type JsonDocument,
  type JsonNode,
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
import { isPcffGraph, type PcffAxis, pcffGraph } from '../pcff/index.js'
import type {
  AnalysisSheet,
  AxisSegment,
  BundleDocument,
  BundleIdentity,
  CellFlagRange,
  DataSet,
  DataSetSeries,
  DataSheet,
  DataTable,
  GraphSheet,
  MvFigure,
  MvGraph,
  PrismBundle,
  SimpleSheet,
} from './types.js'

/**
 * The axes Prism drew, where the graph binary states them.
 *
 * Only the axis chunk is read; the rest of the blob is stepped over and
 * carried through untouched, as it always was. A graph whose binary is absent,
 * is not `PCFFGRA4`, or whose chunk framing does not hold simply reports no
 * axes, and the chart above falls back to bounds derived from the data.
 */
function graphFacts(
  ctx: Ctx,
  id: string,
): { axes: readonly PcffAxis[] | undefined; graphType: number | undefined } {
  // Once. Reading the axes and the kind separately inflated the same entry
  // twice and walked the whole blob twice, for every graph in the document.
  const raw = bytes(ctx, `graphs/${id}/data.bin`)
  if (raw === undefined || !isPcffGraph(raw)) return { axes: undefined, graphType: undefined }
  const { axes, graphType } = pcffGraph(raw)
  return { axes: axes.length === 0 ? undefined : axes, graphType }
}

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

/** An entry's inflated bytes, or nothing if it could not be read. */
function bytes(ctx: Ctx, name: string): Uint8Array | undefined {
  const e = ctx.byName.get(name)
  if (e === undefined) return undefined
  try {
    const { value, diagnostics } = readEntry(e)
    for (const d of diagnostics) ctx.bag.add(d)
    if (diagnostics.some((d) => d.severity === 'error')) return undefined
    return value
  } catch (err) {
    ctx.bag.error('bundle/entry-unreadable', name, 'entry could not be decompressed', err)
    return undefined
  }
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

/**
 * `"34"` is one row; `"0~1"` is rows 0 through 1, inclusive at both ends.
 *
 * Matched rather than coerced. `Number("")` is `0`, not `NaN`, so handing the
 * conversion an empty segment turns a truncated `rows` field into a confident
 * claim about row 0 - `""`, `"~5"` and `"0~"` all used to parse. The corpus
 * writes plain non-negative decimals and nothing else, so that is the whole
 * grammar.
 */
const ROW_RANGE = /^(\d+)(?:~(\d+))?$/

function parseRowRange(text: string | undefined): readonly [number, number] | undefined {
  if (text === undefined) return undefined
  const m = ROW_RANGE.exec(text)
  if (m === null) return undefined
  const first = Number(m[1])
  const last = m[2] === undefined ? first : Number(m[2])
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return undefined
  if (last < first) return undefined
  return [first, last]
}

function readCellFlags(ctx: Ctx, name: string, node: JsonNode | undefined): CellFlagRange[] {
  if (node?.kind !== 'array') return []
  const out: CellFlagRange[] = []
  let unreadable = 0
  for (const item of node.items) {
    if (item.kind !== 'object') continue
    const attributes = stringArray(getMember(item, 'attributes'))
    if (attributes.length === 0) continue
    const span = parseRowRange(asString(getMember(item, 'rows')))
    if (span === undefined) {
      unreadable++
      continue
    }
    out.push({ firstRow: span[0], lastRow: span[1], attributes })
  }
  if (unreadable > 0) {
    // Dropping one of these downgrades an excluded value to an ordinary one,
    // which is the failure this whole path exists to prevent.
    ctx.bag.warn(
      'bundle/unreadable-cell-range',
      name,
      `${unreadable} cell attribute range(s) name rows in a form we do not recognise and were ignored`,
    )
  }
  return out
}

/**
 * Reads the parts of a dataset record that the CSV cannot express.
 *
 * Two of them. A `SeriesReplicate` describes an X column Prism generates and
 * never writes, and `cellAttributes` marks individual rows as excluded or
 * censored. Both are invisible in the data the table stores, and both change
 * what the numbers mean.
 */
function readReplicates(
  ctx: Ctx,
  name: string,
  doc: JsonDocument,
): {
  series: DataSetSeries | undefined
  cellFlags: (readonly CellFlagRange[])[]
} {
  const node = getMember(doc.root, 'replicates')
  if (node?.kind !== 'array') return { series: undefined, cellFlags: [] }

  let series: DataSetSeries | undefined
  const cellFlags: (readonly CellFlagRange[])[] = []

  for (const rep of node.items) {
    if (rep.kind !== 'object') {
      cellFlags.push([])
      continue
    }
    if (series === undefined && asString(getMember(rep, '@class')) === 'SeriesReplicate') {
      const startValue = asNumber(getMember(rep, 'startValue'))
      const interval = asNumber(getMember(rep, 'interval'))
      if (startValue !== undefined && interval !== undefined) series = { startValue, interval }
    }
    cellFlags.push(readCellFlags(ctx, name, getMember(rep, 'cellAttributes')))
  }

  return { series, cellFlags }
}

/**
 * Reads a Multiple Variables graph, which states its own appearance.
 *
 * Every other graph family keeps its geometry in the PCFF blob and this returns
 * `undefined` for them - not because we gave up, but because there is nothing
 * in their JSON to read: a `FENGraphSheet` holds a uid, a title and a list of
 * inputs, and no axis, limit, symbol or colour setting at all.
 */
function readMvGraph(doc: JsonDocument): MvGraph | undefined {
  const graph = getMember(doc.root, 'graph')
  if (graph?.kind !== 'object') return undefined
  if (asString(getMember(graph, '@class')) !== 'MVGraph') return undefined

  const settings = getMember(graph, 'gdoSettingsExt')
  const kinds = stringArray(at(getMember(graph, 'gdoTypesExt'), 'defaults'))
  const figures: MvFigure[] = []
  for (const kind of kinds) {
    const node = settings?.kind === 'object' ? getMember(settings, kind) : undefined
    const colormap = at(node, 'colormap')
    figures.push({
      kind,
      colorScheme: asString(at(colormap, 'colorScheme')) ?? asString(at(colormap, 'colorSchemeID')),
      branchesLink: asString(at(node, 'branchesLink')),
      clustersLink: asString(at(node, 'clustersLink')),
    })
  }

  return {
    dataSheet: asString(getMember(graph, 'dataSheet')),
    figures,
    axisX: readAxisSegment(getMember(graph, 'axisX')),
    axisY: readAxisSegment(getMember(graph, 'axisY')),
  }
}

/**
 * The first segment of an axis.
 *
 * Prism allows several, for a broken axis; the corpus only ever uses one. A
 * categorical segment lives in `segments_ext` beside an empty linear one, which
 * is how a heat map says its axis names rows rather than measuring them.
 */
function readAxisSegment(axis: JsonNode | undefined): AxisSegment | undefined {
  if (axis?.kind !== 'object') return undefined
  const linear = first(getMember(axis, 'segments'))
  const ext = first(getMember(axis, 'segments_ext'))
  const categorical = asString(at(ext, '@class')) === 'CategoricalAxisSegment'
  if (linear === undefined && ext === undefined) return undefined
  return {
    lowerLimit: asNumber(at(linear, 'lowerLimit')),
    upperLimit: asNumber(at(linear, 'upperLimit')),
    interval: asNumber(at(linear, 'interval')),
    startTicksValue: asNumber(at(linear, 'startTicksValue')),
    categorical,
  }
}

function first(node: JsonNode | undefined): JsonNode | undefined {
  return node?.kind === 'array' ? node.items[0] : undefined
}

/** `getMember` on something that may not be there. */
function at(node: JsonNode | undefined, key: string): JsonNode | undefined {
  return node === undefined ? undefined : getMember(node, key)
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
      const format = asString(getMember(doc.root, 'format')) ?? 'y_single'
      const { series, cellFlags } = readReplicates(ctx, name, doc)
      if (format === 'series' && series === undefined) {
        // The dataset claims to occupy no column *and* withholds the numbers
        // needed to rebuild one, which leaves the X values unrecoverable.
        bag.warn(
          'bundle/series-without-parameters',
          name,
          'dataset is a generated series but records no startValue and interval, so its values cannot be rebuilt',
        )
      }
      dataSets.set(uid, {
        uid,
        title: asString(getMember(doc.root, 'title')),
        format,
        series,
        cellFlags,
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
        resultSheets: resultSheets(ctx, id, getMember(doc.root, 'resultSheets')),
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
        mv: readMvGraph(doc),
        ...graphFacts(ctx, id),
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

/**
 * The result views of one analysis, each resolved to the sheet holding it.
 *
 * The analysis sheet lists a view's own uid, which matches no data sheet. The
 * `AnalysisView` record beside it carries `dataSheet`, and that is the uid a
 * caller can actually look up.
 */
function resultSheets(
  ctx: Ctx,
  analysisId: string,
  node: ReturnType<typeof getMember>,
): { uid: string; title: string; dataSheet: string | undefined }[] {
  if (node?.kind !== 'array') return []
  const out: { uid: string; title: string; dataSheet: string | undefined }[] = []
  for (const item of node.items) {
    const uid = asString(getMember(item, 'uid'))
    if (uid === undefined) continue
    const view = json(ctx, `analyses/${analysisId}/result_sheets/${uid}.json`)
    out.push({
      uid,
      title: asString(getMember(item, 'title')) ?? '',
      dataSheet: view === undefined ? undefined : asString(getMember(view.root, 'dataSheet')),
    })
  }
  return out
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
