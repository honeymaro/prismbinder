import type { ColumnView, TableView } from '@prismbinder/model'
import { describe, expect, it } from 'vitest'
import { planChart } from './plan.js'
import { renderChart } from './render.js'
import { niceDomain, scaleFor, slotWidth } from './scales.js'
import { render, toSvg } from './svg.js'
import { type El, el } from './types.js'

function column(title: string, subcolumns: string[][], role: 'x' | 'y' = 'y'): ColumnView {
  return {
    id: title,
    title,
    role,
    subcolumns,
    marks: subcolumns.map(() => ({ excluded: new Set<number>(), censored: new Set<number>() })),
    generated: false,
  }
}

function table(over: Partial<TableView>): TableView {
  return {
    rowCount: 1,
    rowTitles: [],
    columns: [],
    tableFormat: 'xy',
    dataFormat: 'y_single',
    storage: 'direct',
    ...over,
  }
}

function walk(node: El | string, fn: (e: El) => void): void {
  if (typeof node === 'string') return
  fn(node)
  for (const c of node.children) walk(c, fn)
}

function collect(node: El, tag: string): El[] {
  const out: El[] = []
  walk(node, (e) => {
    if (e.tag === tag) out.push(e)
  })
  return out
}

const W = 680
const H = 340

describe('scales', () => {
  it('opens out a flat domain instead of collapsing it', () => {
    expect(niceDomain(5, 5)).toEqual([0, 10])
    expect(niceDomain(0, 0)).toEqual([-1, 1])
  })

  it('refuses to place a non-positive value on a log axis', () => {
    // Clamping a zero onto the axis minimum would draw a point where there is
    // no measurement.
    const s = scaleFor(
      {
        kind: 'log',
        title: '',
        min: 1,
        max: 1000,
        categories: [],
        tickInterval: undefined,
        reversed: false,
      },
      [0, 100],
    )
    expect(Number.isNaN(s.map(0))).toBe(true)
    expect(Number.isNaN(s.map(-5))).toBe(true)
    expect(s.map(1)).toBeCloseTo(0, 6)
    expect(s.map(1000)).toBeCloseTo(100, 6)
    expect(s.map(10)).toBeLessThan(s.map(100))
  })

  it('gives a category axis one slot per category, ticked in the middle', () => {
    const s = scaleFor(
      {
        kind: 'category',
        title: '',
        min: 0,
        max: 2,
        categories: ['a', 'b'],
        tickInterval: undefined,
        reversed: false,
      },
      [0, 100],
    )
    expect(slotWidth(s)).toBe(50)
    expect(s.ticks().map((t) => t.value)).toEqual([0.5, 1.5])
    expect(s.map(0.5)).toBe(25)
  })
})

describe('rendered geometry', () => {
  const spec = planChart(
    table({
      rowCount: 3,
      columns: [column('Dose', [['1', '2', '3']], 'x'), column('A', [['4', '5', '6']])],
    }),
    'T',
  )

  it('keeps every mark inside the frame', () => {
    const svg = renderChart(spec, { width: W, height: H })
    for (const c of collect(svg, 'circle')) {
      expect(Number(c.attrs.cx)).toBeGreaterThanOrEqual(0)
      expect(Number(c.attrs.cx)).toBeLessThanOrEqual(W)
      expect(Number(c.attrs.cy)).toBeGreaterThanOrEqual(0)
      expect(Number(c.attrs.cy)).toBeLessThanOrEqual(H)
    }
  })

  it('states in its label that the chart is a reconstruction', () => {
    const svg = renderChart(spec)
    expect(String(svg.attrs['aria-label'])).toMatch(/^Reconstructed chart/)
  })

  it('draws a bar rectangle per value, none of them inverted', () => {
    const bars = planChart(
      table({
        tableFormat: 'grouped',
        rowCount: 2,
        rowTitles: ['Men', 'Women'],
        columns: [column('Control', [['10', '20']]), column('Treated', [['30', '40']])],
      }),
      'T',
      { kind: 'bar' },
    )
    const rects = collect(renderChart(bars), 'rect').filter((r) => r.attrs.class === 'pbchart-bar')
    expect(rects).toHaveLength(4)
    for (const r of rects) {
      expect(Number(r.attrs.width)).toBeGreaterThan(0)
      expect(Number(r.attrs.height)).toBeGreaterThan(0)
    }
  })

  it('draws a step line for a survival curve, not a sloped one', () => {
    const survival = planChart(
      table({
        tableFormat: 'survival',
        rowCount: 3,
        columns: [column('Time', [['1', '2', '3']], 'x'), column('A', [['1', '1', '1']])],
      }),
      'T',
    )
    const paths = collect(renderChart(survival), 'path').filter(
      (p) => p.attrs.class === 'pbchart-line',
    )
    expect(paths).toHaveLength(1)
    // Each step is a horizontal move then a vertical one, so segments outnumber
    // the points a sloped line would have used.
    const d = String(paths[0]?.attrs.d)
    expect((d.match(/L/g) ?? []).length).toBeGreaterThan(3)
  })

  it('closes a lone pie slice as a circle rather than a degenerate arc', () => {
    // An arc of exactly one turn has the same start and end point and draws
    // nothing at all.
    const pie = planChart(
      table({
        tableFormat: 'partsofwhole',
        rowCount: 1,
        rowTitles: ['All'],
        columns: [column('X', [['42']])],
      }),
      'T',
      { kind: 'pie' },
    )
    const wedges = collect(renderChart(pie), 'path').filter(
      (p) => p.attrs.class === 'pbchart-wedge',
    )
    expect(wedges).toHaveLength(1)
    expect(String(wedges[0]?.attrs.d)).toMatch(/a[\d.]+,[\d.]+ 0 1,0/)
  })

  it('angles category labels rather than letting them overlap', () => {
    // A results table is the normal case here, not an awkward one: twenty rows
    // called things like "95% CI (profile likelihood)" and "# Y values
    // analyzed". Drawn flat and centred they overlap into a smear.
    const rowTitles = [
      'Best-fit values',
      'Top',
      'Bottom',
      'LogIC50',
      'HillSlope',
      'IC50',
      'Span',
      '95% CI (profile likelihood)',
      'Goodness of Fit',
      'Degrees of Freedom',
      'R squared',
      'Sum of Squares',
      'Sy.x',
      'Number of points',
      '# of X values',
      '# Y values analyzed',
    ]
    const spec = planChart(
      table({
        tableFormat: 'grouped',
        rowCount: rowTitles.length,
        rowTitles,
        columns: [column('A', [rowTitles.map((_, i) => String(i + 1))])],
      }),
      'Results',
      { kind: 'bar' },
    )

    const svg = renderChart(spec, { width: W, height: H })
    const labels = collect(svg, 'text').filter((t) => t.attrs.class === 'pbchart-tick')
    const angled = labels.filter((t) => String(t.attrs.transform ?? '').includes('rotate'))
    expect(angled.length, 'the row titles should be angled').toBeGreaterThan(0)

    // Angled at 45 degrees, one line of text needs about 18px along the axis.
    const xs = angled.map((t) => Number(t.attrs.x)).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) {
      expect((xs[i] as number) - (xs[i - 1] as number), 'labels must not collide').toBeGreaterThan(
        17,
      )
    }

    // And none of them may run off the bottom of the picture.
    for (const t of angled) expect(Number(t.attrs.y)).toBeLessThan(H)
    for (const t of labels) {
      const text = String(t.children[0] ?? '')
      expect(text.length, 'a label longer than its space should be cut').toBeLessThanOrEqual(26)
    }
  })

  it('puts the axis title below its tick labels, on a numeric axis too', () => {
    // The label layout is driven by how much room the categories need. A
    // numeric axis has none, and reporting zero wrote the title "Hours"
    // straight through the "40" beneath it.
    const numeric = planChart(
      table({
        rowCount: 3,
        columns: [column('Hours', [['0', '20', '40']], 'x'), column('A', [['1', '2', '3']])],
      }),
      'T',
    )
    const texts = collect(renderChart(numeric, { width: W, height: H }), 'text')
    const title = texts.find((t) => t.attrs.class === 'pbchart-axis-title')
    const tick = texts.find(
      (t) => t.attrs.class === 'pbchart-tick' && t.attrs['text-anchor'] === 'middle',
    )
    expect(title, 'the X axis should be titled').toBeDefined()
    expect(Number(title?.attrs.y)).toBeGreaterThan(Number(tick?.attrs.y))
  })

  it('leaves short labels flat, where they read best', () => {
    const spec = planChart(
      table({
        tableFormat: 'grouped',
        rowCount: 2,
        rowTitles: ['Men', 'Women'],
        columns: [column('A', [['1', '2']])],
      }),
      'T',
      { kind: 'bar' },
    )
    const labels = collect(renderChart(spec), 'text').filter(
      (t) => t.attrs.class === 'pbchart-tick',
    )
    expect(labels.some((t) => String(t.children[0] ?? '') === 'Women')).toBe(true)
    expect(labels.every((t) => t.attrs.transform === undefined)).toBe(true)
  })

  it('caps an error bar at both ends, as Prism draws it', () => {
    // A bare vertical stroke does not say where the interval ends, and on a
    // chart that also draws connecting lines it does not even read as an error
    // bar. Prism draws the crossbars; so does this.
    const spec = planChart(
      table({
        dataFormat: 'y_replicates',
        rowCount: 2,
        columns: [
          column('Hours', [['0', '6']], 'x'),
          column('A', [
            ['45', '56'],
            ['34', '61'],
          ]),
        ],
      }),
      'T',
    )
    const svg = renderChart(spec, { width: W, height: H })
    const bars = collect(svg, 'line').filter((l) => l.attrs.class === 'pbchart-error')
    const caps = collect(svg, 'line').filter((l) => l.attrs.class === 'pbchart-error-cap')
    expect(bars).toHaveLength(2)
    expect(caps, 'two caps per bar').toHaveLength(4)

    // Each cap is horizontal, centred on its bar, and crosses it.
    for (const cap of caps) {
      expect(Number(cap.attrs.y1)).toBe(Number(cap.attrs.y2))
      expect(Number(cap.attrs.x2) - Number(cap.attrs.x1)).toBeGreaterThan(0)
    }
    const bar = bars[0]
    if (bar === undefined) throw new Error('expected a bar')
    const mine = caps.filter((c) => Math.abs(Number(c.attrs.x1) - Number(bar.attrs.x1)) < 10)
    expect(mine).toHaveLength(2)
    const ends = [Number(bar.attrs.y1), Number(bar.attrs.y2)].sort((a, b) => a - b)
    const capYs = mine.map((c) => Number(c.attrs.y1)).sort((a, b) => a - b)
    expect(capYs[0]).toBeCloseTo(ends[0] as number, 6)
    expect(capYs[1]).toBeCloseTo(ends[1] as number, 6)
  })

  it('draws no cap where the bar has no length to cap', () => {
    // A one-sided bar, or a zero-length one, would otherwise get a crossbar
    // drawn straight through the symbol.
    const spec = planChart(
      table({
        dataFormat: 'y_replicates',
        rowCount: 1,
        columns: [column('X', [['0']], 'x'), column('A', [['5'], ['5'], ['5']])],
      }),
      'T',
    )
    const svg = renderChart(spec)
    expect(collect(svg, 'line').filter((l) => l.attrs.class === 'pbchart-error-cap')).toHaveLength(
      0,
    )
  })

  it('marks the axis at every labelled value', () => {
    const spec = planChart(
      table({
        rowCount: 3,
        columns: [column('Hours', [['0', '20', '40']], 'x'), column('A', [['1', '2', '3']])],
      }),
      'T',
    )
    const svg = renderChart(spec, { width: W, height: H })
    const marks = collect(svg, 'line').filter((l) => l.attrs.class === 'pbchart-tickmark')
    const labels = collect(svg, 'text').filter((t) => t.attrs.class === 'pbchart-tick')
    expect(marks.length, 'one tick mark per label').toBe(labels.length)
    // They point away from the plot rather than into it.
    for (const m of marks) {
      const horizontal = Number(m.attrs.y1) === Number(m.attrs.y2)
      if (horizontal) expect(Number(m.attrs.x2)).toBeLessThanOrEqual(62)
      else expect(Number(m.attrs.y2)).toBeGreaterThan(Number(m.attrs.y1))
    }
  })

  it('renders an empty table without throwing', () => {
    const empty = planChart(table({ rowCount: 0, columns: [] }), 'T')
    const svg = renderChart(empty)
    expect(collect(svg, 'circle')).toHaveLength(0)
    expect(svg.tag).toBe('svg')
  })
})

describe('serialisation', () => {
  it('writes a standalone document', () => {
    const spec = planChart(table({ rowCount: 2, columns: [column('A', [['1', '2']])] }), 'Demo', {
      kind: 'scatter',
    })
    const out = toSvg(renderChart(spec))
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out).toContain('<style>')
    expect(out.trimEnd().endsWith('</svg>')).toBe(true)
  })

  it('escapes a title that would otherwise close the tag', () => {
    // Sheet titles come from the file and can hold anything.
    const spec = planChart(
      table({ rowCount: 1, columns: [column('A', [['1']])] }),
      '</svg><script>alert(1)</script> & "quoted"',
      { kind: 'scatter' },
    )
    const out = toSvg(renderChart(spec))
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;/svg&gt;')
    expect(out).toContain('&quot;quoted&quot;')
  })

  it('collapses an empty shape to a self-closing tag', () => {
    expect(render(el('line', { x1: 0 }))).toBe('<line x1="0"/>')
    expect(render(el('text', {}, ['hi']))).toBe('<text>hi</text>')
  })
})
