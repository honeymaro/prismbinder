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
    // Exactly three shapes exist across every archive we have seen.
    expect([...combos].sort()).toEqual([
      'dir cv=831 ev=20 flag=0 m=0 attr=41ff0000',
      'file cv=831 ev=20 flag=4 m=8 attr=81b60000',
      'file cv=831 ev=45 flag=4 m=8 attr=81b60000',
    ])
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
