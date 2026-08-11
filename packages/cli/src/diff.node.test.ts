import { createBundle } from '@prismbinder/formats'
import { describe, expect, it } from 'vitest'
import { buildDiff, formatDiff } from './diff.js'

/**
 * `diff` is the tool you reach for when you want to know whether a write did
 * only what it claimed. These check that it answers that question - and, just
 * as importantly, that it never answers it by printing your data.
 */

const IDS = () => {
  let n = 0
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}

function bundle(cells: string[]): Uint8Array {
  return createBundle({
    tables: [{ title: 'T', columns: [{ title: 'A', cells }] }],
    creationDate: '2026-01-01T00:00:00Z',
    newId: IDS(),
    newToken: () => 'f'.repeat(32),
  })
}

describe('diff', () => {
  it('finds nothing between a file and itself', () => {
    const a = bundle(['1', '2', '3'])
    const r = buildDiff('a', a, 'b', a, true)
    expect(r.entries).toEqual([])
    expect(r.cells).toEqual([])
    expect(formatDiff(r)).toContain('No entry differs.')
  })

  it('names the entries a changed cell touches, and no others', () => {
    const a = bundle(['1', '2', '3'])
    const b = bundle(['1', '999', '3'])
    const r = buildDiff('a', a, 'b', b, true)

    const names = r.entries.map((e) => e.name)
    expect(names.some((n) => n.endsWith('data.csv'))).toBe(true)
    // Nothing structural moved, so the sheet and set records stay put.
    expect(names.some((n) => n.endsWith('sheet.json'))).toBe(false)
    expect(names.some((n) => n === 'document.json')).toBe(false)
  })

  it('locates the cell that changed', () => {
    const a = bundle(['1', '2', '3'])
    const b = bundle(['1', '999', '3'])
    const r = buildDiff('a', a, 'b', b, true)
    expect(r.cells).toEqual([{ sheet: 'T', row: 1, column: 0, kind: 'changed' }])
  })

  it('tells an added cell from a changed one', () => {
    const a = buildDiff('a', bundle(['1', '', '3']), 'b', bundle(['1', '2', '3']), true)
    expect(a.cells?.[0]?.kind).toBe('added')

    const b = buildDiff('a', bundle(['1', '2', '3']), 'b', bundle(['1', '', '3']), true)
    expect(b.cells?.[0]?.kind).toBe('removed')
  })

  it('reports which JSON path differs, not what it holds', () => {
    const a = createBundle({
      tables: [{ title: 'T', columns: [{ title: 'A', cells: ['1'] }] }],
      creationDate: '2026-01-01T00:00:00Z',
      minPrismVersion: '10.1.0',
      newId: IDS(),
      newToken: () => 'f'.repeat(32),
    })
    const b = createBundle({
      tables: [{ title: 'T', columns: [{ title: 'A', cells: ['1'] }] }],
      creationDate: '2026-01-01T00:00:00Z',
      minPrismVersion: '11.0.0',
      newId: IDS(),
      newToken: () => 'f'.repeat(32),
    })

    const r = buildDiff('a', a, 'b', b, false)
    const doc = r.structure.find((s) => s.entry === 'document.json')
    expect(doc?.paths).toEqual(['~ minPrismVersion'])

    // The values themselves stay out of the report: some documents are
    // unpublished data and a diff often ends up in a CI log.
    const printed = formatDiff(r)
    expect(printed).toContain('minPrismVersion')
    expect(printed).not.toContain('11.0.0')
    expect(printed).not.toContain('10.1.0')
  })

  it('compares cells across formats, where entry comparison cannot', () => {
    // A .pzfx has no ZIP entries to line up, so the first two layers report
    // that they do not apply rather than pretending the files are unrelated.
    const zip = bundle(['1'])
    const notZip = new TextEncoder().encode('<?xml version="1.0"?><nope/>')
    const r = buildDiff('a.prism', zip, 'b.pzfx', notZip, false)
    expect(r.comparable).toBe(false)
    expect(r.diagnostics.some((d) => d.code === 'diff/not-both-bundles')).toBe(true)
  })

  it('flags a differing sheet count instead of silently pairing what it can', () => {
    const one = bundle(['1'])
    const two = createBundle({
      tables: [
        { title: 'T', columns: [{ title: 'A', cells: ['1'] }] },
        { title: 'U', columns: [{ title: 'B', cells: ['2'] }] },
      ],
      creationDate: '2026-01-01T00:00:00Z',
      newId: IDS(),
      newToken: () => 'f'.repeat(32),
    })
    const r = buildDiff('a', one, 'b', two, true)
    expect(r.diagnostics.some((d) => d.code === 'diff/sheet-count')).toBe(true)
  })
})
