import { describe, expect, it } from 'vitest'
import { readProject } from './adapt.js'
import { toBundle, toPzfx } from './convert.js'
import { corpusBundles, corpusXmlDocuments } from './testing/corpus.node.js'

/**
 * Conversion, over every document we can read.
 *
 * The property under test is not "the output equals the input" - it cannot be,
 * and claiming otherwise is the failure mode this whole module is written
 * against. It is narrower and checkable: **every cell that crosses over crosses
 * over unchanged, and everything that does not cross over is named.**
 *
 * Cell values are never printed. Part of this corpus is unpublished research
 * data; a failing assertion reports coordinates and counts.
 */

const bundles = corpusBundles()
const xml = corpusXmlDocuments()

/**
 * Every data table as a flat list of subcolumns.
 *
 * Subcolumns, not one concatenated run of cells. XML tables are ragged - 29 of
 * 124 have subcolumns of differing lengths - while a CSV is a rectangle, so a
 * short subcolumn comes back padded with blanks. Compared as one long sequence
 * that padding shifts every later value and reads as corruption; compared
 * subcolumn by subcolumn it is what it actually is, a representational
 * difference that loses nothing.
 */
function cells(bytes: Uint8Array, name: string): string[][][] {
  const project = readProject(bytes, name).value
  if (project === undefined) return []
  return project.sheets
    .filter((s) => s.kind === 'data')
    .map((s) =>
      s.table.columns
        .filter((c) => c.role !== 'rowTitles')
        .flatMap((c) => c.subcolumns.map((sub) => [...sub])),
    )
}

/** Trailing blanks are not information; a CSV cannot express "absent". */
function sameCells(a: readonly string[], b: readonly string[]): boolean {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) if ((a[i] ?? '') !== (b[i] ?? '')) return false
  return true
}

function sameTable(a: readonly string[][], b: readonly string[][]): string | undefined {
  if (a.length !== b.length) return `${a.length} subcolumns in, ${b.length} out`
  for (let i = 0; i < a.length; i++) {
    if (!sameCells(a[i] ?? [], b[i] ?? [])) return `subcolumn ${i} differs`
  }
  return undefined
}

describe.skipIf(bundles.length === 0 && xml.length === 0)('conversion', () => {
  it('carries every cell into a .pzfx', () => {
    const failures: string[] = []
    let tables = 0

    for (const f of [...bundles, ...xml]) {
      const project = readProject(f.bytes, f.name).value
      if (project === undefined) continue
      const { bytes, losses } = toPzfx(project)
      if (bytes === undefined) continue

      // Never silent: even a document of nothing but data reports the display
      // settings it left behind.
      expect(losses.length, f.name).toBeGreaterThan(0)

      const before = cells(f.bytes, f.name)
      const after = cells(bytes, 'converted.pzfx')
      if (before.length !== after.length) {
        failures.push(`${f.name}: ${before.length} tables in, ${after.length} out`)
        continue
      }
      before.forEach((t, i) => {
        tables++
        const why = sameTable(t, after[i] ?? [])
        if (why !== undefined) failures.push(`${f.name}: table ${i}: ${why}`)
      })
    }

    expect(tables).toBeGreaterThan(50)
    expect(failures.slice(0, 20)).toEqual([])
  })

  it('carries every cell into a bundle', () => {
    const failures: string[] = []
    let tables = 0

    for (const f of [...bundles, ...xml]) {
      const project = readProject(f.bytes, f.name).value
      if (project === undefined) continue
      const { bytes } = toBundle(project)
      if (bytes === undefined) continue

      const before = cells(f.bytes, f.name)
      const after = cells(bytes, 'converted.prism')
      if (before.length !== after.length) {
        failures.push(`${f.name}: ${before.length} tables in, ${after.length} out`)
        continue
      }
      before.forEach((t, i) => {
        tables++
        const why = sameTable(t, after[i] ?? [])
        if (why !== undefined) failures.push(`${f.name}: table ${i}: ${why}`)
      })
    }

    expect(tables).toBeGreaterThan(50)
    expect(failures.slice(0, 20)).toEqual([])
  })

  it('names what it drops', () => {
    // A document with graphs and analyses must say so. Silent loss is the
    // failure this module exists to prevent.
    let checked = 0
    for (const f of bundles) {
      const project = readProject(f.bytes, f.name).value
      if (project === undefined) continue
      const hasGraphs = project.sheets.some((s) => s.kind === 'graph')
      const hasAnalyses = project.sheets.some((s) => s.kind === 'analysis')
      if (!hasGraphs && !hasAnalyses) continue

      const { losses } = toPzfx(project)
      const joined = losses.join(' | ')
      if (hasGraphs) expect(joined, f.name).toMatch(/graph/)
      if (hasAnalyses) expect(joined, f.name).toMatch(/analys/)
      checked++
    }
    expect(checked).toBeGreaterThan(5)
  })

  it('survives a there-and-back trip with the cells intact', () => {
    // bundle -> pzfx -> bundle. Everything except the data is gone after the
    // first hop, so this checks the one thing that is supposed to be stable.
    const failures: string[] = []
    for (const f of bundles.slice(0, 10)) {
      const project = readProject(f.bytes, f.name).value
      if (project === undefined) continue
      const hop1 = toPzfx(project).bytes
      if (hop1 === undefined) continue
      const mid = readProject(hop1, 'mid.pzfx').value
      if (mid === undefined) {
        failures.push(`${f.name}: could not read our own .pzfx back`)
        continue
      }
      const hop2 = toBundle(mid).bytes
      if (hop2 === undefined) {
        failures.push(`${f.name}: could not build a bundle from the .pzfx`)
        continue
      }
      const before = cells(f.bytes, f.name).flat()
      const after = cells(hop2, 'end.prism').flat()
      const why = sameTable(before, after)
      if (why !== undefined) failures.push(`${f.name}: ${why}`)
    }
    expect(failures).toEqual([])
  })
})
