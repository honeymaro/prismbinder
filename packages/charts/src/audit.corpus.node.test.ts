import { readProject } from '@prismbinder/model'
import { describe, expect, it } from 'vitest'
import { mvContext, planMvGraph } from './mv.js'
import { allowedKinds, planChart, provenanceOf } from './plan.js'
import { renderChart } from './render.js'
import { toSvg } from './svg.js'
import { corpusBundles, corpusXmlDocuments } from './testing/corpus.node.js'
import type { ChartSpec, El } from './types.js'

/**
 * Every chart, in every style offered for it, over every document on this
 * machine.
 *
 * The other corpus suite plans one chart per sheet and checks a few families in
 * detail. This one is the sweep: each sheet is planned in every style the
 * picker will offer for it, rendered at a real size, and both the spec and the
 * finished document are checked. That is around eleven hundred charts, and it
 * is the only place where a style nobody looks at gets looked at.
 *
 * It was written as an audit and found five defects on its first run, each of
 * which was invisible to a suite that only ever planned the default style:
 *
 *   half the corpus draws nothing, because those files write `82,90279`
 *   a stack of tied points spread across neighbouring columns and off the axis
 *   a before-after plot coloured by row and captioned by column
 *   a legend that walked off the right edge of the page
 *   an XY table with dates or elapsed times in X drew nothing
 *
 * Findings are collected first and asserted in groups, so a failure names every
 * chart affected rather than the first one.
 */

const files = [...corpusBundles(), ...corpusXmlDocuments()]
const W = 680
const H = 340

type Finding = { readonly group: string; readonly what: string; readonly where: string }
const findings: Finding[] = []
const say = (group: string, what: string, where: string) => findings.push({ group, what, where })

const finite = (n: number): boolean => Number.isFinite(n)

function checkSpec(spec: ChartSpec, where: string) {
  const axes = [
    ['x', spec.axisX],
    ['y', spec.axisY],
  ] as const
  for (const [name, ax] of axes) {
    if (!finite(ax.min) || !finite(ax.max)) say('axes', `${name} bound is not finite`, where)
    else if (ax.min > ax.max) say('axes', `${name} min above max`, where)
    if (ax.kind === 'log' && ax.min <= 0) say('axes', `${name} log scale reaching zero`, where)
  }

  let maxSeries = -1
  let drawn = 0
  /**
   * An axis Prism drew may deliberately show less than the data.
   *
   * `Time line.pzt` ships an XY plot twice, whole and zoomed to 1995..2010 over
   * data from 1918, and the silhouette plot in `Wine.prismt` starts its Y at
   * 0.1 above values reaching 0. Where the bounds came from the file the marks
   * outside them are not a defect, they are what Prism hides; the renderer
   * clips them. Where the bounds are ours, nothing may fall outside, because we
   * derived them from the very marks being checked.
   */
  const clipped = spec.notes.some((n) =>
    n.startsWith('The axis range and scale are the ones Prism'),
  )
  const inX = (v: number) => clipped || (v >= spec.axisX.min - 1e-9 && v <= spec.axisX.max + 1e-9)
  const inY = (v: number) => clipped || (v >= spec.axisY.min - 1e-9 && v <= spec.axisY.max + 1e-9)

  for (const m of spec.marks) {
    if ('series' in m) maxSeries = Math.max(maxSeries, m.series)
    switch (m.kind) {
      case 'points':
      case 'line':
      case 'ticks':
      case 'hull': {
        drawn += m.points.length
        for (const p of m.points) {
          if (!finite(p.x) || !finite(p.y)) say('marks', `${m.kind}: point is not finite`, where)
          else if (!inX(p.x) || !inY(p.y)) {
            say('marks', `${m.kind}: point (${p.x}, ${p.y}) outside the axes`, where)
          }
        }
        break
      }
      case 'errorBars': {
        drawn += m.bars.length
        for (const b of m.bars) {
          if (![b.x, b.y, b.up, b.down].every(finite)) say('marks', 'errorBars: not finite', where)
          else if (b.up < 0 || b.down < 0) say('marks', 'errorBars: negative distance', where)
          else if (!inY(b.y + b.up) || !inY(b.y - b.down)) {
            say('marks', 'errorBars: reaches outside the axes', where)
          }
        }
        break
      }
      case 'bars': {
        drawn += m.bars.length
        for (const b of m.bars) {
          if (![b.x, b.y, b.base, b.width].every(finite)) say('marks', 'bars: not finite', where)
          else if (b.width <= 0) say('marks', 'bars: width is zero or negative', where)
          else if (!inY(b.y) || !inY(b.base)) {
            say('marks', 'bars: reaches outside the axes', where)
          }
        }
        break
      }
      case 'boxes': {
        drawn += m.boxes.length
        for (const b of m.boxes) {
          const five = [b.lowerWhisker, b.q1, b.median, b.q3, b.upperWhisker]
          if (!five.every(finite)) {
            say('marks', 'boxes: five-number summary is not finite', where)
            continue
          }
          for (let i = 1; i < five.length; i++) {
            if ((five[i] as number) < (five[i - 1] as number)) {
              say('marks', `boxes: summary out of order [${five.join(', ')}]`, where)
              break
            }
          }
          if (!inY(b.lowerWhisker) || !inY(b.upperWhisker)) {
            say('marks', 'boxes: reaches outside the axes', where)
          }
          for (const o of b.outliers) {
            if (!inY(o)) say('marks', `boxes: outlier ${o} outside the axes`, where)
          }
          if (b.width <= 0) say('marks', 'boxes: width is zero or negative', where)
        }
        break
      }
      case 'violins': {
        drawn += m.violins.length
        for (const v of m.violins) {
          if (v.density.length === 0) say('marks', 'violins: empty density', where)
          v.density.forEach((d, i) => {
            if (!finite(d.value) || !finite(d.halfWidth)) {
              say('marks', 'violins: density sample is not finite', where)
              return
            }
            if (d.halfWidth < 0 || d.halfWidth > 1 + 1e-9) {
              say('marks', `violins: half-width ${d.halfWidth} outside zero to one`, where)
            }
            if (!inY(d.value)) say('marks', 'violins: density outside the axes', where)
            const prev = v.density[i - 1]
            if (prev !== undefined && d.value < prev.value) {
              say('marks', 'violins: density not sampled in order', where)
            }
          })
          if (!(v.q1 <= v.median && v.median <= v.q3)) {
            say('marks', 'violins: quartiles out of order', where)
          }
        }
        break
      }
      case 'wedges': {
        drawn += m.wedges.length
        const first = m.wedges[0]
        const last = m.wedges[m.wedges.length - 1]
        if (first !== undefined && last !== undefined) {
          if (Math.abs(first.start) > 1e-9) say('marks', 'wedges: pie starts off zero', where)
          if (Math.abs(last.end - 1) > 1e-9) say('marks', 'wedges: pie does not close', where)
        }
        for (const w of m.wedges) {
          if (w.value < 0) say('marks', 'wedges: negative slice', where)
          if (w.end < w.start) say('marks', 'wedges: slice runs backwards', where)
        }
        if (m.holeRadius < 0 || m.holeRadius >= 1) {
          say('marks', 'wedges: hole radius out of range', where)
        }
        break
      }
      case 'heatmap': {
        drawn += m.cells.length
        if (m.rowLabels.length !== m.rows) say('marks', 'heatmap: row labels mismatch', where)
        if (m.columnLabels.length !== m.columns) {
          say('marks', 'heatmap: column labels mismatch', where)
        }
        for (const c of m.cells) {
          if (c.row < 0 || c.row >= m.rows || c.column < 0 || c.column >= m.columns) {
            say('marks', `heatmap: cell (${c.row}, ${c.column}) outside the grid`, where)
          }
          if (c.value !== undefined && !finite(c.value)) {
            say('marks', 'heatmap: cell is not finite', where)
          }
        }
        break
      }
      case 'dendrogram': {
        drawn += m.links.length
        for (const l of m.links) {
          if (![l.x1, l.x2, l.height, l.childHeight1, l.childHeight2].every(finite)) {
            say('marks', 'dendrogram: link is not finite', where)
          } else if (l.height < l.childHeight1 - 1e-9 || l.height < l.childHeight2 - 1e-9) {
            say('marks', 'dendrogram: join sits below its own children', where)
          }
        }
        break
      }
      case 'ellipse': {
        drawn++
        if (![m.cx, m.cy, m.rx, m.ry, m.rotation].every(finite)) {
          say('marks', 'ellipse: geometry is not finite', where)
        } else if (m.rx < 0 || m.ry < 0) say('marks', 'ellipse: negative radius', where)
        break
      }
    }
  }

  // Colour is chosen by this index, so a mark past the end of the list is drawn
  // in a colour the key does not explain.
  if (maxSeries >= spec.series.length) {
    say('legend', `mark uses series ${maxSeries} of ${spec.series.length} entries`, where)
  }
  if (spec.kind !== 'empty' && drawn === 0) say('marks', 'nothing drawn', where)
}

/**
 * Every point the document actually puts on the page.
 *
 * The path walker handles the commands the renderer emits, and only those. It
 * matters that arcs are walked rather than scanned for numbers: an elliptical
 * arc carries seven, `a rx,ry rotation large,sweep dx,dy`, and reading those as
 * coordinate pairs invents points nobody drew. Doing it the lazy way reported
 * every pie chart in the corpus as running off the page.
 */
function coordsOf(node: El, out: { x: number[]; y: number[] } = { x: [], y: [] }) {
  // A clipped subtree cannot draw outside its clip rectangle, and the
  // rectangle is the plot area. Its marks' own coordinates may sit well
  // outside the page - that is the point of clipping - so counting them here
  // would report as invisible exactly what was hidden on purpose.
  if (node.attrs['clip-path'] !== undefined) return out
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'd') {
      let cx = 0
      let cy = 0
      for (const m of String(v).matchAll(/([MLAmla])\s*((?:-?[\d.]+(?:e-?\d+)?[ ,]*)+)/g)) {
        const op = m[1] as string
        const n = (m[2] ?? '').trim().split(/[ ,]+/).map(Number).filter(Number.isFinite)
        const relative = op === op.toLowerCase()
        const stride = op.toUpperCase() === 'A' ? 7 : 2
        for (let i = 0; i + stride <= n.length; i += stride) {
          const dx = n[i + stride - 2] as number
          const dy = n[i + stride - 1] as number
          cx = relative ? cx + dx : dx
          cy = relative ? cy + dy : dy
          out.x.push(cx)
          out.y.push(cy)
        }
      }
      continue
    }
    const n = Number(v)
    if (!Number.isFinite(n)) continue
    if (/^(x|x1|x2|cx)$/.test(k)) out.x.push(n)
    if (/^(y|y1|y2|cy)$/.test(k)) out.y.push(n)
  }
  for (const c of node.children) if (typeof c !== 'string') coordsOf(c, out)
  return out
}

function checkRender(spec: ChartSpec, where: string) {
  let root: El
  try {
    root = renderChart(spec, { width: W, height: H })
  } catch (e) {
    say('render', `renderChart threw: ${(e as Error).message}`, where)
    return
  }
  let svg: string
  try {
    svg = toSvg(root)
  } catch (e) {
    say('render', `toSvg threw: ${(e as Error).message}`, where)
    return
  }
  for (const bad of ['NaN', 'Infinity', 'undefined', 'null']) {
    if (svg.includes(bad)) say('render', `the document contains ${bad}`, where)
  }

  // Two pixels of slack for a stroke sitting on the edge. Anything further out
  // cannot be seen and cannot be scrolled to.
  const { x, y } = coordsOf(root)
  const outX = x.filter((v) => v < -2 || v > W + 2)
  const outY = y.filter((v) => v < -2 || v > H + 2)
  if (outX.length > 0) say('page', `${outX.length} coordinates off the page in x`, where)
  if (outY.length > 0) say('page', `${outY.length} coordinates off the page in y`, where)
}

function sweep() {
  let charts = 0
  for (const f of files) {
    const { value } = readProject(f.bytes, f.name)
    if (value === undefined) continue

    for (const sheet of value.sheets) {
      if (sheet.kind !== 'data') continue
      for (const kind of new Set(allowedKinds(sheet.table))) {
        const where = `${f.name}::${sheet.title} [${kind}]`
        let spec: ChartSpec
        try {
          spec = planChart(sheet.table, sheet.title, { ...provenanceOf(sheet), kind })
        } catch (e) {
          say('plan', `planChart threw: ${(e as Error).message}`, where)
          continue
        }
        charts++
        checkSpec(spec, where)
        checkRender(spec, where)
      }
    }

    const ctx = mvContext(value)
    for (const sheet of value.sheets) {
      if (sheet.kind !== 'graph') continue
      const spec = planMvGraph(sheet, ctx)
      if (spec === undefined) continue
      charts++
      const where = `${f.name}::${sheet.title} [mv]`
      checkSpec(spec, where)
      checkRender(spec, where)
    }
  }
  return charts
}

const charts = files.length === 0 ? 0 : sweep()
const inGroup = (group: string) =>
  findings.filter((f) => f.group === group).map((f) => `${f.where}: ${f.what}`)

describe.skipIf(files.length === 0)(
  `every style of every chart, over ${files.length} documents`,
  () => {
    it('plans a chart for every style offered, without throwing', () => {
      // The sweep is worth nothing if it silently covered ten charts.
      expect(charts).toBeGreaterThan(500)
      expect(inGroup('plan')).toEqual([])
    })

    it('keeps every axis finite and the right way round', () => {
      expect(inGroup('axes')).toEqual([])
    })

    it('keeps every mark inside the axes it is drawn against', () => {
      expect(inGroup('marks')).toEqual([])
    })

    it('gives every colour a legend entry that explains it', () => {
      expect(inGroup('legend')).toEqual([])
    })

    it('renders every one to a document with no missing numbers in it', () => {
      expect(inGroup('render')).toEqual([])
    })

    it('draws nothing outside the page', () => {
      expect(inGroup('page')).toEqual([])
    })
  },
)
