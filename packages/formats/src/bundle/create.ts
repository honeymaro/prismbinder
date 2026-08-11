import {
  crc32,
  deflateRaw,
  encodeUtf8,
  formatForEntry,
  jsonArray,
  jsonInt,
  jsonObject,
  jsonString,
  printCsv,
  printJson,
  writeZip,
  type ZipArchive,
  type ZipEntry,
  type ZipEntryMeta,
} from '@prismbinder/core'

/**
 * Building a bundle from nothing.
 *
 * Every value here is taken from the documented format rather than invented -
 * see docs/format/README.md. The ZIP metadata profile in particular is not
 * cosmetic: Prism writes three specific header shapes, including an
 * `extractVersion` of 45 on the `data/tables/` subtree that does *not* carry a
 * ZIP64 extra field, and this reproduces them exactly.
 *
 * What is still unverified is whether Prism opens the result. The corpus told
 * us what a Prism-written file looks like; it cannot tell us which parts Prism
 * requires. Until a generated file has been opened in Prism, treat this as
 * provisional and prefer `rewrite` on an existing document.
 */

export interface CreateColumn {
  readonly title: string
  /** Cell text, one per row. Strings, because that is what the format stores. */
  readonly cells: readonly string[]
}

export interface CreateTable {
  readonly title: string
  readonly columns: readonly CreateColumn[]
  /** Optional row labels, written as the leading CSV column. */
  readonly rowTitles?: readonly string[]
  /**
   * Optional X column.
   *
   * Present or absent changes the table's identity, not just its contents: with
   * an X the sheet is an `XYDataTable` in `xy` format, without one it is a
   * plain `column` table. Dropping an X column into a Y slot would silently
   * turn an XY dataset into four unrelated columns.
   */
  readonly xColumn?: CreateColumn
}

export interface CreateOptions {
  readonly tables: readonly CreateTable[]
  /**
   * Declared format version.
   *
   * Defaults to the oldest floor seen in a real document rather than the
   * newest, so the result opens in as many Prism versions as possible.
   */
  readonly formatVersion?: string
  readonly minFormatVersion?: string
  readonly minPrismVersion?: string
  readonly creationDate?: string
  /** Deterministic ids, for tests. */
  readonly newId?: () => string
  readonly newToken?: () => string
}

const CREATE_VERSION = 0x033f // Unix host, spec 6.3 - what Prism writes
const EXTRACT_DEFAULT = 20
const EXTRACT_TABLES = 45 // on data/tables/*, with no ZIP64 extra field
const FLAG_FILE = 0x4 // "fast" compression, per APPNOTE 4.4.4
const ATTR_DIR = 0x41ff0000
const ATTR_FILE = 0x81b60000

/** A member that is written only when the id exists. */
function optional(key: string, id: string | undefined): [string, ReturnType<typeof jsonString>][] {
  return id === undefined ? [] : [[key, jsonString(id)]]
}

/**
 * The rows a column actually occupies, ignoring blank padding.
 *
 * A CSV is a rectangle, so a short column is padded to the table's height. The
 * span records where the *data* is, which is not the same thing - and `edit.ts`
 * computes it per column. Writing the table-wide row count here instead would
 * make a file disagree with itself the first time it was edited, with no cell
 * having changed.
 */
function nonBlankSpan(cells: readonly string[]): { firstRow: number; lastRow: number } {
  let firstRow = -1
  let lastRow = -1
  for (let r = 0; r < cells.length; r++) {
    if (cells[r] !== '') {
      if (firstRow < 0) firstRow = r
      lastRow = r
    }
  }
  return { firstRow, lastRow }
}

/** Prism records a column's type; the corpus uses `real` for numeric columns. */
function valueTypeOf(cells: readonly string[]): string {
  const filled = cells.filter((c) => c !== '')
  if (filled.length === 0) return 'string'
  return filled.every((c) => Number.isFinite(Number(c))) ? 'real' : 'string'
}

function uuid(): string {
  return crypto.randomUUID().toUpperCase()
}

function token(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** DOS date/time for a timestamp. */
function dosStamp(d: Date): { dosTime: number; dosDate: number } {
  return {
    dosTime: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    dosDate: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  }
}

interface Builder {
  readonly entries: ZipEntry[]
  readonly stamp: { dosTime: number; dosDate: number }
}

function meta(
  b: Builder,
  isDir: boolean,
  content: Uint8Array,
  stored: Uint8Array,
  extractVersion: number,
): ZipEntryMeta {
  return {
    createVersion: CREATE_VERSION,
    extractVersion,
    localExtractVersion: extractVersion,
    flag: isDir ? 0 : FLAG_FILE,
    method: isDir ? 0 : 8,
    dosTime: b.stamp.dosTime,
    dosDate: b.stamp.dosDate,
    crc32: crc32(content),
    compressedSize: stored.length,
    uncompressedSize: content.length,
    internalAttrs: 0,
    externalAttrs: isDir ? ATTR_DIR : ATTR_FILE,
    diskStart: 0,
    extraCentral: new Uint8Array(0),
    extraLocal: new Uint8Array(0),
    comment: new Uint8Array(0),
  }
}

function addDir(b: Builder, name: string): void {
  const empty = new Uint8Array(0)
  b.entries.push({
    name,
    isDirectory: true,
    meta: meta(b, true, empty, empty, EXTRACT_DEFAULT),
    stored: empty,
  })
}

function addFile(b: Builder, name: string, text: string): void {
  const content = encodeUtf8(text)
  const stored = deflateRaw(content)
  const version = /^data\/tables\//.test(name) ? EXTRACT_TABLES : EXTRACT_DEFAULT
  b.entries.push({
    name,
    isDirectory: false,
    meta: meta(b, false, content, stored, version),
    stored,
  })
}

export function createBundle(opts: CreateOptions): Uint8Array {
  const newId = opts.newId ?? uuid
  const newToken = opts.newToken ?? token
  const created = opts.creationDate ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const b: Builder = { entries: [], stamp: dosStamp(new Date()) }

  const sheetIds: string[] = []
  const sheetTitles: [string, string][] = []

  // Section order follows what Prism writes: data first, then document.json,
  // then the table payloads. Order is stable in every archive we have seen and
  // nothing proves it is ignored, so it is reproduced rather than invented.
  addDir(b, 'data/')
  addDir(b, 'data/sets/')
  addDir(b, 'data/sheets/')

  interface Pending {
    readonly tableId: string
    readonly csv: string
    readonly rows: number
    readonly columns: number
  }
  const pending: Pending[] = []

  for (const table of opts.tables) {
    const sheetId = newId()
    const tableId = newId()
    sheetIds.push(sheetId)
    sheetTitles.push([sheetId, table.title])

    const rowCount = Math.max(
      table.rowTitles?.length ?? 0,
      table.xColumn?.cells.length ?? 0,
      ...table.columns.map((c) => c.cells.length),
    )
    const hasRowTitles = table.rowTitles !== undefined
    const hasX = table.xColumn !== undefined

    const rowTitleSetId = hasRowTitles ? newId() : undefined
    const xSetId = hasX ? newId() : undefined
    const dataSetIds = table.columns.map(() => newId())

    // One data/sets record per column. The count caches Prism keeps here are
    // written as zero: 149 records in the corpus do exactly that over columns
    // full of numbers, and Prism opens them without complaint, so zero is a
    // value it demonstrably accepts rather than a guess.
    const writeSet = (id: string, title: string, attr: string, cells: readonly string[]): void => {
      addFile(
        b,
        `data/sets/${id}.json`,
        printJson({
          format: formatForEntry(`data/sets/${id}.json`),
          root: jsonObject([
            ['@class', jsonString('DataSet')],
            ['$id', jsonString('sheets/data_sheet/data_table/data_set.schema.json')],
            ['uid', jsonString(id)],
            ['fenID', jsonInt(0)],
            ['format', jsonString('y_single')],
            ['title', jsonString(title)],
            ['attributes', jsonArray([jsonString(attr)])],
            [
              'replicates',
              jsonArray([
                jsonObject([
                  ['@class', jsonString('DriverReplicate')],
                  ['valueType', jsonString(valueTypeOf(cells))],
                  ['decimalsLength', jsonInt(15)],
                  ['significantDigitsCount', jsonInt(7)],
                  ['firstRow', jsonInt(nonBlankSpan(cells).firstRow)],
                  ['lastRow', jsonInt(nonBlankSpan(cells).lastRow)],
                ]),
              ]),
            ],
          ]),
        }),
      )
    }

    if (rowTitleSetId !== undefined) {
      writeSet(rowTitleSetId, '', 'DS_ATTR_RT', table.rowTitles ?? [])
    }
    if (xSetId !== undefined) {
      writeSet(xSetId, table.xColumn?.title ?? '', 'DS_ATTR_X', table.xColumn?.cells ?? [])
    }
    table.columns.forEach((c, i) =>
      writeSet(dataSetIds[i] as string, c.title, 'DS_ATTR_Y', c.cells),
    )

    addDir(b, `data/sheets/${sheetId}/`)
    addFile(
      b,
      `data/sheets/${sheetId}/sheet.json`,
      printJson({
        format: formatForEntry('sheet.json'),
        root: jsonObject([
          ['@class', jsonString('DataSheet')],
          ['$id', jsonString('sheets/data_sheet/data_sheet.schema.json')],
          ['uid', jsonString(sheetId)],
          ['fenID', jsonInt(0)],
          ['title', jsonString(table.title)],
          [
            'table',
            jsonObject([
              ['@class', jsonString(hasX ? 'XYDataTable' : 'DataTable')],
              ['$id', jsonString('sheets/data_sheet/data_table/data_table.schema.json')],
              ['uid', jsonString(tableId)],
              ['format', jsonString(hasX ? 'xy' : 'column')],
              ['dataFormat', jsonString('y_single')],
              ...optional('rowTitlesDataSet', rowTitleSetId),
              ...optional('xDataSet', xSetId),
              ['dataSets', jsonArray(dataSetIds.map(jsonString))],
            ]),
          ],
          [
            'font',
            jsonObject([
              ['family', jsonString('Arial')],
              ['size', jsonInt(10)],
            ]),
          ],
          ['maxDataSets', jsonInt(2048)],
          ['maxRow', jsonInt(500000)],
        ]),
      }),
    )

    // Column order: row titles, then X, then each dataset - the F17 layout.
    const rows: string[][] = []
    for (let r = 0; r < rowCount; r++) {
      const row: string[] = []
      if (hasRowTitles) row.push(table.rowTitles?.[r] ?? '')
      if (hasX) row.push(table.xColumn?.cells[r] ?? '')
      for (const c of table.columns) row.push(c.cells[r] ?? '')
      rows.push(row)
    }
    pending.push({
      tableId,
      csv: printCsv({ rows }),
      rows: rowCount,
      columns: (hasRowTitles ? 1 : 0) + (hasX ? 1 : 0) + table.columns.length,
    })
  }

  addFile(
    b,
    'document.json',
    printJson({
      format: formatForEntry('document.json'),
      root: jsonObject([
        ['@class', jsonString('Document')],
        ['$id', jsonString('document.schema.json')],
        ['creationDate', jsonString(created)],
        ['modificationDate', jsonString(created)],
        ['createdBy', identity()],
        ['modifiedBy', identity()],
        ['formatVersion', jsonString(opts.formatVersion ?? '1-6-0')],
        ['minFormatVersion', jsonString(opts.minFormatVersion ?? '1-2-0')],
        ['minPrismVersion', jsonString(opts.minPrismVersion ?? '10.1.0')],
        [
          'compatibility',
          jsonArray([
            jsonObject([
              ['formatVersion', jsonString('1-0-0')],
              ['action', jsonString('warningOpen')],
            ]),
          ]),
        ],
        ['sheets', jsonObject([['data', jsonArray(sheetIds.map(jsonString))]])],
        [
          'uiSettings',
          jsonObject([
            ['currentSheetType', jsonString('Data')],
            ['viewMode', jsonString('sheet')],
            ['nextDataSheetNumber', jsonInt(opts.tables.length + 1)],
          ]),
        ],
        [
          'sheetAttributesMap',
          jsonObject(sheetTitles.map(([id, t]) => [id, jsonObject([['title', jsonString(t)]])])),
        ],
      ]),
    }),
  )

  addDir(b, 'data/tables/')
  for (const p of pending) {
    addDir(b, `data/tables/${p.tableId}/`)
    addFile(
      b,
      `data/tables/${p.tableId}/content.json`,
      printJson({
        format: formatForEntry(`data/tables/${p.tableId}/content.json`),
        root: jsonObject([
          ['$id', jsonString('sheets/data_sheet/data_table/data_table_storage.schema.json')],
          ['numberOfColumns', jsonInt(p.columns)],
          ['numberOfRows', jsonInt(p.rows)],
          ['version', jsonInt(1)],
        ]),
      }),
    )
    addFile(b, `data/tables/${p.tableId}/data.csv`, p.csv)
    addFile(b, `data/tables/${p.tableId}/data.dt`, newToken())
  }

  const archive: ZipArchive = { entries: b.entries, comment: new Uint8Array(0) }
  return writeZip(archive)
}

/**
 * We identify ourselves, and leave the user field empty.
 *
 * Prism records the OS account name of whoever saved the file. Copying that
 * habit would put a real person's name into every document this produces.
 */
function identity() {
  return jsonObject([
    ['name', jsonString('prismbinder')],
    ['user', jsonString('')],
    ['version', jsonString('0.0.0')],
    ['platform', jsonString('web')],
  ])
}
