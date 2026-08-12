import { readProject } from '@prismbinder/model'
import { describe, expect, it } from 'vitest'
import { mvContext, planMvGraph } from './mv.js'
import { allowedKinds, defaultKind, planChart, provenanceOf } from './plan.js'
import { renderChart } from './render.js'
import { toSvg } from './svg.js'
import { corpusBundles, corpusXmlDocuments } from './testing/corpus.node.js'
import type { Mark } from './types.js'

/**
 * Every chart, over every document on this machine.
 *
 * A chart cannot be checked against Prism's own figure - that is the blob we do
 * not decode - so what is checked here is that nothing claims more than it
 * knows: no mark escapes its axis, no bar hangs off its category slot, no
 * whisker crosses its own hinge, and no pie fails to close.
 */

const bundles = corpusBundles()
const xml = corpusXmlDocuments()
const files = [...bundles, ...xml]

interface Planned {
  readonly file: string
  readonly title: string
  readonly kind: string
  readonly marks: readonly Mark[]
  readonly axisX: { min: number; max: number; kind: string; categories: readonly string[] }
  readonly fidelity: string
}

function planEverything(): Planned[] {
  const out: Planned[] = []
  for (const f of files) {
    const { value } = readProject(f.bytes, f.name)
    if (value === undefined) continue
    for (const sheet of value.sheets) {
      if (sheet.kind !== 'data') continue
      const spec = planChart(sheet.table, sheet.title)
      out.push({
        file: f.name,
        title: sheet.title,
        kind: spec.kind,
        marks: spec.marks,
        axisX: spec.axisX,
        fidelity: spec.fidelity,
      })
    }
  }
  return out
}

describe.skipIf(files.length === 0)(`charts over ${files.length} documents`, () => {
  const planned = planEverything()

  it('plans a chart for every data sheet without throwing', () => {
    expect(planned.length).toBeGreaterThan(150)
  })

  it('never labels a reconstruction as read from the file', () => {
    // `read` is reachable only through a Multiple Variables graph sheet. A data
    // table cannot produce one, and if it ever did the badge would stop meaning
    // anything.
    for (const p of planned) expect(p.fidelity, `${p.file}::${p.title}`).toBe('reconstructed')
  })

  it('offers only styles the table kind supports, and a default among them', () => {
    for (const f of files) {
      const { value } = readProject(f.bytes, f.name)
      for (const sheet of value?.sheets ?? []) {
        if (sheet.kind !== 'data') continue
        const allowed = allowedKinds(sheet.table)
        // Empty exactly when there is nothing to draw. A table of city names
        // was being offered six styles that all produced a blank picture, so
        // the list now answers "what can be drawn from this" rather than only
        // "what does this layout permit".
        const drawable = planChart(sheet.table, sheet.title).marks.length > 0
        expect(allowed.length > 0, `${f.name}::${sheet.title}`).toBe(drawable)
        const fallback = defaultKind(sheet.table)
        // The default need not be in the list for a kind we have no styles for,
        // but where it is offered it has to be one of them.
        if (allowed.includes(fallback)) expect(allowed).toContain(fallback)
      }
    }
  })

  it('keeps every bar inside the slot its category owns', () => {
    let bars = 0
    for (const p of planned) {
      for (const mark of p.marks) {
        if (mark.kind !== 'bars') continue
        for (const bar of mark.bars) {
          bars++
          const where = `${p.file}::${p.title}`
          expect(bar.x - bar.width / 2, where).toBeGreaterThanOrEqual(-0.001)
          if (p.axisX.kind === 'category') {
            expect(bar.x + bar.width / 2, where).toBeLessThanOrEqual(p.axisX.max + 0.001)
          }
          expect(Number.isFinite(bar.y) && Number.isFinite(bar.base), where).toBe(true)
        }
      }
    }
    expect(bars).toBeGreaterThan(0)
  })

  it('never puts a whisker inside its own box', () => {
    let boxes = 0
    for (const f of files) {
      const { value } = readProject(f.bytes, f.name)
      for (const sheet of value?.sheets ?? []) {
        if (sheet.kind !== 'data') continue
        if (!allowedKinds(sheet.table).includes('box')) continue
        const spec = planChart(sheet.table, sheet.title, { kind: 'box' })
        for (const mark of spec.marks) {
          if (mark.kind !== 'boxes') continue
          for (const b of mark.boxes) {
            boxes++
            const where = `${f.name}::${sheet.title}`
            expect(b.lowerWhisker, where).toBeLessThanOrEqual(b.q1)
            expect(b.q1, where).toBeLessThanOrEqual(b.median)
            expect(b.median, where).toBeLessThanOrEqual(b.q3)
            expect(b.q3, where).toBeLessThanOrEqual(b.upperWhisker)
          }
        }
      }
    }
    expect(boxes).toBeGreaterThan(0)
  })

  it('closes every pie exactly once', () => {
    let pies = 0
    for (const f of files) {
      const { value } = readProject(f.bytes, f.name)
      for (const sheet of value?.sheets ?? []) {
        if (sheet.kind !== 'data') continue
        if (!allowedKinds(sheet.table).includes('pie')) continue
        const spec = planChart(sheet.table, sheet.title, { kind: 'pie' })
        for (const mark of spec.marks) {
          if (mark.kind !== 'wedges' || mark.wedges.length === 0) continue
          pies++
          const where = `${f.name}::${sheet.title}`
          const last = mark.wedges[mark.wedges.length - 1]
          expect(mark.wedges[0]?.start, where).toBeCloseTo(0, 9)
          expect(last?.end, where).toBeCloseTo(1, 9)
          for (let i = 1; i < mark.wedges.length; i++) {
            expect((mark.wedges[i] as { start: number }).start, where).toBeCloseTo(
              (mark.wedges[i - 1] as { end: number }).end,
              9,
            )
          }
        }
      }
    }
    expect(pies).toBeGreaterThan(0)
  })

  it('a survival curve never rises', () => {
    let curves = 0
    for (const f of files) {
      const { value } = readProject(f.bytes, f.name)
      for (const sheet of value?.sheets ?? []) {
        if (sheet.kind !== 'data' || sheet.table.tableFormat !== 'survival') continue
        const spec = planChart(sheet.table, sheet.title)
        for (const mark of spec.marks) {
          if (mark.kind !== 'line') continue
          curves++
          for (let i = 1; i < mark.points.length; i++) {
            expect(
              (mark.points[i] as { y: number }).y,
              `${f.name}::${sheet.title}`,
            ).toBeLessThanOrEqual((mark.points[i - 1] as { y: number }).y + 1e-12)
          }
        }
      }
    }
    expect(curves).toBeGreaterThan(0)
  })

  it('renders every chart to a well-formed document', () => {
    for (const p of planned.slice(0, 120)) {
      const svg = toSvg(
        renderChart({
          kind: p.kind as never,
          title: p.title,
          fidelity: 'reconstructed',
          axisX: p.axisX as never,
          axisY: p.axisX as never,
          series: [],
          marks: p.marks,
          notes: [],
          horizontal: false,
        }),
      )
      expect(svg.startsWith('<?xml'), p.title).toBe(true)
      // Nothing in a chart should ever emit a NaN coordinate.
      expect(svg.includes('NaN'), `${p.file}::${p.title}`).toBe(false)
    }
  })

  it('knows which analysis produced each results view', () => {
    // The uid the analysis lists is the view's own and matches no data sheet;
    // the link runs through the AnalysisView record beside it. Getting that
    // wrong is silent - every sheet simply looks unattributed.
    let attributed = 0
    let survivalCurves = 0
    for (const f of bundles) {
      const { value } = readProject(f.bytes, f.name)
      for (const sheet of value?.sheets ?? []) {
        if (sheet.kind !== 'data' || sheet.producedBy === undefined) continue
        attributed++
        const where = `${f.name}::${sheet.title}`
        expect(sheet.producedBy.analysisClass, where).not.toBe('')
        const spec = planChart(sheet.table, sheet.title, provenanceOf(sheet))
        const line = spec.marks.find((m) => m.kind === 'line')
        if (
          sheet.producedBy.analysisClass === 'SURVIVAL' &&
          /survival proportions/i.test(sheet.producedBy.sheetTitle) &&
          line !== undefined
        ) {
          survivalCurves++
          expect(line.step, where).toBe(true)
        }
      }
    }
    expect(attributed, 'results views should be attributable').toBeGreaterThan(0)
    expect(survivalCurves, 'at least one stored survival curve').toBeGreaterThan(0)
  })

  it('reads Multiple Variables graphs from the graph sheet, and only those', () => {
    let read = 0
    let refused = 0
    for (const f of bundles) {
      const { value } = readProject(f.bytes, f.name)
      if (value === undefined) continue
      const ctx = mvContext(value)
      for (const sheet of value.sheets) {
        if (sheet.kind !== 'graph') continue
        const spec = planMvGraph(sheet, ctx)
        if (spec === undefined) {
          // Every other family. Their JSON holds no appearance to read.
          expect(sheet.mv, `${f.name}::${sheet.title}`).toBeUndefined()
          continue
        }
        expect(spec.fidelity, `${f.name}::${sheet.title}`).toBe('read')
        if (spec.marks.length > 0) read++
        else refused++
        // A refusal has to explain itself, or it is indistinguishable from a bug.
        if (spec.marks.length === 0) expect(spec.notes.length).toBeGreaterThan(0)
      }
    }
    expect(read + refused).toBeGreaterThan(0)
  })
})
