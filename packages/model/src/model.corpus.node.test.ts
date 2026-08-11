import { describe, expect, it } from 'vitest'
import { readProject } from './adapt.js'
import { corpusBundles, corpusXmlDocuments } from './testing/corpus.node.js'
import { marksFor } from './types.js'

const bundles = corpusBundles()
const xml = corpusXmlDocuments()

describe.skipIf(bundles.length === 0)('project view over both formats', () => {
  it('reads bundles into a uniform view', () => {
    let dataSheets = 0
    for (const f of bundles) {
      const { value } = readProject(f.bytes, f.name)
      expect(value, f.name).toBeDefined()
      expect(value?.source).toBe('bundle')
      dataSheets += value?.sheets.filter((s) => s.kind === 'data').length ?? 0
    }
    expect(dataSheets).toBeGreaterThan(50)
  })

  it('reads XML documents into the same view', () => {
    let dataSheets = 0
    let parsed = 0
    for (const f of xml) {
      const { value } = readProject(f.bytes, f.name)
      if (value === undefined) continue
      parsed++
      expect(value.source).toBe('pzfx')
      dataSheets += value.sheets.filter((s) => s.kind === 'data').length
    }
    expect(parsed).toBeGreaterThan(100)
    expect(dataSheets).toBeGreaterThan(100)
  })

  it('every data column has as many cells as the table claims rows', () => {
    for (const f of bundles) {
      const { value } = readProject(f.bytes, f.name)
      for (const s of value?.sheets ?? []) {
        if (s.kind !== 'data') continue
        for (const c of s.table.columns) {
          for (const sub of c.subcolumns) {
            expect(sub.length, `${f.name}::${s.title}::${c.title}`).toBe(s.table.rowCount)
          }
        }
      }
    }
  })

  it('flags tables whose stored numbers are not the displayed ones', () => {
    const storages = new Set<string>()
    for (const f of bundles) {
      const { value } = readProject(f.bytes, f.name)
      for (const s of value?.sheets ?? []) if (s.kind === 'data') storages.add(s.table.storage)
    }
    // 'offsets' must be reachable: y_high_low stores deltas, not bounds.
    expect(storages.has('offsets')).toBe(true)
  })

  it('rebuilds X columns that Prism generates instead of storing', () => {
    // Such a dataset occupies no CSV column, so a reader that only walks the
    // stored columns drops the X entirely and the sheet looks like a table
    // that never had one. Three documents in the corpus do this, 1000 rows
    // each.
    let generated = 0
    for (const f of bundles) {
      const { value } = readProject(f.bytes, f.name)
      for (const s of value?.sheets ?? []) {
        if (s.kind !== 'data') continue
        for (const c of s.table.columns) {
          if (!c.generated) continue
          generated++
          expect(c.role, `${f.name}::${s.title}`).toBe('x')
          expect(c.subcolumns[0]?.length, `${f.name}::${s.title}`).toBe(s.table.rowCount)
          expect(c.subcolumns[0]?.[0], `${f.name}::${s.title}`).not.toBe('')
        }
      }
    }
    expect(generated).toBeGreaterThan(0)
  })

  it('carries the row marks that change what a number means', () => {
    // CENSORED distinguishes "the subject died at t" from "we stopped
    // following the subject at t", and EXCLUDED marks a value Prism keeps on
    // the table but leaves out of every analysis and graph. Neither is visible
    // in the CSV.
    let censored = 0
    for (const f of bundles) {
      const { value } = readProject(f.bytes, f.name)
      for (const s of value?.sheets ?? []) {
        if (s.kind !== 'data') continue
        for (const c of s.table.columns) {
          for (let i = 0; i < c.subcolumns.length; i++) {
            const m = marksFor(c, i)
            censored += m.censored.size
            for (const row of [...m.excluded, ...m.censored]) {
              expect(row, `${f.name}::${s.title}`).toBeLessThan(s.table.rowCount)
            }
          }
        }
      }
    }
    expect(censored).toBeGreaterThan(0)
  })

  it('refuses the legacy binary with an actionable message', () => {
    const pcff = new Uint8Array([0x50, 0x43, 0x46, 0x46, 0x47, 0x52, 0x41, 0x34])
    const { value, diagnostics } = readProject(pcff, 'legacy.pzf')
    expect(value).toBeUndefined()
    expect(diagnostics[0]?.code).toBe('project/legacy-binary')
    expect(diagnostics[0]?.message).toMatch(/Open it in Prism/)
  })
})
