import { readProject } from '@prismbinder/model'
import { describe, expect, it } from 'vitest'
import { mvContext, planGraphSheet, planMvGraph } from './mv.js'
import { planChart, provenanceOf } from './plan.js'
import { corpusBundles } from './testing/corpus.node.js'

/**
 * Charts drawn on the axes Prism chose, rather than on axes we worked out.
 *
 * This is the first thing read out of the legacy graph binary and used. The
 * blob is a framed chunk stream (see `@prismbinder/formats`), one chunk is an
 * axis, and it states both the extent of what was plotted and the bounds Prism
 * drew. Matching the first against the numbers in the table is what identifies
 * an axis; the second is then better than anything derivable from the data,
 * because it is the answer rather than a guess at it.
 *
 * The difference is visible in every case below. Nothing here is about
 * cosmetics: an axis range decides where every mark lands.
 */

const bundles = corpusBundles()

interface Planned {
  readonly file: string
  readonly title: string
  readonly x: { min: number; max: number; kind: string }
  readonly y: { min: number; max: number; kind: string }
  readonly usedFile: boolean
}

function plans(): Planned[] {
  const out: Planned[] = []
  for (const f of bundles) {
    const { value } = readProject(f.bytes, f.name)
    if (value === undefined) continue
    for (const sheet of value.sheets) {
      if (sheet.kind !== 'data') continue
      const spec = planChart(sheet.table, sheet.title, provenanceOf(sheet))
      out.push({
        file: f.name,
        title: sheet.title,
        x: { min: spec.axisX.min, max: spec.axisX.max, kind: spec.axisX.kind },
        y: { min: spec.axisY.min, max: spec.axisY.max, kind: spec.axisY.kind },
        usedFile: sheet.graphAxes !== undefined,
      })
    }
  }
  return out
}

const planned = bundles.length === 0 ? [] : plans()
const find = (file: string, title: string) =>
  planned.find((p) => p.file.startsWith(file) && p.title.includes(title))

describe.skipIf(planned.length === 0)('axes read from the graph', () => {
  it('reaches the sheets a graph was drawn from', () => {
    expect(planned.some((p) => p.usedFile)).toBe(true)
  })

  it('uses the round bounds Prism chose, not the extent of the data', () => {
    // The elbow plot's WCSS runs 920.006 to 2301. Nobody draws an axis there,
    // and Prism does not: it draws 0 to 2500. Deriving bounds from the data
    // cannot produce that number, so seeing it is proof the file was read.
    const elbow = find('Wine', 'Elbow plot')
    expect(elbow).toBeDefined()
    expect(elbow?.y.min).toBe(0)
    expect(elbow?.y.max).toBe(2500)
    expect(elbow?.x.min).toBe(0)
    expect(elbow?.x.max).toBe(9)
  })

  it('takes the logarithmic scale from the file rather than being told', () => {
    // A dose-response X spanning 0.1 to 1000. Prism drew it logarithmically
    // over 0.01 to 10000, and the flag for that sits in the axis chunk - which
    // is readable only because the corpus ships the same data drawn both ways,
    // in `Geometric mean.pzt`, and the two blobs differ there and nowhere else
    // that matters.
    const fit = find('MV- Simple Nonlinear Regression', 'XY data')
    expect(fit).toBeDefined()
    expect(fit?.x.kind).toBe('log')
    expect(fit?.x.min).toBeCloseTo(0.01, 10)
    expect(fit?.x.max).toBeCloseTo(10000, 6)
  })

  it('refuses a match it is not sure of, rather than applying the nearest axis', () => {
    // The same graph states a Y axis of 0 to 150 over data running 2.07 to
    // 108.78. Our own Y extent for that sheet is 4.63 to 112.24, because the
    // chart shows error bars the recorded extent does not, so the two do not
    // agree and the axis is left alone. Taking it anyway would be the easy
    // mistake: the numbers are plausible and the result would be wrong.
    const fit = find('MV- Simple Nonlinear Regression', 'XY data')
    expect(fit?.y.min).not.toBe(0)
    expect(fit?.y.max).not.toBe(150)
  })

  it('leaves a chart alone when no graph was drawn from its sheet', () => {
    // Most sheets have no graph. Those keep bounds derived from their numbers,
    // and a chart that quietly claimed otherwise would be worse than one that
    // says plainly where its axis came from.
    const untouched = planned.filter((p) => !p.usedFile)
    expect(untouched.length).toBeGreaterThan(0)
  })

  it('says on the chart that the axis came from the file', () => {
    const sheet = bundles
      .flatMap((f) => readProject(f.bytes, f.name).value?.sheets ?? [])
      .find((s) => s.kind === 'data' && s.graphAxes !== undefined)
    expect(sheet).toBeDefined()
    if (sheet?.kind !== 'data') return
    const spec = planChart(sheet.table, sheet.title, provenanceOf(sheet))
    expect(spec.notes.join(' ')).toMatch(/axis range and scale are the ones Prism drew/)
    // Still a reconstruction. Prism's axes do not make it Prism's figure, and
    // the badge has to keep meaning what it says.
    expect(spec.fidelity).toBe('reconstructed')
  })
})

describe.skipIf(bundles.length === 0)('the kind of chart Prism drew', () => {
  const sheets = bundles
    .flatMap((f) => (readProject(f.bytes, f.name).value?.sheets ?? []).map((s) => ({ f, s })))
    .filter((x) => x.s.kind === 'data' && x.s.graphType !== undefined)

  const of = (file: string, title: string) =>
    sheets.find((x) => x.f.name.startsWith(file) && x.s.title.includes(title))

  it('reads a stated kind for every graph in the corpus', () => {
    expect(sheets.length).toBeGreaterThan(10)
  })

  it('takes the drawn kind over the one the table shape suggests', () => {
    /**
     * The four choices in the corpus that the file overrules, and why each is
     * an improvement:
     *
     * - a paired t test's estimation plot is a before-after plot, not a scatter
     * - a multiple-comparisons interval plot is a horizontal bar chart
     * - two replicate XY tables are drawn as XY, showing every repeat, where we
     *   would have summarised them into means with error bars
     *
     * None of these is derivable from the table: a column table can be drawn
     * six different ways and its shape says nothing about which was chosen.
     */
    const cases: [string, string, string][] = [
      ['MV- Paired t test', 'Paired t test', 'beforeAfter'],
      ['MV- Multifactor ANOVA', 'Mul. comp. CI plot', 'bar'],
      ['MV- Simple Nonlinear Regression', 'XY data', 'xy'],
    ]
    for (const [file, title, want] of cases) {
      const found = of(file, title)
      expect(found, `${file}::${title}`).toBeDefined()
      if (found?.s.kind !== 'data') continue
      const spec = planChart(found.s.table, found.s.title, provenanceOf(found.s))
      expect(spec.kind, `${file}::${title}`).toBe(want)
    }
  })

  it('lays a horizontal graph on its side, as Prism drew it', () => {
    // Graph kind 2 in the shipped samples is `Bars extending left and right`,
    // `Population pyramid` and `Odds ratio (Forest plot)`, all horizontal.
    const ci = of('MV- Multifactor ANOVA', 'Mul. comp. CI plot')
    if (ci?.s.kind !== 'data') throw new Error('expected the CI plot sheet')
    expect(planChart(ci.s.table, ci.s.title, provenanceOf(ci.s)).horizontal).toBe(true)
  })

  it('leaves the choice alone for a kind whose meaning is not established', () => {
    // Value 1 covers pie charts, donut charts, grouped bars and a bubble plot
    // in the shipped samples. Nothing reads that set, so a table carrying it
    // gets the same chart it would have got with no graph at all.
    const grouped = sheets.find((x) => x.s.kind === 'data' && x.s.graphType === 1)
    expect(grouped).toBeDefined()
    if (grouped?.s.kind !== 'data') return
    const withGraph = planChart(grouped.s.table, grouped.s.title, provenanceOf(grouped.s))
    const without = planChart(grouped.s.table, grouped.s.title, {
      ...(grouped.s.producedBy === undefined ? {} : { producedBy: grouped.s.producedBy }),
    })
    expect(withGraph.kind).toBe(without.kind)
  })
})

describe.skipIf(bundles.length === 0)('when two graphs draw the same data', () => {
  /**
   * Prism lets a document draw one table more than once, and the drawings need
   * not agree. `Geometric mean.pzt` holds the same two datasets as a linear
   * graph and as a logarithmic one; `Time line.pzt` holds an XY plot whole and
   * again zoomed to a segment. Keeping whichever the archive listed first chose
   * an answer by entry order and then told the reader it was Prism's.
   */
  const project = (file: string) => {
    const f = bundles.find((b) => b.name.startsWith(file))
    return f === undefined ? undefined : readProject(f.bytes, f.name).value
  }

  it('uses neither, rather than whichever came first', () => {
    const p = project('Geometric mean')
    expect(p, 'Geometric mean.pzt is needed for this').toBeDefined()
    const disputed = p?.sheets.find((s) => s.kind === 'data' && s.title === 'Data 1')
    expect(disputed).toBeDefined()
    if (disputed?.kind !== 'data') return
    expect(disputed.graphAxes).toBeUndefined()
    expect(disputed.graphType).toBeUndefined()
  })

  it('says so, rather than leaving the reader to wonder', () => {
    const p = project('Geometric mean')
    expect(p?.notes.join(' ')).toMatch(/more than one graph and those graphs disagree/)
  })

  it('still uses the axis where only one graph draws the data', () => {
    // The fix must not throw away the ordinary case, which is most of them.
    const p = project('Wine')
    const kept = (p?.sheets ?? []).filter((s) => s.kind === 'data' && s.graphAxes !== undefined)
    expect(kept.length).toBeGreaterThan(0)
  })
})

describe.skipIf(bundles.length === 0)('graph sheets whose geometry is the legacy binary', () => {
  const projects = bundles
    .map((f) => readProject(f.bytes, f.name).value)
    .filter((p) => p !== undefined)

  it('draws every graph that names data it can find', () => {
    /**
     * The blob is not decoded and will not be. What it does say - the datasets
     * plotted, each axis, the kind of graph - is enough for a chart, and a
     * chart is more use than a paragraph. Before this every one of these sheets
     * showed "Not rendered".
     *
     * **Not "every graph".** That was asserted here first and held only for the
     * fourteen bundles GraphPad ships. A real user document,
     * `prism2R__demo_dataset.prism`, has four graph sheets whose
     * `inputDataSets` is an empty array: the file says they plot nothing, and
     * a placeholder is then the honest answer rather than a failure. The
     * assertion below is the one that stays true, and it is stronger for it -
     * a graph left blank must have had no data to find, so a regression in
     * resolving datasets shows up here rather than hiding among the ones that
     * were always blank.
     */
    let blank = 0
    let drawn = 0
    for (const p of projects) {
      const ctx = mvContext(p)
      for (const s of p.sheets) {
        if (s.kind !== 'graph') continue
        const read = planMvGraph(s, ctx)
        if (read !== undefined && read.marks.length > 0) {
          drawn++
          continue
        }
        if (planGraphSheet(s, ctx) !== undefined) {
          drawn++
          continue
        }
        blank++
        const findable = s.inputDataSets.some((uid) => ctx.tableForDataSet(uid) !== undefined)
        expect(findable, `${s.title} was left blank with data it could have drawn`).toBe(false)
      }
    }
    // No ratio between the two. A first version required `drawn > blank * 4`,
    // which passes today at 41 against 4 and is a number chosen rather than
    // measured: a corpus that gained more legitimately blank documents would
    // fail it for no reason. The per-sheet check above is what carries the
    // correctness, and this only says the sweep found something to check.
    expect(drawn).toBeGreaterThan(20)
    expect(blank).toBeLessThan(drawn)
  })

  it('still says the marks are ours, whatever the file settled', () => {
    // Prism's axes and Prism's choice of graph do not make it Prism's figure.
    for (const p of projects) {
      const ctx = mvContext(p)
      for (const s of p.sheets) {
        if (s.kind !== 'graph') continue
        const spec = planGraphSheet(s, ctx)
        if (spec !== undefined) expect(spec.fidelity, s.title).toBe('reconstructed')
      }
    }
  })
})

describe.skipIf(bundles.length === 0)('a graph that plots more than one table', () => {
  it('says which table it left out, rather than showing half a figure', () => {
    // Two graphs in the corpus do this, and both are the same shape: a fitted
    // curve lives on its own sheet, so the graph that shows points and curve
    // together names datasets from two tables. Only one is drawn.
    const said: string[] = []
    for (const f of bundles) {
      const p = readProject(f.bytes, f.name).value
      if (p === undefined) continue
      const ctx = mvContext(p)
      for (const s of p.sheets) {
        if (s.kind !== 'graph') continue
        const spec = planGraphSheet(s, ctx)
        for (const n of spec?.notes ?? [])
          if (n.includes('also plots')) said.push(`${f.name}: ${n}`)
      }
    }
    expect(said.length).toBeGreaterThan(0)
    for (const n of said) expect(n).toMatch(/which is not drawn here/)
  })
})
