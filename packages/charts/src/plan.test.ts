import type { ColumnView, TableView } from '@prismbinder/model'
import { describe, expect, it } from 'vitest'
import { allowedKinds, defaultKind, planChart } from './plan.js'
import type { ChartKind, Mark } from './types.js'

/**
 * Which chart each table gets, and what its marks claim.
 *
 * Assertions are about data coordinates, never pixels: a bar reaching the
 * column total is a fact about the file, while a bar reaching y=214 is a fact
 * about the frame size.
 */

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

const marksOf = <K extends Mark['kind']>(spec: { marks: readonly Mark[] }, kind: K) =>
  spec.marks.filter((m): m is Extract<Mark, { kind: K }> => m.kind === kind)

describe('choosing a chart', () => {
  it('gives each table kind something Prism would recognise for that data', () => {
    const cases: [string, ChartKind][] = [
      ['xy', 'xy'],
      ['column', 'scatter'],
      ['grouped', 'bar'],
      ['contingency', 'bar'],
      ['partsofwhole', 'pie'],
      ['survival', 'survival'],
      ['nested', 'scatter'],
      ['multivariable', 'scatter'],
    ]
    for (const [format, kind] of cases) {
      expect(defaultKind(table({ tableFormat: format })), format).toBe(kind)
    }
  })

  it('never offers a style the data cannot support', () => {
    const of = (tableFormat: string) =>
      allowedKinds(
        table({ tableFormat, rowCount: 4, columns: [column('A', [['1', '2', '3', '4']])] }),
      )
    // A pie of a contingency table is a category error, not a preference.
    expect(of('contingency')).not.toContain('pie')
    expect(of('partsofwhole')).toContain('donut')
    // Boxes need a stack of values, which a single-subcolumn XY table has not.
    expect(of('xy')).not.toContain('box')
  })

  it('offers nothing at all for a table holding no numbers', () => {
    // The layout rules only ask what the shape permits. A hierarchical
    // clustering row table is a column of city names, and left to the shape
    // rules it was offered six styles, every one of which drew a blank picture.
    expect(allowedKinds(table({ tableFormat: 'partsofwhole' }))).toEqual([])
    expect(
      allowedKinds(
        table({
          tableFormat: 'multivariable',
          rowCount: 2,
          columns: [column('City', [['Mecca, Saudi Arabia', 'Beirut, Lebanon']])],
        }),
      ),
    ).toEqual([])
  })

  it('marks every chart as reconstructed', () => {
    // Prism's own figure is a binary we do not decode. Nothing here is it.
    const spec = planChart(table({ rowCount: 2, columns: [column('A', [['1', '2']])] }), 'T')
    expect(spec.fidelity).toBe('reconstructed')
  })
})

describe('lines', () => {
  it('joins points when the X axis is ordered', () => {
    const spec = planChart(
      table({
        rowCount: 3,
        columns: [column('Dose', [['1', '2', '3']], 'x'), column('A', [['4', '5', '6']])],
      }),
      'T',
    )
    expect(marksOf(spec, 'line')).toHaveLength(1)
  })

  it('summarises replicate data by default, the way Prism does', () => {
    // Three dots scattered around every point bury the curve the experiment was
    // run to see. The repeats stay one choice away.
    const replicates = table({
      dataFormat: 'y_replicates',
      rowCount: 2,
      columns: [
        column('Hours', [['0', '6']], 'x'),
        column('Control', [
          ['45', '56'],
          ['34', '61'],
          ['', '60'],
        ]),
      ],
    })
    expect(defaultKind(replicates)).toBe('meanError')
    expect(allowedKinds(replicates)).toContain('xy')

    const spec = planChart(replicates, 'T')
    // One symbol per X at the mean, not one per repeat.
    const points = marksOf(spec, 'points')[0]?.points ?? []
    expect(points.map((p) => p.x)).toEqual([0, 6])
    expect(points[0]?.y).toBeCloseTo(39.5, 10)
    expect(points[1]?.y).toBeCloseTo(59, 10)

    const bars = marksOf(spec, 'errorBars')[0]?.bars ?? []
    expect(bars).toHaveLength(2)
    // Symmetric, and a standard deviation rather than a range.
    expect(bars[0]?.up).toBeCloseTo(bars[0]?.down ?? 0, 12)
    expect(bars[0]?.up).toBeCloseTo(7.7781745930520225, 8)
    expect(spec.notes.join(' ')).toMatch(/one standard deviation/)
    // And it must not also claim every replicate is on the page.
    expect(spec.notes.join(' ')).not.toMatch(/Every replicate is drawn/)
  })

  it('can show the error bars as SEM or as the range instead', () => {
    const t = table({
      dataFormat: 'y_replicates',
      rowCount: 1,
      columns: [column('X', [['0']], 'x'), column('A', [['10'], ['20'], ['30']])],
    })
    const range = marksOf(planChart(t, 'T', { errorBars: 'range' }), 'errorBars')[0]?.bars[0]
    expect(range?.up).toBeCloseTo(10, 10)
    expect(range?.down).toBeCloseTo(10, 10)

    const sd = marksOf(planChart(t, 'T', { errorBars: 'sd' }), 'errorBars')[0]?.bars[0]
    const sem = marksOf(planChart(t, 'T', { errorBars: 'sem' }), 'errorBars')[0]?.bars[0]
    // SEM is the SD over the square root of n, so it is always the shorter bar.
    expect(sem?.up).toBeLessThan(sd?.up ?? 0)
    expect(sem?.up).toBeCloseTo((sd?.up ?? 0) / Math.sqrt(3), 10)
  })

  it('follows the mean when a row holds replicates, not the replicates', () => {
    // A polyline over tied points doubles back vertically at every X. It looks
    // like an error bar, is not one, and ends on whichever replicate the sort
    // happened to leave last. Prism connects the means, and so does this.
    const spec = planChart(
      table({
        dataFormat: 'y_replicates',
        rowCount: 2,
        columns: [
          column('Hours', [['0', '6']], 'x'),
          column('Control', [
            ['45', '56'],
            ['34', '61'],
          ]),
        ],
      }),
      'T',
      { kind: 'xy' },
    )
    const line = marksOf(spec, 'line')[0]
    expect(line?.points).toEqual([
      { x: 0, y: 39.5 },
      { x: 6, y: 58.5 },
    ])
    // The replicates themselves are still every point on the chart.
    expect(marksOf(spec, 'points')[0]?.points).toHaveLength(4)
    expect(spec.notes.join(' ')).toMatch(/follows the mean/)
  })

  it('refuses to join rows that are not a sequence', () => {
    // A column table's rows are separate observations, so a line through them
    // draws a trend that does not exist.
    const spec = planChart(
      table({ tableFormat: 'column', rowCount: 3, columns: [column('A', [['4', '5', '6']])] }),
      'T',
      { kind: 'scatter' },
    )
    expect(marksOf(spec, 'line')).toHaveLength(0)
    expect(marksOf(spec, 'points')).toHaveLength(1)
    // And the values go in their column's slot, not along a row axis that does
    // not exist: all three land at the same x.
    expect(new Set(marksOf(spec, 'points')[0]?.points.map((p) => p.x))).toEqual(new Set([0.5]))
    expect(spec.axisX.kind).toBe('category')
    expect(spec.notes.join(' ')).toMatch(/no order to place them along/)
  })
})

describe('bars', () => {
  const grouped = table({
    tableFormat: 'grouped',
    rowCount: 2,
    rowTitles: ['Men', 'Women'],
    columns: [column('Control', [['10', '20']]), column('Treated', [['30', '40']])],
  })

  it('puts one slot per row and interleaves the series inside it', () => {
    const spec = planChart(grouped, 'T', { kind: 'bar' })
    expect(spec.axisX.kind).toBe('category')
    expect(spec.axisX.categories).toEqual(['Men', 'Women'])
    const bars = marksOf(spec, 'bars')
    expect(bars).toHaveLength(2)
    // Two series share the row's slot, so neither sits on the tick itself.
    const [a, b] = bars
    expect(a?.bars[0]?.x).toBeLessThan(0.5)
    expect(b?.bars[0]?.x).toBeGreaterThan(0.5)
    // Both stay inside the slot they belong to.
    for (const m of bars) {
      for (const bar of m.bars) {
        expect(bar.x - bar.width / 2).toBeGreaterThanOrEqual(0)
        expect(bar.x + bar.width / 2).toBeLessThanOrEqual(2)
      }
    }
  })

  it('grows every bar from zero', () => {
    const spec = planChart(grouped, 'T', { kind: 'bar' })
    for (const m of marksOf(spec, 'bars')) for (const bar of m.bars) expect(bar.base).toBe(0)
  })

  it('stacks to the row total, exactly', () => {
    const spec = planChart(grouped, 'T', { kind: 'stackedBar' })
    const bars = marksOf(spec, 'bars')
    // Row 0 holds 10 and 30; the top of the last segment is the total.
    const tops = bars.map((m) => m.bars.find((b) => b.x === 0.5))
    expect(tops[0]?.base).toBe(0)
    expect(tops[0]?.y).toBe(10)
    expect(tops[1]?.base).toBe(10)
    expect(tops[1]?.y).toBe(40)
  })

  it('summarises a row of replicates by its mean', () => {
    const spec = planChart(
      table({
        tableFormat: 'grouped',
        dataFormat: 'y_replicates',
        rowCount: 1,
        columns: [column('A', [['10'], ['20'], ['30']])],
      }),
      'T',
      { kind: 'bar' },
    )
    expect(marksOf(spec, 'bars')[0]?.bars[0]?.y).toBe(20)
  })
})

describe('boxes', () => {
  const values = [
    '1',
    '2',
    '4',
    '9',
    '24',
    '35',
    '45',
    '56',
    '67',
    '89',
    '111',
    '222',
    '345',
    '666',
  ]
  const columnTable = table({
    tableFormat: 'column',
    rowCount: values.length,
    columns: [column('Control', [values])],
  })

  it('reports the five numbers, and the whisker rule it used', () => {
    const spec = planChart(columnTable, 'T', { kind: 'box', whiskers: 'minMax' })
    const box = marksOf(spec, 'boxes')[0]?.boxes[0]
    expect(box?.q1).toBeCloseTo(7.75, 10)
    expect(box?.median).toBeCloseTo(50.5, 10)
    expect(box?.q3).toBeCloseTo(138.75, 10)
    expect(box?.lowerWhisker).toBe(1)
    expect(box?.upperWhisker).toBe(666)
    expect(spec.notes.join(' ')).toMatch(/minimum to maximum/)
  })

  it('never lets a whisker cross its own hinge', () => {
    for (const rule of ['minMax', 'tukey', 'p10_90', 'p5_95', 'p1_99'] as const) {
      const spec = planChart(columnTable, 'T', { kind: 'box', whiskers: rule })
      const box = marksOf(spec, 'boxes')[0]?.boxes[0]
      if (box === undefined) throw new Error('expected a box')
      expect(box.lowerWhisker, rule).toBeLessThanOrEqual(box.q1)
      expect(box.q1, rule).toBeLessThanOrEqual(box.median)
      expect(box.median, rule).toBeLessThanOrEqual(box.q3)
      expect(box.q3, rule).toBeLessThanOrEqual(box.upperWhisker)
    }
  })

  it('says so rather than drawing a box from three values', () => {
    // Prism needs four, and below that the quartiles describe the rule more
    // than the data.
    const spec = planChart(
      table({ tableFormat: 'column', rowCount: 3, columns: [column('A', [['1', '2', '3']])] }),
      'T',
      { kind: 'box' },
    )
    expect(marksOf(spec, 'boxes')).toHaveLength(0)
    expect(spec.notes.join(' ')).toMatch(/Too few values/)
  })

  it('draws every point when the rule asks for it', () => {
    const spec = planChart(columnTable, 'T', { kind: 'box', whiskers: 'minMaxAllPoints' })
    expect(marksOf(spec, 'points')[0]?.points).toHaveLength(values.length)
  })
})

describe('parts of whole', () => {
  const pie = table({
    tableFormat: 'partsofwhole',
    rowCount: 4,
    rowTitles: ['A', 'B', 'C', 'D'],
    columns: [column('Grades', [['10', '20', '30', '40']])],
  })

  it('turns the column into shares of its own total', () => {
    const spec = planChart(pie, 'T', { kind: 'pie' })
    const wedges = marksOf(spec, 'wedges')[0]?.wedges ?? []
    expect(wedges).toHaveLength(4)
    expect(wedges[0]?.end).toBeCloseTo(0.1, 12)
    // The wedges tile the circle exactly once: no gap, no overlap.
    expect(wedges[wedges.length - 1]?.end).toBeCloseTo(1, 12)
    for (let i = 1; i < wedges.length; i++) {
      expect((wedges[i] as { start: number }).start).toBeCloseTo(
        (wedges[i - 1] as { end: number }).end,
        12,
      )
    }
    expect(spec.notes.join(' ')).toMatch(/sum of the column/)
  })

  it('gives a donut a hole and a pie none', () => {
    expect(marksOf(planChart(pie, 'T', { kind: 'pie' }), 'wedges')[0]?.holeRadius).toBe(0)
    expect(
      marksOf(planChart(pie, 'T', { kind: 'donut' }), 'wedges')[0]?.holeRadius,
    ).toBeGreaterThan(0)
  })

  it('drops values that cannot be a share, and says how many', () => {
    const spec = planChart(
      table({
        tableFormat: 'partsofwhole',
        rowCount: 3,
        rowTitles: ['A', 'B', 'C'],
        columns: [column('X', [['10', '-5', '30']])],
      }),
      'T',
      { kind: 'pie' },
    )
    expect(marksOf(spec, 'wedges')[0]?.wedges).toHaveLength(2)
    expect(spec.notes.join(' ')).toMatch(/zero or negative/)
  })
})

describe('survival', () => {
  it('steps down at events and ticks at censored observations', () => {
    const spec = planChart(
      table({
        tableFormat: 'survival',
        rowCount: 4,
        columns: [
          column('Time', [['1', '2', '3', '4']], 'x'),
          column('Treated', [['0', '1', '1', '1']]),
        ],
      }),
      'T',
    )
    const line = marksOf(spec, 'line')[0]
    expect(line?.step).toBe(true)
    // Starts at one, and the censored subject at t=1 does not move it.
    expect(line?.points[0]).toEqual({ x: 0, y: 1 })
    expect(line?.points[1]?.y).toBe(1)
    expect(line?.points[2]?.y).toBeCloseTo(2 / 3, 12)
    expect(marksOf(spec, 'ticks')[0]?.points).toHaveLength(1)
    expect(spec.axisY.min).toBe(0)
    expect(spec.axisY.max).toBe(1)
  })

  /**
   * The results view a SURVIVAL analysis writes.
   *
   * Its table kind is `view`, which says nothing about what the numbers are,
   * and the Y values are proportions rather than event codes. Everything below
   * turns on telling those two tables apart by what produced them.
   */
  const proportions = () =>
    table({
      tableFormat: 'view',
      dataFormat: 'y_plus_minus',
      storage: 'offsets',
      rowCount: 3,
      columns: [
        column('Days', [['0', '5', '10']], 'x'),
        column('Treated', [
          ['1', '0.8', '0.5'],
          ['0', '0.1', '0.15'],
          ['0', '0.1', '0.2'],
        ]),
      ],
    })
  const wroteIt = {
    producedBy: { analysisClass: 'SURVIVAL', sheetTitle: 'Survival proportions' },
  }

  /** The same view, in the shape where it carries no time column of its own. */
  const proportionsNoX = () =>
    table({
      tableFormat: 'view',
      rowCount: 3,
      columns: [column('Treated', [['1', '0.8', '0.5']])],
    })

  it('recognises a stored survival curve as one, whatever its layout says', () => {
    // The layout cannot say this: a results view is `view` whatever it holds,
    // so the shape rules answered from the presence of an X column alone - a
    // line for the view that has one, and for the view that does not, a scatter
    // plot, which draws a curve as loose dots with no line through them. The
    // staircase was not offered for either.
    expect(defaultKind(proportions())).toBe('xy')
    expect(defaultKind(proportionsNoX())).toBe('scatter')
    for (const t of [proportions(), proportionsNoX()]) {
      expect(defaultKind(t, wroteIt.producedBy)).toBe('survival')
      expect(allowedKinds(t, wroteIt.producedBy)).toContain('survival')
    }
  })

  it('still steps when the results view carries no time column, and says so', () => {
    // Refusing outright would be worse than the scatter it replaced: the order
    // of the steps is real even when their spacing is not.
    const spec = planChart(proportionsNoX(), 'T', wroteIt)
    const line = marksOf(spec, 'line')[0]
    expect(line?.step).toBe(true)
    expect(line?.points.map((p) => p.y)).toEqual([1, 0.8, 0.5])
    expect(spec.notes.join(' ')).toMatch(/no time column/)
  })

  it('draws the proportions the analysis stored, without recomputing them', () => {
    const spec = planChart(proportions(), 'T', wroteIt)
    const line = marksOf(spec, 'line')[0]
    expect(line?.step).toBe(true)
    // Decisive. Run the estimator over these and a proportion of 1.0 reads as
    // an event and 0.8 and 0.5 as censored observations, which gives 2/3 at the
    // first time and a flat line after it. The stored numbers are these.
    expect(line?.points.map((p) => p.y)).toEqual([1, 0.8, 0.5])
    expect(line?.points.map((p) => p.x)).toEqual([0, 5, 10])
  })

  it('keeps the confidence interval stored beside each proportion', () => {
    const bars = marksOf(planChart(proportions(), 'T', wroteIt), 'errorBars')[0]?.bars
    expect(bars?.map((b) => [b.up, b.down])).toEqual([
      [0, 0],
      [0.1, 0.1],
      [0.15, 0.2],
    ])
  })

  it('refuses without a time column instead of inventing one', () => {
    const spec = planChart(
      table({ tableFormat: 'survival', rowCount: 2, columns: [column('A', [['1', '0']])] }),
      'T',
    )
    expect(spec.marks).toHaveLength(0)
    expect(spec.notes.join(' ')).toMatch(/needs a time column/)
  })
})

describe('cells Prism excludes', () => {
  it('are left out of every chart, as they are out of every Prism analysis', () => {
    const col = column('A', [['10', '999', '12']])
    const withExclusion: ColumnView = {
      ...col,
      marks: [{ excluded: new Set([1]), censored: new Set<number>() }],
    }
    const spec = planChart(
      table({ tableFormat: 'column', rowCount: 3, columns: [withExclusion] }),
      'T',
      { kind: 'alignedDot' },
    )
    const ys = marksOf(spec, 'points')[0]?.points.map((p) => p.y)
    expect(ys).toEqual([10, 12])
  })
})
