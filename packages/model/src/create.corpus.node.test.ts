import { createBundle } from '@prismbinder/formats'
import { describe, expect, it } from 'vitest'
import { readProject } from './adapt.js'
import { corpusBundles } from './testing/corpus.node.js'

/**
 * Does `createBundle` survive the shapes real documents actually have?
 *
 * `create.test.ts` builds a three-column table of its author's choosing, which
 * proves the code runs and proves very little else. This takes every data sheet
 * in every document we can find - 44-column multivariable tables, text columns,
 * replicate subcolumns, thousand-row series, empty cells - reads the cells out,
 * builds a *new* bundle from nothing but those cells, and checks that reading
 * that bundle back yields the same values.
 *
 * What this establishes: the writer handles the real distribution of table
 * shapes, and the create -> read path is information-preserving.
 *
 * What it cannot establish: whether Prism opens the result. Nothing local can.
 * A file Prism wrote tells us what Prism writes, never what it requires, so the
 * synthesised entry set stays unverified until someone opens one. See M6 in
 * docs/measurements.md.
 *
 * Cell values are never printed. Some corpora are unpublished research data,
 * and a test failure is not a reason to spill it into a CI log; failures report
 * coordinates and counts only.
 */

interface FlatTable {
  readonly title: string
  readonly columns: { readonly title: string; readonly cells: readonly string[] }[]
}

/** One grid column per subcolumn - `createBundle` writes `y_single` columns. */
function flatten(title: string, table: import('./types.js').TableView): FlatTable {
  const columns: { title: string; cells: readonly string[] }[] = []
  for (const c of table.columns) {
    c.subcolumns.forEach((cells, i) => {
      columns.push({ title: i === 0 ? c.title : `${c.title} (${i + 1})`, cells })
    })
  }
  return { title, columns }
}

const bundles = corpusBundles()

describe.skipIf(bundles.length === 0)(`synthesis over ${bundles.length} real documents`, () => {
  it('reproduces every data sheet it is given', () => {
    const failures: string[] = []
    let sheets = 0
    let cells = 0

    for (const f of bundles) {
      const project = readProject(f.bytes, f.name).value
      if (project === undefined) continue

      for (const sheet of project.sheets) {
        if (sheet.kind !== 'data') continue
        const source = flatten(sheet.title, sheet.table)
        if (source.columns.length === 0) continue
        sheets++

        const bytes = createBundle({ tables: [source] })
        const { value, diagnostics } = readProject(bytes, 'synthesised.prism')
        const errors = diagnostics.filter((d) => d.severity === 'error')
        if (errors.length > 0) {
          failures.push(`${f.name}::${sheet.title}: ${errors.map((e) => e.code).join(',')}`)
          continue
        }

        const back = value?.sheets.find((s) => s.kind === 'data')
        if (back === undefined || back.kind !== 'data') {
          failures.push(`${f.name}::${sheet.title}: no data sheet came back`)
          continue
        }

        const round = flatten(back.title, back.table)
        if (round.columns.length !== source.columns.length) {
          failures.push(
            `${f.name}::${sheet.title}: ${source.columns.length} columns in, ${round.columns.length} out`,
          )
          continue
        }

        // A trailing run of empty cells is not information: the CSV cannot
        // distinguish "blank" from "absent", and neither can Prism. Compare
        // over the source length and treat a missing cell as blank.
        for (let c = 0; c < source.columns.length; c++) {
          const from = source.columns[c]?.cells ?? []
          const to = round.columns[c]?.cells ?? []
          for (let r = 0; r < from.length; r++) {
            cells++
            if ((from[r] ?? '') !== (to[r] ?? '')) {
              failures.push(`${f.name}::${sheet.title}: cell r${r} c${c} differs`)
              if (failures.length > 20) break
            }
          }
        }
      }
    }

    expect(sheets).toBeGreaterThan(50)
    expect(cells).toBeGreaterThan(10_000)
    expect(failures.slice(0, 20)).toEqual([])
  })

  it('writes archives that read back byte-for-byte', () => {
    // Synthesis has no original to be compared with, so this is the strongest
    // internal check available: whatever we wrote, our reader recovers exactly.
    const failures: string[] = []
    let checked = 0

    for (const f of bundles.slice(0, 8)) {
      const project = readProject(f.bytes, f.name).value
      if (project === undefined) continue
      const tables = project.sheets
        .filter((s) => s.kind === 'data')
        .map((s) => flatten(s.title, s.table))
        .filter((t) => t.columns.length > 0)
      if (tables.length === 0) continue

      // Several sheets in one archive, which the single-table test never covers.
      const bytes = createBundle({ tables })
      const { value } = readProject(bytes, 'synthesised.prism')
      if (value?.sheets.filter((s) => s.kind === 'data').length !== tables.length) {
        failures.push(`${f.name}: ${tables.length} tables in, fewer out`)
        continue
      }
      checked++
    }

    expect(checked).toBeGreaterThan(0)
    expect(failures).toEqual([])
  })
})
