import { bytesEqual, readEntry } from '@prismbinder/core'
import { describe, expect, it } from 'vitest'
import { createBundle } from './create.js'
import { readBundle } from './read.js'
import { writeBundle } from './write.js'

let n = 0
const deterministic = {
  newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  newToken: () => 'b'.repeat(32),
  creationDate: '2026-01-01T00:00:00Z',
}

const sample = () =>
  createBundle({
    tables: [
      {
        title: 'Demo',
        rowTitles: ['first', 'second', 'third'],
        columns: [
          { title: 'Control', cells: ['1', '2.5', '3'] },
          { title: 'Treated', cells: ['4', '5', '6.25'] },
        ],
      },
    ],
    ...deterministic,
  })

describe('createBundle', () => {
  it('produces something our own reader understands', () => {
    const { value, diagnostics } = readBundle(sample())
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(value).toBeDefined()
    expect(value?.dataSheets).toHaveLength(1)
    expect(value?.dataSheets[0]?.title).toBe('Demo')
    expect(value?.dataSets.size).toBe(3) // row titles + two columns
  })

  it('round-trips byte-for-byte, like a file Prism wrote', () => {
    const bytes = sample()
    const { value } = readBundle(bytes)
    expect(bytesEqual(writeBundle(value!), bytes)).toBe(true)
  })

  it('lays the columns out the way the format specifies', () => {
    const table = readBundle(sample()).value?.dataSheets[0]?.table
    expect(table?.rows).toEqual([
      ['first', '1', '4'],
      ['second', '2.5', '5'],
      ['third', '3', '6.25'],
    ])
    expect(table?.declaredRows).toBe(3)
    expect(table?.declaredColumns).toBe(3)
  })

  it("reproduces Prism's ZIP metadata profile exactly", () => {
    const { value } = readBundle(sample())
    const shapes = new Set(
      value?.archive.entries.map(
        (e) =>
          `${e.isDirectory ? 'dir' : 'file'} cv=${e.meta.createVersion} ev=${e.meta.extractVersion} flag=${e.meta.flag} m=${e.meta.method} attr=${e.meta.externalAttrs.toString(16)}`,
      ),
    )
    // The same three shapes, and only those three, that every real archive has.
    expect([...shapes].sort()).toEqual([
      'dir cv=831 ev=20 flag=0 m=0 attr=41ff0000',
      'file cv=831 ev=20 flag=4 m=8 attr=81b60000',
      'file cv=831 ev=45 flag=4 m=8 attr=81b60000',
    ])
  })

  it('puts the four-space JSON style only where Prism puts it', () => {
    const { value } = readBundle(sample())
    const content = value?.archive.entries.find((e) => e.name.endsWith('/content.json'))
    const doc = value?.archive.entries.find((e) => e.name === 'document.json')
    expect(content).toBeDefined()
    expect(doc).toBeDefined()
    const text = (e: typeof content) => new TextDecoder().decode(readEntry(e!).value)
    expect(text(content)).toMatch(/\n {4}"numberOfColumns"/)
    expect(text(content).endsWith('\n')).toBe(true)
    expect(text(doc)).toMatch(/\n\t"@class"/)
    expect(text(doc).endsWith('\n')).toBe(false)
  })

  it('writes no account name', () => {
    const { value } = readBundle(sample())
    expect(value?.document.createdBy?.user).toBe('')
    expect(value?.document.modifiedBy?.user).toBe('')
    expect(value?.document.createdBy?.name).toBe('prismbinder')
  })

  it('declares a compatibility floor old enough to be widely openable', () => {
    const { value } = readBundle(sample())
    expect(value?.document.version.minPrismVersion).toBe('10.1.0')
  })
})
