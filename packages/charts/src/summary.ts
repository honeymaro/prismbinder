/**
 * Descriptive numbers, and the one place allowed to compute any.
 *
 * The project does not recompute Prism's statistics. Charts still need
 * summaries, so the edge is drawn here: this module holds definitional
 * descriptions of the values present - counts, extremes, means, percentiles,
 * spread - and nothing that fits a model. Anything Prism worked out and stored
 * is read from `analyses/<id>/results.json` instead, and anything needing a fit
 * is refused.
 *
 * **Percentiles use the Weibull rule, `(n+1)p`.** That is measured, not
 * assumed. Prism's own `COLUMN_STATISTICS` results give quartiles for two
 * columns of fourteen values; of the five common definitions only this one
 * reproduces all four numbers exactly:
 *
 *   values 1 2 4 9 24 35 45 56 67 89 111 222 345 666
 *   Prism  Q1 7.75   median 50.5   Q3 138.75
 *   (n+1)p 7.75             50.5      138.75      <- match
 *   (n-1)p 12.75            50.5      105.5       <- Excel's default
 *
 * The user guide warns that Prism's method differs from Excel's without saying
 * how. It differs from `PERCENTILE.INC` and agrees with `PERCENTILE.EXC`.
 */

export interface Descriptives {
  readonly n: number
  readonly min: number
  readonly max: number
  readonly mean: number
  /** Sample standard deviation, dividing by n-1. */
  readonly sd: number
  readonly sem: number
  readonly q1: number
  readonly median: number
  readonly q3: number
}

/** Sorted ascending, with anything non-finite already removed. */
export function describe(values: readonly number[]): Descriptives | undefined {
  const v = [...values].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  const n = v.length
  if (n === 0) return undefined

  const mean = v.reduce((a, b) => a + b, 0) / n
  // n-1, matching the meanSE Prism stores: sd / sqrt(n) reproduces it exactly.
  const variance = n > 1 ? v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0
  const sd = Math.sqrt(variance)

  return {
    n,
    min: v[0] as number,
    max: v[n - 1] as number,
    mean,
    sd,
    sem: n > 1 ? sd / Math.sqrt(n) : 0,
    q1: percentileSorted(v, 0.25),
    median: percentileSorted(v, 0.5),
    q3: percentileSorted(v, 0.75),
  }
}

export function percentile(values: readonly number[], p: number): number {
  const v = [...values].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  return percentileSorted(v, p)
}

/**
 * The Weibull rule. Position is `(n+1)p` counting from one, so subtract one to
 * index, then interpolate. Out-of-range positions clamp to the extremes, which
 * is what happens for a percentile a small sample cannot reach.
 */
export function percentileSorted(sorted: readonly number[], p: number): number {
  const n = sorted.length
  if (n === 0) return Number.NaN
  if (n === 1) return sorted[0] as number
  const h = (n + 1) * p - 1
  if (h <= 0) return sorted[0] as number
  if (h >= n - 1) return sorted[n - 1] as number
  const lo = Math.floor(h)
  const frac = h - lo
  const a = sorted[lo] as number
  const b = sorted[lo + 1] as number
  return a + frac * (b - a)
}

export type WhiskerRule =
  | 'minMax'
  | 'tukey'
  | 'p10_90'
  | 'p5_95'
  | 'p2_5_97_5'
  | 'p1_99'
  | 'minMaxAllPoints'

export const WHISKER_RULES: readonly WhiskerRule[] = [
  'minMax',
  'tukey',
  'p10_90',
  'p5_95',
  'p2_5_97_5',
  'p1_99',
  'minMaxAllPoints',
]

export interface Whiskers {
  readonly lower: number
  readonly upper: number
  /** Values outside the whiskers. Empty for the two min-to-max rules. */
  readonly outliers: readonly number[]
  /** True when every value is drawn as a point as well as the box. */
  readonly allPoints: boolean
}

export function whiskers(values: readonly number[], rule: WhiskerRule): Whiskers {
  const v = [...values].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) {
    return { lower: Number.NaN, upper: Number.NaN, outliers: [], allPoints: false }
  }
  const min = v[0] as number
  const max = v[v.length - 1] as number

  if (rule === 'minMax' || rule === 'minMaxAllPoints') {
    return { lower: min, upper: max, outliers: [], allPoints: rule === 'minMaxAllPoints' }
  }

  let lower: number
  let upper: number
  if (rule === 'tukey') {
    // 1.5 interquartile ranges, or the furthest point inside that, whichever
    // is nearer - so a whisker never extends past real data.
    const q1 = percentileSorted(v, 0.25)
    const q3 = percentileSorted(v, 0.75)
    const fence = 1.5 * (q3 - q1)
    lower = Math.min(...v.filter((x) => x >= q1 - fence))
    upper = Math.max(...v.filter((x) => x <= q3 + fence))
    // A hinge is interpolated between two values, so on a small skewed sample
    // the furthest point inside the fence can sit below it - `Col. stats` in
    // the corpus has a q3 of 499.625 whose nearest inside point is 107.5. A
    // whisker drawn there would end inside its own box, which is not a picture
    // of anything. The hinge is the floor.
    lower = Math.min(lower, q1)
    upper = Math.max(upper, q3)
  } else {
    const [lo, hi] = PERCENTILE_PAIRS[rule]
    lower = percentileSorted(v, lo)
    upper = percentileSorted(v, hi)
  }

  return {
    lower,
    upper,
    outliers: v.filter((x) => x < lower || x > upper),
    allPoints: false,
  }
}

const PERCENTILE_PAIRS: Record<'p10_90' | 'p5_95' | 'p2_5_97_5' | 'p1_99', [number, number]> = {
  p10_90: [0.1, 0.9],
  p5_95: [0.05, 0.95],
  p2_5_97_5: [0.025, 0.975],
  p1_99: [0.01, 0.99],
}

export type Smoothing = 'light' | 'medium' | 'heavy'

/**
 * A kernel density estimate for a violin plot.
 *
 * Gaussian kernel, Silverman's rule for the bandwidth, scaled by the smoothing
 * choice. **The mapping from Prism's light/medium/heavy to a bandwidth is ours
 * and matches nothing** - Prism does not publish its scale, and a violin's
 * shape is not recoverable from a file we can read. The quartile lines drawn
 * across the violin come from `describe` and are checkable; the outline is a
 * depiction.
 *
 * Clipped to the observed range, as Prism describes: the distribution is not
 * extended past the largest or below the smallest value, which is why violins
 * look cut off at both ends.
 */
export function density(
  values: readonly number[],
  smoothing: Smoothing = 'medium',
  samples = 64,
): { value: number; halfWidth: number }[] {
  const v = [...values].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  const n = v.length
  if (n < 2) return []
  const min = v[0] as number
  const max = v[n - 1] as number
  if (max === min) return []

  const stats = describe(v)
  if (stats === undefined) return []
  const iqr = stats.q3 - stats.q1
  const sigma = Math.min(stats.sd, iqr > 0 ? iqr / 1.349 : stats.sd) || stats.sd
  const silverman = 0.9 * sigma * n ** (-1 / 5)
  const scale = smoothing === 'light' ? 0.5 : smoothing === 'heavy' ? 2 : 1
  const h = Math.max(silverman * scale, (max - min) / 1000)

  const out: { value: number; halfWidth: number }[] = []
  let peak = 0
  for (let i = 0; i < samples; i++) {
    const value = min + ((max - min) * i) / (samples - 1)
    let sum = 0
    for (const x of v) {
      const u = (value - x) / h
      sum += Math.exp(-0.5 * u * u)
    }
    const d = sum / (n * h * Math.sqrt(2 * Math.PI))
    peak = Math.max(peak, d)
    out.push({ value, halfWidth: d })
  }
  if (peak === 0) return []
  return out.map((p) => ({ value: p.value, halfWidth: p.halfWidth / peak }))
}

export interface SurvivalStep {
  readonly time: number
  /** Fraction still at risk after this time. */
  readonly survival: number
  readonly atRisk: number
  readonly events: number
  readonly censored: number
}

/**
 * The Kaplan-Meier estimator.
 *
 * A running product over the distinct event times, which is a definition rather
 * than a fit - but it is the one chart in this package whose curve Prism calls
 * an analysis, so it is drawn behind the same badge as everything else and its
 * median is checked against the `medianSurvival` Prism stores.
 *
 * `event` is 1 for the event of interest and 0 for a censored observation, the
 * coding Prism's survival tables use.
 */
export function kaplanMeier(
  observations: readonly { time: number; event: boolean }[],
): SurvivalStep[] {
  const obs = observations
    .filter((o) => Number.isFinite(o.time) && o.time >= 0)
    .sort((a, b) => a.time - b.time)
  if (obs.length === 0) return []

  const steps: SurvivalStep[] = []
  let atRisk = obs.length
  let survival = 1
  let i = 0
  while (i < obs.length) {
    const time = (obs[i] as { time: number }).time
    let events = 0
    let censored = 0
    while (i < obs.length && (obs[i] as { time: number }).time === time) {
      if ((obs[i] as { event: boolean }).event) events++
      else censored++
      i++
    }
    const before = atRisk
    if (events > 0) survival *= (before - events) / before
    steps.push({ time, survival, atRisk: before, events, censored })
    atRisk = before - events - censored
  }
  return steps
}

/** The first time the curve reaches or drops below one half. */
export function medianSurvival(steps: readonly SurvivalStep[]): number | undefined {
  for (const s of steps) if (s.survival <= 0.5) return s.time
  return undefined
}
