import { expect, it, describe as suite } from 'vitest'
import { density, describe, kaplanMeier, medianSurvival, percentile, whiskers } from './summary.js'

/**
 * The numbers a box plot and an error bar are made of.
 *
 * The percentile cases are not invented. They are two columns Prism itself ran
 * Column Statistics over, with the quartiles it computed, which makes this the
 * one check here that is not circular: Prism produced the expected values and
 * we did not.
 */

/** `Geometric mean.pzt`, column Control, with Prism's stored statistics. */
const CONTROL = [1, 2, 4, 9, 24, 35, 45, 56, 67, 89, 111, 222, 345, 666]
const CONTROL_STATS = {
  n: 14,
  minimum: 1,
  firstQuartile: 7.75,
  median: 50.5,
  thirdQuartile: 138.75,
  maximum: 666,
  mean: 119.71428571428571,
  sd: 184.60328714942654,
  meanSE: 49.33730378467163,
}

/** The same file, column Treated. */
const TREATED = [3, 4, 7, 14, 21, 34, 45, 56, 78, 99, 234, 543, 567, 897]
const TREATED_STATS = {
  firstQuartile: 12.25,
  median: 50.5,
  thirdQuartile: 311.25,
  mean: 185.85714285714286,
  sd: 279.42464434643534,
  meanSE: 74.67937746896581,
}

suite('descriptives, against numbers Prism computed', () => {
  it('reproduces the quartiles Prism stored', () => {
    // The rule is `(n+1)p`. Excel's default, `(n-1)p`, gives 12.75 and 105.5
    // here - which is exactly the difference the user guide warns about
    // without naming.
    const a = describe(CONTROL)
    expect(a?.q1).toBeCloseTo(CONTROL_STATS.firstQuartile, 12)
    expect(a?.median).toBeCloseTo(CONTROL_STATS.median, 12)
    expect(a?.q3).toBeCloseTo(CONTROL_STATS.thirdQuartile, 12)

    const b = describe(TREATED)
    expect(b?.q1).toBeCloseTo(TREATED_STATS.firstQuartile, 12)
    expect(b?.median).toBeCloseTo(TREATED_STATS.median, 12)
    expect(b?.q3).toBeCloseTo(TREATED_STATS.thirdQuartile, 12)
  })

  it('reproduces the mean, SD and SEM Prism stored', () => {
    const a = describe(CONTROL)
    expect(a?.n).toBe(CONTROL_STATS.n)
    expect(a?.min).toBe(CONTROL_STATS.minimum)
    expect(a?.max).toBe(CONTROL_STATS.maximum)
    expect(a?.mean).toBeCloseTo(CONTROL_STATS.mean, 12)
    // n-1, which is what makes sd / sqrt(n) come out as Prism's meanSE.
    expect(a?.sd).toBeCloseTo(CONTROL_STATS.sd, 10)
    expect(a?.sem).toBeCloseTo(CONTROL_STATS.meanSE, 10)

    const b = describe(TREATED)
    expect(b?.mean).toBeCloseTo(TREATED_STATS.mean, 12)
    expect(b?.sd).toBeCloseTo(TREATED_STATS.sd, 10)
    expect(b?.sem).toBeCloseTo(TREATED_STATS.meanSE, 10)
  })

  it('survives samples too small to have quartiles', () => {
    expect(describe([])).toBeUndefined()
    const one = describe([5])
    expect(one?.q1).toBe(5)
    expect(one?.median).toBe(5)
    expect(one?.sd).toBe(0)
    expect(one?.sem).toBe(0)
  })

  it('clamps a percentile a sample cannot reach', () => {
    // With three values the 1st percentile lies below the first position, and
    // the honest answer is the smallest value rather than an extrapolation.
    expect(percentile([10, 20, 30], 0.01)).toBe(10)
    expect(percentile([10, 20, 30], 0.99)).toBe(30)
  })

  it('ignores values that are not numbers', () => {
    expect(describe([1, Number.NaN, 3, Number.POSITIVE_INFINITY])?.n).toBe(2)
  })
})

suite('whiskers', () => {
  it('min to max reaches the extremes and leaves no outliers', () => {
    const w = whiskers(CONTROL, 'minMax')
    expect(w.lower).toBe(1)
    expect(w.upper).toBe(666)
    expect(w.outliers).toEqual([])
  })

  it('Tukey stops at the furthest point inside the fence, never past the data', () => {
    const w = whiskers(CONTROL, 'tukey')
    const stats = describe(CONTROL)
    if (stats === undefined) throw new Error('expected statistics')
    const fence = 1.5 * (stats.q3 - stats.q1)
    expect(w.lower).toBeGreaterThanOrEqual(stats.q1 - fence)
    expect(w.upper).toBeLessThanOrEqual(stats.q3 + fence)
    // Every value the fence excluded is reported rather than dropped.
    expect(w.outliers).toEqual(CONTROL.filter((v) => v < w.lower || v > w.upper))
    expect(w.upper).toBeLessThan(666)
    expect(w.outliers).toContain(666)
  })

  it('percentile rules put everything outside them in the outliers', () => {
    for (const rule of ['p10_90', 'p5_95', 'p2_5_97_5', 'p1_99'] as const) {
      const w = whiskers(CONTROL, rule)
      expect(w.lower, rule).toBeLessThanOrEqual(w.upper)
      for (const o of w.outliers) expect(o < w.lower || o > w.upper, rule).toBe(true)
    }
  })

  it('never puts a whisker inside its own box', () => {
    const stats = describe(CONTROL)
    if (stats === undefined) throw new Error('expected statistics')
    for (const rule of ['minMax', 'tukey', 'p10_90', 'p5_95'] as const) {
      const w = whiskers(CONTROL, rule)
      expect(w.lower, rule).toBeLessThanOrEqual(stats.q1)
      expect(w.upper, rule).toBeGreaterThanOrEqual(stats.q3)
    }
  })
})

suite('density', () => {
  it('is clipped to the values, as Prism describes', () => {
    // A kernel estimate normally spreads past both ends; Prism does not draw
    // it there, which is why violins look flat-topped.
    const d = density(CONTROL)
    expect(d.length).toBeGreaterThan(2)
    expect(d[0]?.value).toBe(1)
    expect(d[d.length - 1]?.value).toBe(666)
    for (const p of d) expect(p.halfWidth).toBeLessThanOrEqual(1)
    expect(Math.max(...d.map((p) => p.halfWidth))).toBeCloseTo(1, 10)
  })

  it('gives up rather than drawing a shape from one value', () => {
    expect(density([5])).toEqual([])
    expect(density([5, 5, 5])).toEqual([])
  })

  it('smooths more heavily when asked to', () => {
    // Not a claim about matching Prism - only that the control does something
    // monotone, since the mapping to Prism's scale is unknown.
    const rough = density(CONTROL, 'light').map((p) => p.halfWidth)
    const smooth = density(CONTROL, 'heavy').map((p) => p.halfWidth)
    const variation = (xs: number[]) =>
      xs.slice(1).reduce((a, x, i) => a + Math.abs(x - (xs[i] as number)), 0)
    expect(variation(smooth)).toBeLessThan(variation(rough))
  })
})

suite('Kaplan-Meier', () => {
  it('holds at one until the first event, then divides by those still at risk', () => {
    // Four subjects, the first censored. The point of the estimator is that the
    // censored one is not counted against the later events: at t=2 three remain
    // at risk, so the curve falls to two thirds and not to one half.
    const steps = kaplanMeier([
      { time: 1, event: false },
      { time: 2, event: true },
      { time: 3, event: true },
      { time: 4, event: true },
    ])
    expect(steps[0]?.survival).toBe(1)
    expect(steps[1]?.atRisk).toBe(3)
    expect(steps[1]?.survival).toBeCloseTo(2 / 3, 12)
    expect(steps[2]?.survival).toBeCloseTo(1 / 3, 12)
    expect(steps[3]?.survival).toBe(0)
  })

  it('drops by the share of those still at risk', () => {
    // Four subjects, one event at each time: 3/4, then 2/3, then 1/2, then 0.
    const steps = kaplanMeier([1, 2, 3, 4].map((t) => ({ time: t, event: true })))
    expect(steps.map((s) => s.survival)).toEqual([0.75, 0.5, 0.25, 0])
  })

  it('lets a censored observation leave without moving the curve', () => {
    const steps = kaplanMeier([
      { time: 1, event: false },
      { time: 2, event: true },
    ])
    expect(steps[0]?.survival).toBe(1)
    expect(steps[0]?.censored).toBe(1)
    // One of two was censored, so the event at t=2 removes the only one left.
    expect(steps[1]?.atRisk).toBe(1)
    expect(steps[1]?.survival).toBe(0)
  })

  it('ties at one time are one step', () => {
    const steps = kaplanMeier([
      { time: 3, event: true },
      { time: 3, event: true },
      { time: 9, event: true },
    ])
    expect(steps).toHaveLength(2)
    expect(steps[0]?.events).toBe(2)
    expect(steps[0]?.survival).toBeCloseTo(1 / 3, 12)
  })

  it('reports the median as the first time at or below one half', () => {
    const steps = kaplanMeier([1, 2, 3, 4].map((t) => ({ time: t, event: true })))
    expect(medianSurvival(steps)).toBe(2)
    expect(medianSurvival(kaplanMeier([{ time: 1, event: false }]))).toBeUndefined()
  })

  it('never rises', () => {
    const steps = kaplanMeier([
      { time: 1, event: true },
      { time: 2, event: false },
      { time: 3, event: true },
      { time: 3, event: false },
      { time: 8, event: true },
    ])
    for (let i = 1; i < steps.length; i++) {
      expect((steps[i] as { survival: number }).survival).toBeLessThanOrEqual(
        (steps[i - 1] as { survival: number }).survival,
      )
    }
  })
})
