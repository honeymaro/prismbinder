import { type Diagnostic, readEntry, readZip, type ZipEntry } from '@prismbinder/core'
import { readProject } from '@prismbinder/model'

/**
 * Comparing two documents.
 *
 * Three layers, because "these files differ" is almost never the useful answer:
 *
 *  1. **Entries** - which parts of the archive were added, removed or rewritten.
 *     This is the layer that answers "did my edit touch anything it shouldn't
 *     have?", and it is the one the write path is verified against.
 *  2. **Structure** - for entries that both sides parse, which JSON paths hold
 *     different values. A one-byte change in a 300 KB results file should not
 *     read the same as a rewritten document.
 *  3. **Cells** - table by table, which coordinates changed. Opt-in, because it
 *     is the expensive layer and usually not what you are asking.
 *
 * Layers 1 and 2 need both sides to be bundles. Layer 3 does not: it runs on
 * the format-neutral view, so a `.pzfx` and a `.prism` can be compared against
 * each other - which is exactly what checking a conversion requires.
 *
 * Values are never printed, only paths, coordinates and counts. Diffing two
 * documents you have is not a reason to spill their contents into a terminal
 * that may be in a CI log.
 */

export interface EntryChange {
  readonly name: string
  readonly change: 'added' | 'removed' | 'changed'
  /** Uncompressed size delta, in bytes. Zero for an unchanged size. */
  readonly bytes: number
}

export interface CellChange {
  readonly sheet: string
  readonly row: number
  readonly column: number
  readonly kind: 'changed' | 'added' | 'removed'
}

export interface DiffReport {
  readonly left: string
  readonly right: string
  readonly comparable: boolean
  readonly entries: readonly EntryChange[]
  /** JSON paths whose value differs, per entry. */
  readonly structure: readonly { entry: string; paths: readonly string[] }[]
  readonly cells: readonly CellChange[] | undefined
  readonly diagnostics: readonly Diagnostic[]
}

function isZip(b: Uint8Array): boolean {
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

function entryMap(bytes: Uint8Array): Map<string, ZipEntry> | undefined {
  const { value } = readZip(bytes)
  if (value === undefined) return undefined
  const out = new Map<string, ZipEntry>()
  for (const e of value.entries) if (!e.isDirectory) out.set(e.name, e)
  return out
}

/**
 * Compares two archives entry by entry.
 *
 * On the CRC rather than the bytes: it is what the archive already records, it
 * is what a changed payload changes, and it avoids inflating every entry of two
 * documents to answer a question about which ones moved.
 */
function diffEntries(a: Map<string, ZipEntry>, b: Map<string, ZipEntry>): EntryChange[] {
  const out: EntryChange[] = []
  for (const [name, left] of a) {
    const right = b.get(name)
    if (right === undefined) {
      out.push({ name, change: 'removed', bytes: -left.meta.uncompressedSize })
    } else if (left.meta.crc32 !== right.meta.crc32) {
      out.push({
        name,
        change: 'changed',
        bytes: right.meta.uncompressedSize - left.meta.uncompressedSize,
      })
    }
  }
  for (const [name, right] of b) {
    if (!a.has(name)) out.push({ name, change: 'added', bytes: right.meta.uncompressedSize })
  }
  return out.sort((x, y) => x.name.localeCompare(y.name))
}

/** Every scalar in a JSON entry, keyed by path, as its source text. */
function scalarPaths(text: string): Map<string, string> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const out = new Map<string, string>()
  const walk = (v: unknown, path: string): void => {
    if (v !== null && typeof v === 'object') {
      if (Array.isArray(v)) v.forEach((item, i) => walk(item, `${path}[${i}]`))
      else for (const [k, item] of Object.entries(v)) walk(item, path === '' ? k : `${path}.${k}`)
      return
    }
    out.set(path, String(v))
  }
  walk(parsed, '')
  return out
}

function diffStructure(
  a: Map<string, ZipEntry>,
  b: Map<string, ZipEntry>,
  changed: readonly EntryChange[],
): { entry: string; paths: string[] }[] {
  const out: { entry: string; paths: string[] }[] = []
  const decoder = new TextDecoder()

  for (const c of changed) {
    if (c.change !== 'changed' || !c.name.endsWith('.json')) continue
    const left = a.get(c.name)
    const right = b.get(c.name)
    if (left === undefined || right === undefined) continue

    const lc = readEntry(left)
    const rc = readEntry(right)
    if (lc.diagnostics.some((d) => d.severity === 'error')) continue
    if (rc.diagnostics.some((d) => d.severity === 'error')) continue
    const lp = scalarPaths(decoder.decode(lc.value))
    const rp = scalarPaths(decoder.decode(rc.value))
    if (lp === undefined || rp === undefined) continue

    const paths: string[] = []
    for (const [path, value] of lp) {
      const other = rp.get(path)
      if (other === undefined) paths.push(`- ${path}`)
      else if (other !== value) paths.push(`~ ${path}`)
    }
    for (const path of rp.keys()) if (!lp.has(path)) paths.push(`+ ${path}`)
    if (paths.length > 0) out.push({ entry: c.name, paths: paths.sort() })
  }
  return out
}

/**
 * Compares cells through the neutral view, so the two sides need not share a
 * format. Sheets are matched by position: titles are the obvious key and the
 * wrong one, since renaming a sheet would then read as deleting and adding it.
 */
function diffCells(
  leftBytes: Uint8Array,
  leftName: string,
  rightBytes: Uint8Array,
  rightName: string,
): { cells: CellChange[] | undefined; diagnostics: Diagnostic[] } {
  const l = readProject(leftBytes, leftName)
  const r = readProject(rightBytes, rightName)
  const diagnostics: Diagnostic[] = []
  // `undefined`, not `[]`. An empty list means "compared, found nothing"; a
  // document that would not parse was never compared, and saying otherwise
  // hands back a clean bill of health for a file we could not read.
  if (l.value === undefined || r.value === undefined) {
    return { cells: undefined, diagnostics: [...l.diagnostics, ...r.diagnostics] }
  }

  const lSheets = l.value.sheets.filter((s) => s.kind === 'data')
  const rSheets = r.value.sheets.filter((s) => s.kind === 'data')
  if (lSheets.length !== rSheets.length) {
    diagnostics.push({
      code: 'diff/sheet-count',
      severity: 'warning',
      path: '',
      message: `${lSheets.length} data sheets on the left, ${rSheets.length} on the right; comparing the ones that pair up by position.`,
    })
  }

  const cells: CellChange[] = []
  const n = Math.min(lSheets.length, rSheets.length)
  for (let s = 0; s < n; s++) {
    const ls = lSheets[s]
    const rs = rSheets[s]
    if (ls?.kind !== 'data' || rs?.kind !== 'data') continue

    const lcols = ls.table.columns.flatMap((c) => c.subcolumns)
    const rcols = rs.table.columns.flatMap((c) => c.subcolumns)
    const cols = Math.max(lcols.length, rcols.length)

    for (let c = 0; c < cols; c++) {
      const lc = lcols[c]
      const rc = rcols[c]
      const rows = Math.max(lc?.length ?? 0, rc?.length ?? 0)
      for (let row = 0; row < rows; row++) {
        const lv = lc?.[row] ?? ''
        const rv = rc?.[row] ?? ''
        if (lv === rv) continue
        cells.push({
          sheet: ls.title,
          row,
          column: c,
          kind: lv === '' ? 'added' : rv === '' ? 'removed' : 'changed',
        })
      }
    }
  }
  return { cells, diagnostics }
}

export function buildDiff(
  leftName: string,
  leftBytes: Uint8Array,
  rightName: string,
  rightBytes: Uint8Array,
  withCells: boolean,
): DiffReport {
  const diagnostics: Diagnostic[] = []
  const bothZip = isZip(leftBytes) && isZip(rightBytes)

  let entries: EntryChange[] = []
  let structure: { entry: string; paths: string[] }[] = []

  if (bothZip) {
    const a = entryMap(leftBytes)
    const b = entryMap(rightBytes)
    if (a !== undefined && b !== undefined) {
      entries = diffEntries(a, b)
      structure = diffStructure(a, b, entries)
    }
  } else {
    diagnostics.push({
      code: 'diff/not-both-bundles',
      severity: 'info',
      path: '',
      message:
        'Entry and structure layers need two ZIP bundles. Comparing cells through the format-neutral view instead.',
    })
  }

  const cellResult =
    withCells || !bothZip ? diffCells(leftBytes, leftName, rightBytes, rightName) : undefined
  if (cellResult !== undefined) diagnostics.push(...cellResult.diagnostics)

  return {
    left: leftName,
    right: rightName,
    comparable: bothZip,
    entries,
    structure,
    cells: cellResult?.cells,
    diagnostics,
  }
}

const MAX_PATHS = 12
const MAX_CELLS = 40

export function formatDiff(r: DiffReport): string {
  const out: string[] = []
  out.push(`${r.left}`)
  out.push(`${r.right}`)
  out.push('')

  if (r.comparable) {
    if (r.entries.length === 0) {
      out.push('  No entry differs.')
    } else {
      out.push(`  Entries (${r.entries.length})`)
      for (const e of r.entries) {
        const sign = e.bytes > 0 ? `+${e.bytes}` : String(e.bytes)
        out.push(`    ${e.change.padEnd(8)}${e.name}${e.bytes === 0 ? '' : `  ${sign} B`}`)
      }
    }

    if (r.structure.length > 0) {
      out.push('')
      out.push('  Values')
      for (const s of r.structure) {
        out.push(`    ${s.entry}`)
        for (const p of s.paths.slice(0, MAX_PATHS)) out.push(`      ${p}`)
        if (s.paths.length > MAX_PATHS) {
          out.push(`      ... ${s.paths.length - MAX_PATHS} more`)
        }
      }
    }
  }

  if (r.cells !== undefined) {
    out.push('')
    if (r.cells.length === 0) {
      out.push('  No cell differs.')
    } else {
      out.push(`  Cells (${r.cells.length})`)
      for (const c of r.cells.slice(0, MAX_CELLS)) {
        out.push(`    ${c.kind.padEnd(8)}${c.sheet}  row ${c.row + 1}, column ${c.column + 1}`)
      }
      if (r.cells.length > MAX_CELLS) out.push(`    ... ${r.cells.length - MAX_CELLS} more`)
    }
  }

  for (const d of r.diagnostics) out.push(`  ${d.severity} ${d.code} ${d.message}`)
  return out.join('\n')
}
