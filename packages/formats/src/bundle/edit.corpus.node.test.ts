import { bytesEqual, decodeUtf8, readEntry, readZip } from '@prismbinder/core'
import { describe, expect, it } from 'vitest'
import { corpusBundles } from '../testing/corpus.node.js'
import { anonymizeBundle, applyCellEdits } from './edit.js'
import { readBundle } from './read.js'
import { writeBundleWith } from './write.js'

const files = corpusBundles()
const pick = () => {
  for (const f of files) {
    const { value } = readBundle(f.bytes)
    const sheet = value?.dataSheets.find((s) => (s.table?.rows.length ?? 0) > 2)
    if (value !== undefined && sheet?.table !== undefined) return { f, bundle: value, sheet }
  }
  return undefined
}
const target = pick()

describe.skipIf(target === undefined)('T2 - mutation round trip', () => {
  it('changes only the entries it declared it would change', () => {
    const { f, bundle, sheet } = target!
    const before = readZip(f.bytes).value

    const { updates, diagnostics } = applyCellEdits(
      bundle,
      [{ sheetId: sheet.uid, row: 0, column: 1, value: '123.456' }],
      { revisionToken: () => 'a'.repeat(32) },
    )
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(false)

    const out = writeBundleWith(bundle, updates)
    const after = readZip(out).value

    // Same entries, same order - nothing added, removed or shuffled.
    expect(after.entries.map((e) => e.name)).toEqual(before.entries.map((e) => e.name))

    // Every entry outside the declared set is byte-identical.
    const changed = new Set(updates.keys())
    const unexpected: string[] = []
    for (let i = 0; i < before.entries.length; i++) {
      const a = before.entries[i]!
      const b = after.entries[i]!
      if (changed.has(a.name)) continue
      if (!bytesEqual(a.stored, b.stored)) unexpected.push(a.name)
    }
    expect(unexpected).toEqual([])
  })

  it('the edited value survives a reparse', () => {
    const { bundle, sheet } = target!
    const { updates } = applyCellEdits(bundle, [
      { sheetId: sheet.uid, row: 0, column: 1, value: '123.456' },
    ])
    const out = writeBundleWith(bundle, updates)
    const reparsed = readBundle(out).value!
    const table = reparsed.dataSheets.find((s) => s.uid === sheet.uid)?.table
    expect(table?.rows[0]?.[1]).toBe('123.456')
  })

  it('leaves the stale count caches alone', () => {
    // Prism does not maintain realsCount and friends; recomputing them would
    // rewrite 192 records in this corpus for no benefit.
    const { bundle, sheet } = target!
    const { updates } = applyCellEdits(bundle, [
      { sheetId: sheet.uid, row: 0, column: 1, value: '123.456' },
    ])
    for (const [name, bytes] of updates) {
      if (!name.startsWith('data/sets/')) continue
      const original = bundle.archive.entries.find((e) => e.name === name)
      if (original === undefined) continue
      const beforeJson = JSON.parse(decodeUtf8(readEntry(original).value)) as Record<
        string,
        unknown
      >
      const afterJson = JSON.parse(decodeUtf8(bytes)) as Record<string, unknown>
      for (const key of ['realsCount', 'integersCount', 'textsCount', 'decimalsLength']) {
        expect(afterJson[key], `${name}.${key}`).toEqual(beforeJson[key])
      }
    }
  })

  it('writes no user name into a saved document by default', () => {
    const { bundle, sheet } = target!
    const { updates } = applyCellEdits(bundle, [
      { sheetId: sheet.uid, row: 0, column: 1, value: '1' },
    ])
    const doc = JSON.parse(decodeUtf8(updates.get('document.json') as Uint8Array)) as {
      modifiedBy?: { name: string; user: string }
    }
    expect(doc.modifiedBy?.user).toBe('')
    expect(doc.modifiedBy?.name).toBe('prismbinder')
  })

  it('an empty edit list produces no changes at all', () => {
    const { bundle } = target!
    expect(applyCellEdits(bundle, []).updates.size).toBe(0)
  })
})

describe.skipIf(target === undefined)('anonymize', () => {
  it('clears the account names but changes nothing else', () => {
    const { f, bundle } = target!
    const updates = anonymizeBundle(bundle)
    const out = writeBundleWith(bundle, updates)
    const after = readBundle(out).value!

    expect(after.document.createdBy?.user).toBe('')
    expect(after.document.modifiedBy?.user).toBe('')
    // Everything except document.json is untouched.
    const before = readZip(f.bytes).value
    const post = readZip(out).value
    for (let i = 0; i < before.entries.length; i++) {
      if (before.entries[i]!.name === 'document.json') continue
      expect(bytesEqual(before.entries[i]!.stored, post.entries[i]!.stored)).toBe(true)
    }
  })
})

describe.skipIf(target === undefined)('shape changes', () => {
  it('updates content.json when a row is appended', () => {
    const { bundle, sheet } = target!
    const table = sheet.table!
    const width = Math.max(...table.rows.map((r) => r.length))

    // Writing past the last row is rejected rather than silently ignored...
    const rejected = applyCellEdits(bundle, [
      { sheetId: sheet.uid, row: table.rows.length, column: 0, value: 'x' },
    ])
    expect(rejected.diagnostics.some((d) => d.code === 'edit/row-out-of-range')).toBe(true)

    // ...and widening a row updates the declared column count.
    const { updates } = applyCellEdits(bundle, [
      { sheetId: sheet.uid, row: 0, column: width, value: 'extra' },
    ])
    const content = updates.get(`data/tables/${table.uid}/content.json`)
    expect(content, 'content.json was rewritten').toBeDefined()
    const parsed = JSON.parse(decodeUtf8(content as Uint8Array)) as { numberOfColumns: number }
    expect(parsed.numberOfColumns).toBe(width + 1)
  })
})
