import type { Diagnostic } from '@prismbinder/core'
import {
  createBundle,
  createPzfx,
  type PzfxCreateTable,
  pzfxYFormatFor,
} from '@prismbinder/formats'
import { marksFor, type Project, type TableView } from './types.js'

/**
 * Converting between the two formats.
 *
 * This is lossy in both directions and the loss is not incidental - it is most
 * of what distinguishes the formats. A conversion that quietly dropped the
 * analyses and graphs while reporting success would be the single most
 * dangerous thing this library could do, so every conversion returns an
 * itemised list of what did not survive and the CLI prints it.
 *
 * What crosses over: data tables, their column layout, their cell text
 * verbatim, and row and column titles.
 *
 * What does not, and why:
 *
 *  - **Graphs.** Their geometry is a PCFF blob in both formats. We carry it
 *    through a round trip within one format and refuse to author it, so it
 *    cannot cross into a container that was built from scratch.
 *  - **Analyses and their stored results.** The bundle keeps them as JSON we
 *    can read; `.pzfx` keeps them inside the same opaque `<Template>` blob as
 *    the graphs. There is nowhere to put them.
 *  - **Numeric spelling, going to `.pzfx`.** The XML corpus writes at most 10
 *    significant digits in MSVC's three-digit-exponent style, while the bundle
 *    stores `%.18g`. Cell *text* is copied unchanged, so no precision is lost
 *    by us - but a value written by us will not match what Prism would have
 *    written for the same number.
 *  - **Everything not modelled by the neutral view**: display settings, fonts,
 *    colours, per-cell formatting, exclusions, in-table formulas.
 *
 * The neutral view is deliberately thin, so the honest framing is that this
 * moves *data* between formats rather than converting documents.
 */

export interface ConversionResult {
  readonly bytes: Uint8Array | undefined
  /** One entry per thing that did not survive. Empty means a clean transfer. */
  readonly losses: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

function tally(project: Project): { losses: string[]; diagnostics: Diagnostic[] } {
  const losses: string[] = []
  const diagnostics: Diagnostic[] = []

  const count = (kind: string) => project.sheets.filter((s) => s.kind === kind).length
  const graphs = count('graph')
  const analyses = count('analysis')
  const info = count('info')

  if (graphs > 0) {
    losses.push(
      `${graphs} graph${graphs === 1 ? '' : 's'} dropped - geometry is a legacy binary we do not author`,
    )
  }
  if (analyses > 0) {
    losses.push(
      `${analyses} analys${analyses === 1 ? 'is' : 'es'} dropped, including any stored results`,
    )
  }
  if (info > 0) losses.push(`${info} info sheet${info === 1 ? '' : 's'} dropped`)

  for (const s of project.sheets) {
    if (s.kind !== 'data') continue
    if (s.table.storage === 'unknown') {
      diagnostics.push({
        code: 'convert/unverified-layout',
        severity: 'warning',
        path: s.title,
        message:
          'The subcolumn layout of this table has never been observed, so its columns are copied as stored without interpreting what they mean.',
      })
    }
  }

  // Prism records these per cell and treats them as data-defining, not as
  // formatting: an excluded value is absent from every analysis, and a censored
  // one means something different from an observed one. Neither survives, so
  // neither is folded into the formatting line below.
  let excluded = 0
  let censored = 0
  let generated = 0
  for (const s of project.sheets) {
    if (s.kind !== 'data') continue
    for (const c of s.table.columns) {
      if (c.generated === true) generated++
      for (let i = 0; i < c.subcolumns.length; i++) {
        excluded += marksFor(c, i).excluded.size
        censored += marksFor(c, i).censored.size
      }
    }
  }
  if (excluded > 0) {
    losses.push(
      `${excluded} excluded value(s) become ordinary values - Prism leaves them out of every analysis and graph`,
    )
  }
  if (censored > 0) {
    losses.push(`${censored} censored observation(s) lose their censoring mark`)
  }
  if (generated > 0) {
    losses.push(
      `${generated} generated X column(s) are written out in full rather than as a start value and an interval`,
    )
  }

  losses.push('display settings, fonts, colours and per-cell formatting are not carried over')
  return { losses, diagnostics }
}

/** Data tables only: the rest of a project has nowhere to go. */
function dataTables(project: Project): { title: string; table: TableView }[] {
  return project.sheets
    .filter((s) => s.kind === 'data')
    .map((s) => ({ title: s.title, table: s.table }))
}

export function toBundle(project: Project): ConversionResult {
  const { losses, diagnostics } = tally(project)
  const tables = dataTables(project).map(({ title, table }) => {
    const x = table.columns.find((c) => c.role === 'x')

    // An X column can carry more than one subcolumn - `.pzfx` writes X with
    // error bars that way. The bundle format has room for exactly one X, so
    // the first subcolumn stays X and the rest follow it as ordinary columns.
    // Keeping only subcolumn 0, which is what this did, silently dropped the
    // error values of every XY table that had them.
    const xExtras = (x?.subcolumns ?? []).slice(1).map((cells, i) => ({
      title: `${x?.title ?? 'X'} (${i + 2})`,
      cells,
    }))

    return {
      title,
      ...(table.rowTitles.length > 0 ? { rowTitles: table.rowTitles } : {}),
      // An X column keeps its role: with one the sheet is an XY table, without
      // one it is a column table, and collapsing X into Y would turn a curve
      // into a set of unrelated columns.
      ...(x?.subcolumns[0] === undefined
        ? {}
        : { xColumn: { title: x.title, cells: x.subcolumns[0] } }),
      // The bundle writer emits single-value Y columns, so each subcolumn
      // becomes its own column. The values are preserved; the grouping is not.
      columns: [
        ...xExtras,
        ...table.columns
          .filter((c) => c.role === 'y')
          .flatMap((c) =>
            c.subcolumns.map((cells, i) => ({
              title: i === 0 ? c.title : `${c.title} (${i + 1})`,
              cells,
            })),
          ),
      ],
    }
  })

  // Flattening invents column names, and an invented one can land on a title
  // the document already used: an X column `Conc` with error subcolumns
  // produces `Conc (2)`, which collides with a Y column genuinely titled
  // `Conc (2)`. No data is lost - each keeps its own dataset - but the result
  // holds an ambiguity the source did not, and a tool that promises to name
  // what it changed should not introduce one quietly.
  for (const t of tables) {
    const names = t.columns.map((c) => c.title)
    const duplicated = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
    if (duplicated.length > 0) {
      diagnostics.push({
        code: 'convert/duplicate-column-title',
        severity: 'warning',
        path: t.title,
        message: `flattening subcolumns produced repeated column titles (${duplicated.join(', ')}); the data is intact but the names no longer identify a column`,
      })
    }
  }

  if (tables.length === 0) {
    return { bytes: undefined, losses, diagnostics: [...diagnostics, noTables()] }
  }
  if (dataTables(project).some(({ table }) => table.columns.some((c) => c.subcolumns.length > 1))) {
    losses.push('subcolumn grouping is flattened: each subcolumn becomes its own column')
  }
  return { bytes: createBundle({ tables }), losses, diagnostics }
}

export function toPzfx(project: Project): ConversionResult {
  const { losses, diagnostics } = tally(project)

  const tables: PzfxCreateTable[] = dataTables(project).map(({ title, table }) => {
    const x = table.columns.find((c) => c.role === 'x')
    // Without this the writer falls back to `replicates`, and Prism averages
    // replicates: a mean-and-SD column pair would come out the other side as a
    // single number halfway between the two.
    const yFormat = pzfxYFormatFor(table.dataFormat)
    return {
      title,
      ...(table.rowTitles.length > 0 ? { rowTitles: table.rowTitles } : {}),
      ...(yFormat === undefined ? {} : { yFormat }),
      ...(x === undefined
        ? {}
        : { xColumn: { title: x.title, subcolumns: x.subcolumns.map((s) => [...s]) } }),
      yColumns: table.columns
        .filter((c) => c.role === 'y')
        .map((c) => ({ title: c.title, subcolumns: c.subcolumns.map((s) => [...s]) })),
    }
  })

  // `.pzfx` distinguishes two three-subcolumn layouts the bundle spells one
  // way, so this direction has to pick one. It picks the offset reading, which
  // keeps these columns from being read as repeated measurements; a table that
  // really held absolute limits is now labelled as holding offsets.
  const ambiguous = dataTables(project).filter(
    ({ table }) => table.dataFormat === 'y_high_low' || table.dataFormat === 'y_plus_minus',
  ).length
  if (ambiguous > 0) {
    losses.push(
      `${ambiguous} table(s) with error bounds are written as low-high; the bundle does not record whether they held offsets or absolute limits`,
    )
  }
  // The kind is rebuilt from the columns, so a survival or contingency table
  // arrives as the XY or column table its shape suggests.
  const kinds = new Set(
    dataTables(project)
      .map(({ table }) => table.tableFormat)
      .filter((f) => f === 'survival' || f === 'contingency' || f === 'partsofwhole'),
  )
  if (kinds.size > 0) {
    losses.push(`table kind is not carried over for ${[...kinds].sort().join(', ')} tables`)
  }

  if (tables.length === 0) {
    return { bytes: undefined, losses, diagnostics: [...diagnostics, noTables()] }
  }

  // `.pzfx` names a table's subcolumn meaning with one attribute for the whole
  // table, so a document mixing layouts loses that distinction.
  const widths = new Set(tables.flatMap((t) => t.yColumns.map((c) => c.subcolumns.length)))
  if (widths.size > 1) {
    losses.push(
      'subcolumn meaning is declared per table in .pzfx, so mixed layouts are written as replicates',
    )
  }

  return { bytes: createPzfx({ tables }), losses, diagnostics }
}

function noTables(): Diagnostic {
  return {
    code: 'convert/no-data',
    severity: 'error',
    path: '',
    message: 'Nothing to convert: this document has no data tables.',
  }
}
