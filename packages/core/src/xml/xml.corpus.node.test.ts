import { describe, expect, it } from 'vitest'
import { corpusXmlDocuments } from '../testing/corpus.node.js'
import { parseXmlDocument } from './parse.js'
import { printXml } from './print.js'

const files = corpusXmlDocuments()

describe.skipIf(files.length === 0)(`XML fidelity over ${files.length} documents`, () => {
  it('round-trips every document byte-for-byte', () => {
    const failures: string[] = []
    for (const f of files) {
      const text = new TextDecoder().decode(f.bytes)
      const { value, diagnostics } = parseXmlDocument(text, f.name)
      if (diagnostics.some((d) => d.severity === 'error')) {
        failures.push(`${f.name}: parse error`)
        continue
      }
      if (printXml(value) !== text) failures.push(f.name)
    }
    expect(failures.slice(0, 15)).toEqual([])
  })
})
