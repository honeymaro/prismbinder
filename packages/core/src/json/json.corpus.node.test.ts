import { describe, expect, it } from 'vitest'
import { decodeUtf8 } from '../bytes.js'
import { corpusBundles } from '../testing/corpus.node.js'
import { readEntry, readZip } from '../zip/index.js'
import { parseJson } from './parse.js'
import { printJson } from './print.js'
import { formatForEntry } from './types.js'

/**
 * The JSON model's real test: every JSON entry in every archive we can find has
 * to survive `print(parse(x)) === x`.
 *
 * Note this is deliberately not `applyEdits(text, [])`, which would be the
 * identity function and would prove nothing. Reconstructing the text from the
 * model is what demonstrates the model actually holds everything.
 */
interface Sample {
  readonly bundle: string
  readonly entry: string
  readonly text: string
}

function collectJsonEntries(): Sample[] {
  const out: Sample[] = []
  for (const b of corpusBundles()) {
    const { value } = readZip(b.bytes)
    for (const e of value.entries) {
      if (!e.name.endsWith('.json')) continue
      out.push({ bundle: b.name, entry: e.name, text: decodeUtf8(readEntry(e).value) })
    }
  }
  return out
}

const samples = collectJsonEntries()

describe.skipIf(samples.length === 0)(`JSON fidelity over ${samples.length} entries`, () => {
  it('round-trips every entry byte-for-byte', () => {
    const failures: string[] = []
    for (const s of samples) {
      const { value, diagnostics } = parseJson(s.text, s.entry)
      if (diagnostics.some((d) => d.severity === 'error')) {
        failures.push(`${s.bundle}::${s.entry} parse errors`)
        continue
      }
      if (printJson(value) !== s.text) failures.push(`${s.bundle}::${s.entry}`)
    }
    expect(failures.slice(0, 20)).toEqual([])
  })

  it('sees exactly the two layouts the format uses', () => {
    // Tabs everywhere except the data/tables subtree, which uses four spaces
    // and a trailing newline. No third style has ever appeared.
    //
    // Asserted as an invariant, not as a pair of counts: the corpus grows
    // whenever someone drops another document into fixtures/, and a test that
    // fails on a *new valid file* would train us to edit the number rather than
    // read the failure. The measured counts on the 14 shipped bundles - 881 and
    // 72 - live in docs/measurements.md, which is where a measurement belongs.
    const styles = new Map<string, number>()
    for (const s of samples) {
      const { value } = parseJson(s.text, s.entry)
      const key = `indent=${JSON.stringify(value.format.indent)} trailingNewline=${value.format.trailingNewline}`
      styles.set(key, (styles.get(key) ?? 0) + 1)
    }
    expect([...styles.keys()].sort()).toEqual([
      'indent="    " trailingNewline=true',
      'indent="\\t" trailingNewline=false',
    ])
  })

  it('agrees with formatForEntry on every entry', () => {
    // If the path-based table ever drifts from reality, create() would start
    // writing files in the wrong style. Detected here rather than in Prism.
    const mismatches: string[] = []
    for (const s of samples) {
      const detected = parseJson(s.text, s.entry).value.format
      const expected = formatForEntry(s.entry)
      if (
        detected.indent !== expected.indent ||
        detected.trailingNewline !== expected.trailingNewline
      ) {
        mismatches.push(`${s.entry}: detected ${JSON.stringify(detected.indent)}`)
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([])
  })

  it('finds the numeric literals that motivated the model', () => {
    const withDotZero = samples.filter((s) => /: -?\d+\.0(,|\n|\})/.test(s.text))
    expect(withDotZero.length).toBeGreaterThan(50)
  })
})
