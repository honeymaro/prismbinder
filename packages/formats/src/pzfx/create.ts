import { encodeUtf8 } from '@prismbinder/core'

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
    // XFormat/YFormat name what the subcolumns mean. Only layouts whose meaning
    // is verified are emitted; anything wider falls back to replicates, which
    // is the one wide layout that needs no interpretation.
    const yFormat = replicates === 1 ? 'none' : 'replicates'

    out.push(
      `<Table ID="Table${i}" XFormat="${t.xColumn === undefined ? 'none' : 'number'}" YFormat="${yFormat}" Replicates="${replicates}" TableType="XY" EVFormat="AsteriskAfterNumber">`,
    )
    out.push(`<Title>${text(t.title)}</Title>`)

    if (t.rowTitles !== undefined) {
      out.push('<RowTitlesColumn Width="100">')
      out.push(subcolumn(t.rowTitles))
      out.push('</RowTitlesColumn>')
    }

    if (t.xColumn !== undefined) {
      out.push('<XColumn Width="89" Decimals="6" Subcolumns="1">')
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
