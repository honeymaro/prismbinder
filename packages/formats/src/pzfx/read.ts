import {
  childElements,
  DiagnosticBag,
  decodeUtf8,
  findElement,
  localName,
  type ParseResult,
  parseXmlDocument,
  textContent,
  type XmlDocument,
  type XmlElement,
} from '@prismbinder/core'

/**
 * The XML generation: `.pzfx`, and the `.pzt` files that turn out to be XML.
 *
 * Two things about this format regularly trip up naive readers.
 *
 * The default namespace is **optional**: 11 of the 53 XML-shaped documents in
 * the corpus have no `xmlns` on the root, so anything matching on a qualified
 * name fails on a fifth of real files. Every lookup here is by local name.
 *
 * And the data is only half the story. Graphs, analyses and formatting live in
 * a `<Template>` element holding base64 of a zlib stream wrapping the same
 * PCFF binary the modern format keeps in `data.bin`. We carry it and never
 * pretend to understand it. Four of seven `.pzfx` files have no template at
 * all, so its absence is normal rather than a defect.
 */

export interface PzfxVersionStamp {
  readonly createdByProgram: string | undefined
  readonly createdByVersion: string | undefined
  readonly dateTime: string | undefined
  /** The OS account name of whoever saved the file. Present in most documents. */
  readonly login: string | undefined
}

export interface PzfxCell {
  /** Cell text exactly as written. Never converted to a number: see the CSV notes. */
  readonly text: string
  readonly cellType: string | undefined
  /** Display text when the stored value is a category index. */
  readonly userText: string | undefined
  readonly excluded: boolean
}

export interface PzfxSubcolumn {
  readonly title: string | undefined
  readonly cells: readonly PzfxCell[]
}

export type PzfxColumnRole = 'x' | 'xAdvanced' | 'y' | 'rowTitles' | 'subcolumnTitles'

export interface PzfxColumn {
  readonly role: PzfxColumnRole
  readonly title: string | undefined
  readonly width: number | undefined
  readonly decimals: number | undefined
  /** Multi-variable column type. Note Prism spells continuous "Continues". */
  readonly mvType: string | undefined
  /** Ragged by design: 29 of 124 tables have subcolumns of differing lengths. */
  readonly subcolumns: readonly PzfxSubcolumn[]
  readonly categories: readonly { id: string; name: string; usageCount: number }[]
}

export interface PzfxTable {
  readonly id: string | undefined
  readonly title: string | undefined
  readonly tableType: string | undefined
  readonly extTableType: string | undefined
  readonly xFormat: string | undefined
  readonly yFormat: string | undefined
  readonly replicates: number | undefined
  readonly rowTitles: PzfxColumn | undefined
  readonly x: PzfxColumn | undefined
  readonly yColumns: readonly PzfxColumn[]
}

export interface PzfxDocument {
  readonly xml: XmlDocument
  readonly prismXmlVersion: string | undefined
  /** True when the root carries a default namespace; must be preserved on write. */
  readonly hasNamespace: boolean
  readonly originalVersion: PzfxVersionStamp | undefined
  readonly mostRecentVersion: PzfxVersionStamp | undefined
  readonly tables: readonly PzfxTable[]
  readonly infoConstants: readonly { name: string; value: string }[]
  /** Graphs, analyses and formatting, base64+zlib around a PCFF blob. Opaque. */
  readonly hasTemplate: boolean
}

const num = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function versionStamp(el: XmlElement | undefined): PzfxVersionStamp | undefined {
  if (el === undefined) return undefined
  return {
    createdByProgram: el.attributes.get('CreatedByProgram'),
    createdByVersion: el.attributes.get('CreatedByVersion'),
    dateTime: el.attributes.get('DateTime'),
    login: el.attributes.get('Login'),
  }
}

function readSubcolumn(el: XmlElement): PzfxSubcolumn {
  const titleEl = childElements(el, 'Title')[0]
  const cells: PzfxCell[] = []
  for (const d of childElements(el, 'd')) {
    cells.push({
      text: textContent(d),
      cellType: d.attributes.get('CellType'),
      userText: d.attributes.get('UserText'),
      excluded: d.attributes.get('Excluded') === '1',
    })
  }
  return { title: titleEl !== undefined ? textContent(titleEl) : undefined, cells }
}

function readColumn(el: XmlElement, role: PzfxColumnRole): PzfxColumn {
  const titleEl = childElements(el, 'Title')[0]
  const categories: { id: string; name: string; usageCount: number }[] = []
  for (const dict of childElements(el, 'CategoryDictionary')) {
    for (const d of childElements(dict, 'd')) {
      categories.push({
        id: d.attributes.get('id') ?? '',
        name: textContent(d),
        usageCount: num(d.attributes.get('numUsage')) ?? 0,
      })
    }
  }
  return {
    role,
    title: titleEl !== undefined ? textContent(titleEl) : undefined,
    width: num(el.attributes.get('Width')),
    decimals: num(el.attributes.get('Decimals')),
    mvType: el.attributes.get('MVType'),
    subcolumns: childElements(el, 'Subcolumn').map(readSubcolumn),
    categories,
  }
}

function readTable(el: XmlElement): PzfxTable {
  const titleEl = childElements(el, 'Title')[0]
  const rowTitlesEl = childElements(el, 'RowTitlesColumn')[0]
  const xEl = childElements(el, 'XColumn')[0]
  const xAdvancedEl = childElements(el, 'XAdvancedColumn')[0]

  return {
    id: el.attributes.get('ID'),
    title: titleEl !== undefined ? textContent(titleEl) : undefined,
    tableType: el.attributes.get('TableType'),
    extTableType: el.attributes.get('ExtTableType'),
    xFormat: el.attributes.get('XFormat'),
    yFormat: el.attributes.get('YFormat'),
    replicates: num(el.attributes.get('Replicates')),
    rowTitles: rowTitlesEl !== undefined ? readColumn(rowTitlesEl, 'rowTitles') : undefined,
    x:
      xAdvancedEl !== undefined
        ? readColumn(xAdvancedEl, 'xAdvanced')
        : xEl !== undefined
          ? readColumn(xEl, 'x')
          : undefined,
    yColumns: childElements(el, 'YColumn').map((c) => readColumn(c, 'y')),
  }
}

export function readPzfx(bytes: Uint8Array, path = ''): ParseResult<PzfxDocument | undefined> {
  const bag = new DiagnosticBag()
  const text = decodeUtf8(bytes)
  const parsed = parseXmlDocument(text, path)
  for (const d of parsed.diagnostics) bag.add(d)
  if (parsed.diagnostics.some((d) => d.severity === 'error')) return bag.result(undefined)

  const xml = parsed.value

  // Sample data files wrap the document in an XSLT stylesheet so a browser can
  // render them; the Prism payload is a literal result element inside.
  const root =
    localName(xml.root.name) === 'GraphPadPrismFile'
      ? xml.root
      : findElement(xml.root, 'GraphPadPrismFile')

  if (root === undefined) {
    bag.error('pzfx/no-root', path, 'no GraphPadPrismFile element found')
    return bag.result(undefined)
  }

  const created = childElements(root, 'Created')[0]
  const tables = childElements(root, 'Table').map(readTable)
  if (tables.length === 0) {
    bag.info('pzfx/no-tables', path, 'document contains no data tables')
  }

  const infoConstants: { name: string; value: string }[] = []
  for (const info of childElements(root, 'Info')) {
    for (const c of childElements(info, 'Constant')) {
      const nameEl = childElements(c, 'Name')[0]
      const valueEl = childElements(c, 'Value')[0]
      if (nameEl === undefined) continue
      infoConstants.push({
        name: textContent(nameEl),
        value: valueEl !== undefined ? textContent(valueEl) : '',
      })
    }
  }

  const hasTemplate = childElements(root, 'Template').length > 0
  if (hasTemplate) {
    bag.info(
      'pzfx/opaque-template',
      path,
      'graphs, analyses and formatting are inside an opaque <Template> blob and are carried through unread',
    )
  }

  return bag.result({
    xml,
    prismXmlVersion: root.attributes.get('PrismXMLVersion'),
    hasNamespace: root.attributes.has('xmlns'),
    originalVersion: versionStamp(
      created !== undefined ? childElements(created, 'OriginalVersion')[0] : undefined,
    ),
    mostRecentVersion: versionStamp(
      created !== undefined ? childElements(created, 'MostRecentVersion')[0] : undefined,
    ),
    tables,
    infoConstants,
    hasTemplate,
  })
}
