import { readProject } from '@prismbinder/model'
import { describe, expect, it } from 'vitest'
import { planChart } from './plan.js'
import { corpusBundles, corpusXmlDocuments } from './testing/corpus.node.js'

/**
 * Our chart against the curve Prism itself drew.
 *
 * Prism's figures are PCFF and nobody outside GraphPad decodes them, so a chart
 * normally cannot be compared against Prism's at all. A curve fit is the one
 * exception, and it needs no licence: Prism writes the fitted curve into an
 * ordinary data table of a thousand rows. That table is its rendered line,
 * sampled finely enough to compare point by point, and it sits in the corpus
 * already.
 *
 * Two of these tables carry no X column at all - the X values are generated
 * from a `startValue` and an `interval`, and a reader that walks only the
 * stored columns loses the axis entirely. So this is also the only end-to-end
 * check of the series rule against something Prism produced rather than
 * against our own reading of it.
 *
 * What is checked is what could actually go wrong: that the axis holds the
 * whole curve, that the thousand points arrive in order and evenly spaced, and
 * that a curve is drawn as one connected line rather than a thousand loose
 * symbols. A polyline that doubles back is the defect that put a connecting
 * line through the replicates, and over a thousand points it is unmissable.
 */

const files = [...corpusBundles(), ...corpusXmlDocuments()]

interface Curve {
  readonly file: string
  readonly title: string
  /**
   * Position in `sheets`, not the title. `MV- Simple Nonlinear Regression`
   * holds two sheets with the same name and different X columns - one storing
   * its X, one generating it - so looking a curve up by title picks whichever
   * comes first and silently tests the wrong one.
   */
  readonly index: number
  readonly rows: number
  readonly generatedX: boolean
}

/**
 * The fitted-curve sheets.
 *
 * Found by shape rather than by title: a sheet an analysis produced, holding
 * far more rows than anyone types by hand, with an X column and something
 * numeric to plot against it. Matching on the name `:Curve` would work on this
 * corpus and break on a document in any other language.
 */
function curveSheets(): Curve[] {
  const out: Curve[] = []
  for (const f of files) {
    const { value } = readProject(f.bytes, f.name)
    if (value === undefined) continue
    value.sheets.forEach((sheet, index) => {
      if (sheet.kind !== 'data' || sheet.producedBy === undefined) return
      const t = sheet.table
      if (t.rowCount < 500) return
      const x = t.columns.find((c) => c.role === 'x')
      if (x === undefined) return
      if (!t.columns.some((c) => c.role === 'y')) return
      out.push({
        file: f.name,
        title: sheet.title,
        index,
        rows: t.rowCount,
        generatedX: x.generated,
      })
    })
  }
  return out
}

const curves = curveSheets()

/** Replans a curve sheet, since the plan is what is under test. */
function planOf(c: Curve) {
  const f = files.find((x) => x.name === c.file)
  if (f === undefined) return undefined
  const { value } = readProject(f.bytes, f.name)
  const sheet = value?.sheets[c.index]
  if (sheet === undefined || sheet.kind !== 'data') return undefined
  return planChart(sheet.table, sheet.title)
}

describe.skipIf(curves.length === 0)(`curves Prism drew, over ${curves.length} sheets`, () => {
  it('finds the fitted curves, including the ones with no stored X', () => {
    // The generated-X case is the one that silently loses an axis, so its
    // presence is asserted rather than assumed.
    expect(curves.length).toBeGreaterThan(0)
    expect(curves.some((c) => c.generatedX)).toBe(true)
    for (const c of curves) expect(c.rows, `${c.file}::${c.title}`).toBeGreaterThanOrEqual(500)
  })

  it('generates X values in order and evenly spaced', () => {
    // `x[i] = startValue + i * interval`. If the arithmetic drifts, the curve
    // is stretched or reversed against the data it was fitted to, and over a
    // thousand points a single wrong step shows up here as a spacing that is
    // not constant.
    for (const c of curves.filter((x) => x.generatedX)) {
      const spec = planOf(c)
      expect(spec, `${c.file}::${c.title}`).toBeDefined()
      const line = spec?.marks.find((m) => m.kind === 'line' || m.kind === 'points')
      expect(line, `${c.file}::${c.title} has no drawn marks`).toBeDefined()
      const xs = (line as { points: readonly { x: number }[] }).points.map((p) => p.x)
      expect(xs.length, `${c.file}::${c.title}`).toBeGreaterThan(100)

      const step = (xs[1] as number) - (xs[0] as number)
      expect(step, `${c.file}::${c.title} has a zero or negative step`).toBeGreaterThan(0)
      let worst = 0
      for (let i = 1; i < xs.length; i++) {
        const d = (xs[i] as number) - (xs[i - 1] as number)
        worst = Math.max(worst, Math.abs(d - step))
      }
      // Accumulated floating point, not a different rule.
      expect(worst, `${c.file}::${c.title} spacing drifts by ${worst}`).toBeLessThan(
        Math.abs(step) * 1e-6,
      )
    }
  })

  it('draws a curve as one connected line, not a thousand loose symbols', () => {
    for (const c of curves) {
      const spec = planOf(c)
      const lines = spec?.marks.filter((m) => m.kind === 'line') ?? []
      expect(lines.length, `${c.file}::${c.title} draws no line`).toBeGreaterThan(0)
      for (const l of lines) {
        if (l.kind !== 'line') continue
        expect(l.step, `${c.file}::${c.title} drew a fitted curve as a staircase`).toBe(false)
        // Monotone in X. A polyline that doubles back is the defect that ran a
        // connecting line through the replicates instead of through the means.
        for (let i = 1; i < l.points.length; i++) {
          const prev = l.points[i - 1] as { x: number }
          const cur = l.points[i] as { x: number }
          expect(
            cur.x >= prev.x,
            `${c.file}::${c.title} doubles back at point ${i}: ${prev.x} then ${cur.x}`,
          ).toBe(true)
        }
      }
    }
  })

  it('leaves an axis wide enough for the whole curve', () => {
    // A thousand points is the easiest thing in the corpus to clip, and a
    // clipped curve is a chart that quietly says something untrue.
    for (const c of curves) {
      const spec = planOf(c)
      if (spec === undefined) continue
      for (const m of spec.marks) {
        if (m.kind !== 'line' && m.kind !== 'points') continue
        for (const p of m.points) {
          expect(
            p.x >= spec.axisX.min && p.x <= spec.axisX.max,
            `${c.file}::${c.title} has x=${p.x} outside [${spec.axisX.min}, ${spec.axisX.max}]`,
          ).toBe(true)
          expect(
            p.y >= spec.axisY.min && p.y <= spec.axisY.max,
            `${c.file}::${c.title} has y=${p.y} outside [${spec.axisY.min}, ${spec.axisY.max}]`,
          ).toBe(true)
        }
      }
    }
  })
})
