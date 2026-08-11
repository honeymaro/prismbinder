import { describe, expect, it } from 'vitest'
import { decodeUtf8 } from '../bytes.js'
import { corpusBundles } from '../testing/corpus.node.js'
import { readEntry, readZip } from '../zip/index.js'
import { parseCsv, printCsv } from './csv.js'

interface Sample {
  readonly bundle: string
  readonly entry: string
  readonly text: string
}

function collect(): Sample[] {
  const out: Sample[] = []
  for (const b of corpusBundles()) {
    for (const e of readZip(b.bytes).value.entries) {
      if (!e.name.endsWith('.csv')) continue
      out.push({ bundle: b.name, entry: e.name, text: decodeUtf8(readEntry(e).value) })
    }
  }
  return out
}

const samples = collect()

describe.skipIf(samples.length === 0)(`CSV fidelity over ${samples.length} tables`, () => {
  it('round-trips every table byte-for-byte', () => {
    const failures: string[] = []
    for (const s of samples) {
      if (printCsv(parseCsv(s.text)) !== s.text) failures.push(`${s.bundle}::${s.entry}`)
    }
    expect(failures.slice(0, 20)).toEqual([])
  })

  it('confirms the dialect the printer assumes', () => {
    for (const s of samples) {
      expect(s.text.includes('\r'), `${s.entry} has CR`).toBe(false)
      expect(s.text.startsWith('\uFEFF'), `${s.entry} has BOM`).toBe(false)
      if (s.text.length > 0) expect(s.text.endsWith('\n'), `${s.entry} ends with LF`).toBe(true)
    }
  })

  it('agrees with content.json on the row count', () => {
    // The invariant the writer has to maintain when a row is added or removed.
    let checked = 0
    for (const b of corpusBundles()) {
      const { value } = readZip(b.bytes)
      for (const e of value.entries) {
        if (!e.name.endsWith('/data.csv')) continue
        const contentEntry = value.entries.find(
          (x) => x.name === e.name.replace(/data\.csv$/, 'content.json'),
        )
        if (contentEntry === undefined) continue
        const declared = JSON.parse(decodeUtf8(readEntry(contentEntry).value)) as {
          numberOfRows: number
        }
        const actual = parseCsv(decodeUtf8(readEntry(e).value)).rows.length
        expect(actual, `${b.name}::${e.name}`).toBe(declared.numberOfRows)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(50)
  })

  it('finds the quoted fields that justify the escaping rules', () => {
    const quoted = samples.filter((s) => s.text.includes('"'))
    expect(quoted.length).toBeGreaterThan(0)
    // Every quoted field observed so far is quoted because of a comma.
    for (const s of quoted) {
      for (const m of s.text.matchAll(/"([^"]*)"/g)) {
        expect(m[1], `${s.entry}: ${m[1]}`).toContain(',')
      }
    }
  })
})
