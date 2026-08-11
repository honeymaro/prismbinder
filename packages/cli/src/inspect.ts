import type { Diagnostic } from '@prismbinder/core'
import { columnLayout, type PrismBundle, readBundle, storageSemantics } from '@prismbinder/formats'

export interface InspectReport {
  readonly file: string
  readonly kind: 'bundle'
  readonly bytes: number
  readonly format: {
    readonly formatVersion: string
    readonly minFormatVersion: string
    readonly minPrismVersion: string
  }
  readonly createdBy: { name: string; version: string; platform: string } | undefined
  readonly modifiedBy: { name: string; version: string; platform: string } | undefined
  readonly creationDate: string | undefined
  readonly modificationDate: string | undefined
  readonly counts: {
    readonly entries: number
    readonly dataSheets: number
    readonly dataSets: number
    readonly analyses: number
    readonly graphs: number
    readonly infoSheets: number
    readonly layoutSheets: number
    readonly opaqueEntries: number
  }
  readonly dataSheets: readonly {
    readonly uid: string
    readonly title: string | undefined
    readonly tableFormat: string
    readonly dataFormat: string
    readonly storage: string
    readonly rows: number
    readonly columns: number
    readonly dataSets: number
  }[]
  readonly analyses: readonly {
    readonly uid: string
    readonly title: string | undefined
    readonly analysisClass: string | undefined
    readonly hasResults: boolean
  }[]
  readonly graphs: readonly {
    readonly uid: string
    readonly title: string | undefined
    /** True when the geometry is an opaque PCFF blob we carry but do not read. */
    readonly opaqueBinary: boolean
  }[]
  readonly opaqueEntries: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

/** Whether the user's identity is present in the file, without echoing it. */
export function identitySummary(
  id: { name: string; user: string; version: string; platform: string } | undefined,
): { name: string; version: string; platform: string } | undefined {
  return id === undefined
    ? undefined
    : { name: id.name, version: id.version, platform: id.platform }
}

export function buildReport(
  file: string,
  bytes: Uint8Array,
  bundle: PrismBundle,
  diagnostics: readonly Diagnostic[],
): InspectReport {
  return {
    file,
    kind: 'bundle',
    bytes: bytes.length,
    format: bundle.document.version,
    createdBy: identitySummary(bundle.document.createdBy),
    modifiedBy: identitySummary(bundle.document.modifiedBy),
    creationDate: bundle.document.creationDate,
    modificationDate: bundle.document.modificationDate,
    counts: {
      entries: bundle.archive.entries.length,
      dataSheets: bundle.dataSheets.length,
      dataSets: bundle.dataSets.size,
      analyses: bundle.analyses.length,
      graphs: bundle.graphs.length,
      infoSheets: bundle.infoSheets.length,
      layoutSheets: bundle.layoutSheets.length,
      opaqueEntries: bundle.opaqueEntries.length,
    },
    dataSheets: bundle.dataSheets.map((s) => {
      const t = s.table
      const xFormat =
        t?.xDataSet !== undefined ? bundle.dataSets.get(t.xDataSet)?.format : undefined
      const layout = t !== undefined ? columnLayout(t, xFormat) : undefined
      return {
        uid: s.uid,
        title: s.title,
        tableFormat: t?.format ?? '-',
        dataFormat: t?.dataFormat ?? '-',
        storage: t !== undefined ? storageSemantics(t.dataFormat) : '-',
        rows: t?.rows.length ?? 0,
        columns: layout?.total ?? 0,
        dataSets: t?.dataSets.length ?? 0,
      }
    }),
    analyses: bundle.analyses.map((a) => ({
      uid: a.uid,
      title: a.title,
      analysisClass: a.analysisClass,
      hasResults: a.results !== undefined,
    })),
    graphs: bundle.graphs.map((g) => ({ uid: g.uid, title: g.title, opaqueBinary: g.hasBinary })),
    opaqueEntries: bundle.opaqueEntries,
    diagnostics,
  }
}

export function inspectBytes(
  file: string,
  bytes: Uint8Array,
): { report: InspectReport | undefined; diagnostics: readonly Diagnostic[] } {
  const { value, diagnostics } = readBundle(bytes)
  if (value === undefined) return { report: undefined, diagnostics }
  return { report: buildReport(file, bytes, value, diagnostics), diagnostics }
}

/** Human-readable rendering. `--json` gives the structure above instead. */
export function formatReport(r: InspectReport): string {
  const out: string[] = []
  const kb = (r.bytes / 1024).toFixed(1)
  out.push(`${r.file}  (${kb} KB, ${r.counts.entries} entries)`)
  out.push(
    `  format ${r.format.formatVersion}   opens in Prism >= ${r.format.minPrismVersion || '?'}   min format ${r.format.minFormatVersion || '?'}`,
  )
  if (r.modifiedBy !== undefined) {
    out.push(
      `  last written by ${r.modifiedBy.name} ${r.modifiedBy.version} on ${r.modifiedBy.platform}${
        r.modificationDate !== undefined ? ` at ${r.modificationDate}` : ''
      }`,
    )
  }

  if (r.dataSheets.length > 0) {
    out.push('')
    out.push(`  Data sheets (${r.dataSheets.length})`)
    for (const s of r.dataSheets) {
      const shape = `${s.rows}x${s.columns}`
      const note = s.storage === 'offsets' ? '  [stores offsets, not displayed values]' : ''
      const unknown = s.storage === 'unknown' ? '  [unverified subcolumn layout]' : ''
      out.push(
        `    ${(s.title ?? s.uid).padEnd(38).slice(0, 38)} ${shape.padStart(10)}  ${s.tableFormat}/${s.dataFormat}${note}${unknown}`,
      )
    }
  }

  if (r.analyses.length > 0) {
    out.push('')
    out.push(`  Analyses (${r.analyses.length})`)
    for (const a of r.analyses) {
      out.push(
        `    ${(a.title ?? a.uid).padEnd(38).slice(0, 38)} ${a.analysisClass ?? '?'}${a.hasResults ? '' : '  [no results]'}`,
      )
    }
  }

  if (r.graphs.length > 0) {
    out.push('')
    out.push(`  Graphs (${r.graphs.length})`)
    for (const g of r.graphs) {
      out.push(
        `    ${(g.title ?? g.uid).padEnd(38).slice(0, 38)}${g.opaqueBinary ? '  [PCFF binary, carried through unread]' : ''}`,
      )
    }
  }

  if (r.opaqueEntries.length > 0) {
    out.push('')
    out.push(`  Preserved but not interpreted (${r.opaqueEntries.length})`)
    for (const n of r.opaqueEntries.slice(0, 10)) out.push(`    ${n}`)
    if (r.opaqueEntries.length > 10) out.push(`    ... and ${r.opaqueEntries.length - 10} more`)
  }

  const shown = r.diagnostics.filter((d) => d.severity !== 'info')
  if (shown.length > 0) {
    out.push('')
    out.push(`  Diagnostics (${shown.length})`)
    for (const d of shown.slice(0, 20)) {
      out.push(`    ${d.severity} ${d.code}  ${d.path}  ${d.message}`)
    }
  }

  return out.join('\n')
}
