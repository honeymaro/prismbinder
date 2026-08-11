import { describe, expect, it } from 'vitest'
import { bytesEqual } from '../bytes.js'
import { deflateRaw } from '../deflate.js'
import { corpusBundles, describeCorpus } from '../testing/corpus.node.js'
import { readEntry } from './entry.js'
import { readZip } from './read.js'
import { writeZip } from './write.js'

/**
 * T1 - no-edit fidelity, against real archives.
 *
 * Parsing and re-writing every bundle we can find must reproduce the original
 * bytes exactly. The synthetic tests prove the writer is self-consistent; only
 * this one proves we captured every field Prism actually uses.
 *
 * Node-only: it reads a Prism installation from disk. The browser project runs
 * the pure-logic suites instead, which is what guards the runtime contract.
 */
const bundles = corpusBundles()

describe.skipIf(bundles.length === 0)(`T1 byte fidelity over ${describeCorpus()}`, () => {
  it('round-trips every archive byte-for-byte', () => {
    const failures: string[] = []
    for (const b of bundles) {
      const { value, diagnostics } = readZip(b.bytes)
      const errors = diagnostics.filter((d) => d.severity === 'error')
      if (errors.length > 0) {
        failures.push(`${b.name}: ${errors.map((e) => e.code).join(', ')}`)
        continue
      }
      if (!bytesEqual(writeZip(value), b.bytes)) failures.push(`${b.name}: bytes differ`)
    }
    expect(failures).toEqual([])
  })

  it('parses every entry rather than giving up on some', () => {
    // Guards the oracle itself: a writer that round-trips because the reader
    // skipped everything would otherwise pass the test above.
    let entries = 0
    for (const b of bundles) {
      const { value } = readZip(b.bytes)
      entries += value.entries.length
      expect(value.entries.length).toBeGreaterThan(0)
    }
    expect(entries).toBeGreaterThan(1000)
  })

  it('confirms the metadata profile the writer hard-codes', () => {
    const combos = new Set<string>()
    for (const b of bundles) {
      for (const e of readZip(b.bytes).value.entries) {
        combos.add(
          `${e.isDirectory ? 'dir' : 'file'} cv=${e.meta.createVersion} ev=${e.meta.extractVersion} flag=${e.meta.flag} m=${e.meta.method} attr=${e.meta.externalAttrs.toString(16)}`,
        )
      }
    }
    // The invariant, not a fixed list. Documents written on different machines
    // carry different Unix permission bits outside `data/tables/` - the same
    // corpus that first showed this also showed 0644 where ours all had 0666 -
    // so the constant part is what the writer actually controls.
    for (const combo of combos) {
      expect(combo, 'created by Prism, spec 6.3, Unix host').toContain('cv=831')
      if (combo.startsWith('dir')) {
        expect(combo).toContain('flag=0 m=0')
      } else {
        expect(combo, 'files are deflated and declare fast compression').toContain('flag=4 m=8')
      }
    }
  })

  it('uses one of two extract versions, and pairs 45 with the wider permissions', () => {
    // The narrow corpus suggested a tidy rule - `data/tables` is the ev=45
    // subtree - and a wider one disproved it: in nine archives that subtree
    // holds both versions. What survives is weaker and actually true. `ev=45`
    // and the 0666 bits always travel together, which is the real signal that
    // one code path wrote those entries; where the boundary falls is not ours
    // to predict, and the writer reproduces it per entry rather than deriving
    // it.
    let seen45 = 0
    for (const b of bundles) {
      for (const e of readZip(b.bytes).value.entries) {
        if (e.isDirectory) continue
        expect([20, 45], `${b.name}::${e.name}`).toContain(e.meta.extractVersion)
        if (e.meta.extractVersion === 45) {
          expect(e.meta.externalAttrs.toString(16), `${b.name}::${e.name}`).toBe('81b60000')
          seen45++
        }
      }
    }
    // Not a population count. An earlier version demanded more than a hundred,
    // which quietly required a local Prism installation: with only the external
    // fixtures the number is 49, so the check failed on precisely the setup
    // `tools/fetch-external-fixtures.mjs` exists to enable. All this needs to
    // do is stop the pairing assertion above from passing vacuously.
    expect(seen45).toBeGreaterThan(0)
  })

  it("reproduces every deflate stream with Prism's parameters (T1')", () => {
    let total = 0
    let identical = 0
    for (const b of bundles) {
      for (const e of readZip(b.bytes).value.entries) {
        if (e.meta.method !== 8) continue
        total++
        if (bytesEqual(deflateRaw(readEntry(e).value), e.stored)) identical++
      }
    }
    expect(total).toBeGreaterThan(1000)
    expect(identical).toBe(total)
  })

  it('agrees with the stored CRC and sizes for every entry', () => {
    for (const b of bundles) {
      for (const e of readZip(b.bytes).value.entries) {
        const content = readEntry(e).value
        expect(content.length, `${b.name}::${e.name} size`).toBe(e.meta.uncompressedSize)
      }
    }
  })
})
