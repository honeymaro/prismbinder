import { bytesEqual } from '@prismbinder/core'
import { describe, expect, it } from 'vitest'
import { corpusXmlDocuments } from '../testing/corpus.node.js'
import { readPzfx } from './read.js'
import { writePzfx } from './write.js'

const files = corpusXmlDocuments()

describe.skipIf(files.length === 0)(`pzfx reader over ${files.length} documents`, () => {
  it('round-trips every document byte-for-byte', () => {
    const failures: string[] = []
    for (const f of files) {
      const { value } = readPzfx(f.bytes, f.name)
      if (value === undefined) continue
      if (!bytesEqual(writePzfx(value), f.bytes)) failures.push(f.name)
    }
    expect(failures.slice(0, 15)).toEqual([])
  })

  it('parses documents whether or not the root declares a namespace', () => {
    let withNs = 0
    let withoutNs = 0
    let parsed = 0
    for (const f of files) {
      const { value } = readPzfx(f.bytes, f.name)
      if (value === undefined) continue
      parsed++
      if (value.hasNamespace) withNs++
      else withoutNs++
    }
    expect(parsed).toBeGreaterThan(100)
    // Both shapes really occur; keying on the namespace would drop the second group.
    expect(withNs).toBeGreaterThan(0)
    expect(withoutNs).toBeGreaterThan(0)
  })

  it('finds tables, columns and cells', () => {
    let tables = 0
    let cells = 0
    for (const f of files) {
      const { value } = readPzfx(f.bytes, f.name)
      if (value === undefined) continue
      tables += value.tables.length
      for (const t of value.tables)
        for (const c of t.yColumns) for (const s of c.subcolumns) cells += s.cells.length
    }
    expect(tables).toBeGreaterThan(100)
    expect(cells).toBeGreaterThan(10000)
  })

  it('reads a table out of every document that contains one', () => {
    /**
     * The sum above cannot see a single file returning zero, and for a long
     * time one did: every `HugeTable` document read as empty. The lesson is
     * M11's, one step further along - a suite is only as honest as the shape of
     * what it asserts, not merely as the inputs it was shown.
     *
     * The expectation comes from the raw XML rather than from the reader, so
     * this does not check the reader against itself.
     *
     * `/` is in the character class because every attribute of `Table` is
     * optional in GraphPad's schema, so `<Table/>` is legal. No document has
     * one, and if one arrives the mismatch surfaces as `read > declared`
     * rather than being missed - but there is no reason to leave the sharp
     * edge in.
     */
    const wrong: string[] = []
    for (const f of files) {
      const text = new TextDecoder().decode(f.bytes)
      const declared = (text.match(/<(?:Huge)?Table[\s>/]/g) ?? []).length
      const { value } = readPzfx(f.bytes, f.name)
      const read = value?.tables.length ?? 0
      if (declared > 0 && read === 0) wrong.push(`${f.name}: ${declared} declared, none read`)
      if (read > declared) wrong.push(`${f.name}: read ${read} but only ${declared} declared`)
    }
    expect(wrong).toEqual([])
  })

  it('tolerates ragged subcolumns rather than assuming a rectangle', () => {
    let ragged = 0
    for (const f of files) {
      const { value } = readPzfx(f.bytes, f.name)
      if (value === undefined) continue
      for (const t of value.tables) {
        const lengths = new Set<number>()
        for (const c of t.yColumns) for (const s of c.subcolumns) lengths.add(s.cells.length)
        if (lengths.size > 1) ragged++
      }
    }
    expect(ragged).toBeGreaterThan(0)
  })

  it('reports the opaque template rather than pretending to read it', () => {
    const withTemplate = files.filter((f) => readPzfx(f.bytes, f.name).value?.hasTemplate === true)
    const withoutTemplate = files.filter(
      (f) => readPzfx(f.bytes, f.name).value?.hasTemplate === false,
    )
    expect(withTemplate.length).toBeGreaterThan(0)
    // Documents with no template are normal, not broken.
    expect(withoutTemplate.length).toBeGreaterThan(0)
  })
})
