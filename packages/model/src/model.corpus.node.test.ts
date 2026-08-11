import { describe, expect, it } from 'vitest'
import { readProject } from './adapt.js'
import { corpusBundles, corpusXmlDocuments } from './testing/corpus.node.js'

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

  it('refuses the legacy binary with an actionable message', () => {
    const pcff = new Uint8Array([0x50, 0x43, 0x46, 0x46, 0x47, 0x52, 0x41, 0x34])
    const { value, diagnostics } = readProject(pcff, 'legacy.pzf')
    expect(value).toBeUndefined()
    expect(diagnostics[0]?.code).toBe('project/legacy-binary')
    expect(diagnostics[0]?.message).toMatch(/Open it in Prism/)
  })
})
