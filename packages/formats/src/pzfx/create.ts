import { encodeUtf8 } from '@prismbinder/core'
import type { PzfxYFormat } from './grammar.js'

/**
 * Building a `.pzfx` from nothing.
 *
 * Generated as text rather than by assembling span-backed nodes. The XML layer
 * exists to reproduce documents Prism wrote - CRLF, a BOM, `&gt;` where it is
 * unnecessary, `<X/>` and `<X></X>` in the same file - and it does that by
 * keeping each node's original markup. A document with no original has no
 * markup to keep, so the honest thing is to write the text we mean and let the
 * reader parse it back, which is exactly what the tests do.
 *
 * The vocabulary is the one our own reader consumes, so anything produced here
 * is guaranteed to round-trip through `readPzfx`. Whether *Prism* accepts it is
 * a separate question, and the reason this format has an independent oracle
 * that the bundle path does not: the `pzfx` R and Python packages are field-
 * proven writers, and their output can be compared against ours without Prism.
 *
 * Conventions copied from the corpus: CRLF endings, no indentation, no BOM
 * (5 of 7 observed documents have none), and a declared namespace (present on
 * 42 of 53 observed documents; a reader that requires one still works, and one
 * that does not is unaffected).
 */

export interface PzfxCreateColumn {
  readonly title: string
  /** One entry per subcolumn; each is a column of cell text. */
  readonly subcolumns: readonly (readonly string[])[]
}

export interface PzfxCreateTable {
  readonly title: string
  readonly xColumn?: PzfxCreateColumn
  readonly yColumns: readonly PzfxCreateColumn[]
  readonly rowTitles?: readonly string[]
  /** `Replicates` on the table element; defaults to the widest Y column. */
  readonly replicates?: number
  /**
   * What the subcolumns mean.
   *
   * Omit only when they are repeated measurements or there is a single one.
   * Anything else - a mean with an SD, a value with error bounds - must say so
   * here: the default is `replicates`, and Prism averages replicates.
   */
  readonly yFormat?: PzfxYFormat
}

export interface PzfxCreateOptions {
  readonly tables: readonly PzfxCreateTable[]
  readonly dateTime?: string
  /** Written into `CreatedByProgram`. Never an OS account name. */
  readonly program?: string
  readonly version?: string
}

const EOL = '\r\n'
const NS = 'http://graphpad.com/prism/Prism.htm'

export function createPzfx(opts: PzfxCreateOptions): Uint8Array {
  const when = opts.dateTime ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const program = opts.program ?? 'prismbinder'
  const version = opts.version ?? '0.0.0'

  const out: string[] = []
  out.push('<?xml version="1.0" encoding="UTF-8"?>')
  out.push(`<GraphPadPrismFile xmlns="${NS}" PrismXMLVersion="5.00">`)

  // `Login` is left empty on purpose. Prism records the OS account name of
  // whoever saved the file, and copying that habit would stamp a real person's
  // name into every document this produces.
  out.push('<Created>')
  out.push(
    `<OriginalVersion CreatedByProgram="${attr(program)}" CreatedByVersion="${attr(version)}" Login="" DateTime="${attr(when)}"/>`,
  )
  out.push('</Created>')

  out.push('<InfoSequence>')
  out.push('<Ref ID="Info0" Selected="1"/>')
  out.push('</InfoSequence>')
  out.push('<Info ID="Info0">')
  out.push('<Title>Project info</Title>')
  out.push('</Info>')

  out.push('<TableSequence>')
  opts.tables.forEach((_, i) => {
    out.push(`<Ref ID="Table${i}"${i === 0 ? ' Selected="1"' : ''}/>`)
  })
  out.push('</TableSequence>')

  opts.tables.forEach((t, i) => {
    const widest = Math.max(1, ...t.yColumns.map((c) => c.subcolumns.length))
    const replicates = t.replicates ?? widest
    const xSubcolumns = t.xColumn?.subcolumns.length ?? 0

    // Every attribute below is a value from GraphPad's own schema. Three of
    // these used to be spellings that appear in no real document and in no
    // enumeration - `XFormat="number"`, `YFormat="none"`, and `TableType="XY"`
    // on a table with no X column at all - which our reader accepted and a
    // stricter one need not.
    //
    const tableType = tableTypeFor(xSubcolumns > 0, widest)
    const yFormat = yFormatFor(t.yFormat, tableType)

    const attrs = [`ID="Table${i}"`]
    attrs.push(`XFormat="${xFormatFor(xSubcolumns)}"`)
    if (yFormat !== undefined) attrs.push(`YFormat="${yFormat}"`)
    attrs.push(`TableType="${tableType}"`)
    // `Replicates` is the count that `YFormat="replicates"` refers to, and the
    // corpus writes it only alongside that layout.
    if (yFormat === 'replicates') attrs.push(`Replicates="${replicates}"`)
    attrs.push('EVFormat="AsteriskAfterNumber"')

    out.push(`<Table ${attrs.join(' ')}>`)
    out.push(`<Title>${text(t.title)}</Title>`)

    if (t.rowTitles !== undefined) {
      out.push('<RowTitlesColumn Width="100">')
      out.push(subcolumn(t.rowTitles))
      out.push('</RowTitlesColumn>')
    }

    if (t.xColumn !== undefined) {
      // Declared width has to match what follows it. An X column carrying error
      // subcolumns was previously announced as one column wide regardless.
      out.push(`<XColumn Width="89" Decimals="6" Subcolumns="${xSubcolumns}">`)
      out.push(`<Title>${text(t.xColumn.title)}</Title>`)
      for (const s of t.xColumn.subcolumns) out.push(subcolumn(s))
      out.push('</XColumn>')
    }

    for (const c of t.yColumns) {
      out.push(`<YColumn Width="81" Decimals="6" Subcolumns="${c.subcolumns.length}">`)
      out.push(`<Title>${text(c.title)}</Title>`)
      for (const s of c.subcolumns) out.push(subcolumn(s))
      out.push('</YColumn>')
    }

    out.push('</Table>')
  })

  out.push('</GraphPadPrismFile>')
  return encodeUtf8(out.join(EOL) + EOL)
}

/**
 * `numbers` for a plain X, `error` when the X carries error subcolumns.
 *
 * Both are schema members; the singular `number` is not, and appears in none of
 * the 137 pzfx-family documents examined. `error` is how the corpus spells an X
 * wider than one subcolumn.
 */
function xFormatFor(xSubcolumns: number): string {
  if (xSubcolumns === 0) return 'none'
  return xSubcolumns > 1 ? 'error' : 'numbers'
}

/**
 * Whether to write `YFormat`, and what.
 *
 * Not a function of column width, which is what it looked like at first: of the
 * 137 pzfx-family documents examined, **no `XY` table omits the attribute**,
 * including all 36 whose columns have a single subcolumn - those write
 * `YFormat="replicates" Replicates="1"`. What actually omits it is the table
 * kind: `OneWay` never carries one (41 of 41), nor do `Survival` or
 * `Contingency`. So an earlier version of this fix traded a value outside the
 * enumeration for a combination outside the corpus.
 */
function yFormatFor(explicit: PzfxYFormat | undefined, tableType: string): string | undefined {
  if (explicit !== undefined) return explicit
  if (tableType === 'OneWay') return undefined
  return 'replicates'
}

/**
 * The table kind, chosen to be consistent with the columns actually written.
 *
 * In the corpus an `XY` table always has an X column, a `OneWay` table always
 * has exactly one subcolumn per column and never carries `YFormat`, and the
 * side-by-side layout without an X is `TwoWay`. Declaring `XY` for all three
 * described a table that was not being written.
 */
function tableTypeFor(hasX: boolean, widest: number): string {
  if (hasX) return 'XY'
  return widest > 1 ? 'TwoWay' : 'OneWay'
}

function subcolumn(cells: readonly string[]): string {
  const inner = cells.map((c) => (c === '' ? '<d/>' : `<d>${text(c)}</d>`)).join('')
  return `<Subcolumn>${inner}</Subcolumn>`
}

/**
 * Escapes text content.
 *
 * Minimal and strict: only the three characters that must be escaped, since we
 * are the author here and have no non-canonical choices to reproduce. `>` is
 * escaped anyway - it is legal bare, but `]]>` is not, and one rule is easier
 * to be sure about than one rule with an exception.
 */
function text(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function attr(s: string): string {
  return text(s).replace(/"/g, '&quot;')
}
