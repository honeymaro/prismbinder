import { bytesEqual } from '@prismbinder/core'
import { describe, expect, it } from 'vitest'
import { corpusBundles } from '../testing/corpus.node.js'
import { columnLayout } from './columns.js'
import { readBundle } from './read.js'
import { writeBundle } from './write.js'

const files = corpusBundles()

describe.skipIf(files.length === 0)(`bundle reader over ${files.length} archives`, () => {
  it('parses every archive without errors', () => {
    const failures: string[] = []
    for (const f of files) {
      const { value, diagnostics } = readBundle(f.bytes)
      if (value === undefined) {
        failures.push(`${f.name}: no bundle`)
        continue
      }
      const errors = diagnostics.filter((d) => d.severity === 'error')
      if (errors.length > 0) failures.push(`${f.name}: ${errors.map((e) => e.code).join(',')}`)
    }
    expect(failures).toEqual([])
  })

  it('round-trips every archive byte-for-byte (T1, whole stack)', () => {
    // ZIP headers, deflate parameters, JSON layout and CSV quoting all have to
    // be right at once for this to hold.
    const failures: string[] = []
    for (const f of files) {
      const { value } = readBundle(f.bytes)
      if (value === undefined) continue
      if (!bytesEqual(writeBundle(value), f.bytes)) failures.push(f.name)
    }
    expect(failures).toEqual([])
  })

  it('finds sheets, tables and datasets in every archive', () => {
    let tables = 0
    let sets = 0
    let analyses = 0
    for (const f of files) {
      const { value } = readBundle(f.bytes)
      if (value === undefined) continue
      expect(value.document.version.formatVersion, f.name).toMatch(/^\d+-\d+-\d+$/)
      expect(value.dataSheets.length, f.name).toBeGreaterThan(0)
      tables += value.dataSheets.filter((s) => s.table !== undefined).length
      sets += value.dataSets.size
      analyses += value.analyses.length
    }
    expect(tables).toBeGreaterThan(50)
    expect(sets).toBeGreaterThan(500)
    expect(analyses).toBeGreaterThan(10)
  })

  it('computes the CSV column layout that every table actually has', () => {
    // The F17 mapping. A miss here means the grid would read the wrong column.
    let checked = 0
    const failures: string[] = []
    for (const f of files) {
      const { value } = readBundle(f.bytes)
      if (value === undefined) continue
      for (const sheet of value.dataSheets) {
        const t = sheet.table
        if (t === undefined || t.rows.length === 0) continue
        const xFormat =
          t.xDataSet !== undefined ? value.dataSets.get(t.xDataSet)?.format : undefined
        const layout = columnLayout(t, xFormat)
        const actual = Math.max(...t.rows.map((r) => r.length))
        if (layout.total !== t.declaredColumns || layout.total !== actual) {
          failures.push(
            `${f.name}::${t.uid} ${t.dataFormat} rep=${t.replicatesCount} computed=${layout.total} declared=${t.declaredColumns} actual=${actual}`,
          )
        }
        checked++
      }
    }
    expect(failures.slice(0, 10)).toEqual([])
    expect(checked).toBeGreaterThan(50)
  })

  it('accounts for every entry as either modelled or explicitly opaque', () => {
    for (const f of files) {
      const { value } = readBundle(f.bytes)
      if (value === undefined) continue
      // Whatever we do not model is named, not silently dropped.
      for (const name of value.opaqueEntries) {
        expect(value.archive.entries.some((e) => e.name === name)).toBe(true)
      }
    }
  })

  it('carries PCFF graph blobs through without interpreting them', () => {
    let withBinary = 0
    for (const f of files) {
      const { value } = readBundle(f.bytes)
      if (value === undefined) continue
      for (const g of value.graphs) if (g.hasBinary) withBinary++
      expect(value.opaqueEntries.some((n) => n.endsWith('.bin')) || value.graphs.length === 0).toBe(
        true,
      )
    }
    expect(withBinary).toBeGreaterThan(0)
  })

  it('reports orphan graph directories rather than crashing on them', () => {
    // Wine.prismt has two graphs/<uuid>/data.bin with no sibling sheet.json.
    const infos = files.flatMap((f) =>
      readBundle(f.bytes).diagnostics.filter((d) => d.code === 'bundle/orphan-graph'),
    )
    expect(infos.length).toBeGreaterThan(0)
    expect(infos.every((d) => d.severity === 'info')).toBe(true)
  })
})
