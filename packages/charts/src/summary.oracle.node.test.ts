import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, describe as suite } from 'vitest'
import { describe, kaplanMeier, percentile, whiskers } from './summary.js'

/**
 * Our arithmetic against numpy, scipy and statsmodels.
 *
 * The statistics in `summary.ts` were checked against the quartiles Prism
 * stored for two columns of fourteen values. That settled the percentile rule
 * and nothing else: two columns cannot exercise ties, even lengths, single
 * values, or a sample whose whiskers land outside the fence. Widening it inside
 * Prism needs a licence this machine does not have.
 *
 * These reference implementations need no licence and predate Prism. numpy
 * spells Prism's percentile rule `method="weibull"`, and it reproduces all
 * three stored quartiles exactly - so agreeing with numpy here is the same
 * claim as agreeing with Prism there, over a few hundred samples instead of
 * two.
 *
 * Skipped, not failed, when Python or the modules are absent. Same shape as the
 * corpus suites, which skip when no Prism installation is found: a check that
 * fails on a machine merely for lacking an optional tool gets deleted.
 */

// Relative to this file rather than to the working directory: the suite runs
// both from the repository root and from the package, and a path that resolves
// in one and not the other would silently skip in the other.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const ORACLE = join(ROOT, 'tools', 'prism-reference', 'oracle.py')

interface Reference {
  ok: boolean
  reason?: string
  versions?: Record<string, string | null>
  results?: {
    id: number
    describe?: {
      n: number
      min: number
      max: number
      mean: number
      sd: number
      sem: number
      [percentile: string]: number
    } | null
    tukey?: { q1: number; q3: number; lower: number; upper: number } | null
    km?: [number, number][] | null
  }[]
}

interface Case {
  id: number
  what: string
  values?: number[]
  km?: [number, boolean][]
}

/** Whichever of the usual spellings exists. Windows installs `py`, Linux `python3`. */
function runOracle(cases: Case[]): Reference | undefined {
  if (!existsSync(ORACLE)) return undefined
  const payload = JSON.stringify({ cases })
  for (const exe of ['python', 'python3', 'py']) {
    const r = spawnSync(exe, [ORACLE], {
      input: payload,
      encoding: 'utf8',
      // A few hundred samples is milliseconds of work; anything longer means
      // the interpreter is waiting on something and we would rather skip.
      timeout: 60_000,
      windowsHide: true,
    })
    if (r.error !== undefined || r.status !== 0 || typeof r.stdout !== 'string') continue
    try {
      return JSON.parse(r.stdout) as Reference
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * A deterministic generator.
 *
 * Seeded rather than random so a disagreement can be reproduced from the
 * failure message alone. A property test that reports a different counterexample
 * on every run is a bug report nobody can act on.
 */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Samples covering what two columns of stored quartiles cannot.
 *
 * Ties matter because an interpolated percentile lands between two equal
 * values; even lengths matter because the median is then interpolated at all;
 * single values matter because n-1 is zero and every spread is a special case;
 * and a heavy right tail is what makes a Tukey whisker fall outside its fence.
 */
function cases(): Case[] {
  const r = rng(0x9e3779b9)
  const out: Case[] = []
  const push = (what: string, values: number[]) => out.push({ id: out.length, what, values })

  // Lengths one to twenty-four, so both parities and every small n are covered.
  for (let n = 1; n <= 24; n++) {
    push(
      `uniform n=${n}`,
      Array.from({ length: n }, () => r() * 200 - 100),
    )
    // Small integers collide constantly, which is the tie case.
    push(
      `ties n=${n}`,
      Array.from({ length: n }, () => Math.floor(r() * 5)),
    )
  }

  for (let k = 0; k < 40; k++) {
    const n = 2 + Math.floor(r() * 39)
    push(
      `uniform n=${n} #${k}`,
      Array.from({ length: n }, () => r() * 1000),
    )
    // Orders of magnitude apart, where a sum loses precision differently
    // depending on the order it is taken in.
    push(
      `wide n=${n} #${k}`,
      Array.from({ length: n }, () => 10 ** (r() * 12 - 6) * (r() < 0.5 ? -1 : 1)),
    )
    // The shape of the corpus column that produced the whisker-inside-the-box
    // defect: a long right tail over a tight cluster.
    push(
      `skewed n=${n} #${k}`,
      Array.from({ length: n }, () => (r() < 0.85 ? r() * 10 : 100 + r() * 900)),
    )
  }

  push(
    'all identical',
    Array.from({ length: 9 }, () => 42),
  )
  push('two distinct', [1, 1, 1, 1, 7, 7, 7, 7])
  push('negative only', [-9, -4, -4, -1])
  push('the corpus column', [1, 2, 4, 9, 24, 35, 45, 56, 67, 89, 111, 222, 345, 666])
  push('the other corpus column', [3, 4, 7, 14, 21, 34, 45, 56, 78, 99, 234, 543, 567, 897])

  // Survival. Integer times so ties at a time are common, which is where the
  // risk set has to be got right, and a third censored.
  for (let k = 0; k < 30; k++) {
    const n = 4 + Math.floor(r() * 30)
    out.push({
      id: out.length,
      what: `survival n=${n} #${k}`,
      km: Array.from(
        { length: n },
        () => [1 + Math.floor(r() * 12), r() > 0.3] as [number, boolean],
      ),
    })
  }
  return out
}

/** Relative, because the values span twelve orders of magnitude. */
function close(ours: number, theirs: number): boolean {
  if (Number.isNaN(ours) && Number.isNaN(theirs)) return true
  const scale = Math.max(Math.abs(ours), Math.abs(theirs), 1)
  return Math.abs(ours - theirs) <= 1e-9 * scale
}

const PERCENTILE_KEYS: [string, number][] = [
  ['p1', 0.01],
  ['p2_5', 0.025],
  ['p5', 0.05],
  ['p10', 0.1],
  ['q1', 0.25],
  ['median', 0.5],
  ['q3', 0.75],
  ['p90', 0.9],
  ['p95', 0.95],
  ['p97_5', 0.975],
  ['p99', 0.99],
]

const all = cases()
const reference = runOracle(all)
const byId = new Map((reference?.results ?? []).map((r) => [r.id, r]))
const available = reference?.ok === true && byId.size > 0

suite.skipIf(!available)('checked against numpy, scipy and statsmodels', () => {
  it('reports which implementations it checked against', () => {
    // Recorded in the run output on purpose: "verified against numpy" is worth
    // nothing without saying which numpy.
    expect(reference?.versions?.numpy).toBeTypeOf('string')
    expect(byId.size).toBeGreaterThan(100)
  })

  it('computes the same mean, spread and extremes', () => {
    const wrong: string[] = []
    for (const c of all) {
      if (c.values === undefined) continue
      const theirs = byId.get(c.id)?.describe
      const ours = describe(c.values)
      if (theirs === null || theirs === undefined) {
        if (ours !== undefined) wrong.push(`${c.what}: we described a sample they did not`)
        continue
      }
      if (ours === undefined) {
        wrong.push(`${c.what}: they described a sample we did not`)
        continue
      }
      for (const k of ['n', 'min', 'max', 'mean', 'sd', 'sem'] as const) {
        if (!close(ours[k], theirs[k])) {
          wrong.push(`${c.what}: ${k} ours=${ours[k]} theirs=${theirs[k]}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('places every percentile where the Weibull rule places it', () => {
    // The single most load-bearing agreement in the package. A box plot, an
    // error bar and a whisker are all this function.
    const wrong: string[] = []
    for (const c of all) {
      if (c.values === undefined) continue
      const theirs = byId.get(c.id)?.describe
      if (theirs === null || theirs === undefined) continue
      for (const [name, p] of PERCENTILE_KEYS) {
        const ours = percentile(c.values, p)
        const them = theirs[name] as number
        if (!close(ours, them)) {
          wrong.push(`${c.what}: ${name} ours=${ours} theirs=${them}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('draws Tukey whiskers at the fence, clamped to the hinges', () => {
    // The clamp is ours and deliberate, so it is asserted rather than tolerated:
    // theirs is the textbook construction, ours is that construction with a
    // whisker never allowed to end inside its own box.
    const wrong: string[] = []
    for (const c of all) {
      if (c.values === undefined) continue
      const theirs = byId.get(c.id)?.tukey
      if (theirs === null || theirs === undefined) continue
      const ours = whiskers(c.values, 'tukey')
      const expectedLower = Math.min(theirs.lower, theirs.q1)
      const expectedUpper = Math.max(theirs.upper, theirs.q3)
      if (!close(ours.lower, expectedLower)) {
        wrong.push(`${c.what}: lower ours=${ours.lower} expected=${expectedLower}`)
      }
      if (!close(ours.upper, expectedUpper)) {
        wrong.push(`${c.what}: upper ours=${ours.upper} expected=${expectedUpper}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('takes the Kaplan-Meier product over the same risk set', () => {
    const wrong: string[] = []
    let compared = 0
    for (const c of all) {
      if (c.km === undefined) continue
      const theirs = byId.get(c.id)?.km
      if (theirs === null || theirs === undefined) continue
      const ours = kaplanMeier(c.km.map(([time, event]) => ({ time, event })))
      for (const [time, survival] of theirs) {
        const step = ours.find((s) => s.time === time)
        if (step === undefined) {
          wrong.push(`${c.what}: no step at t=${time}`)
          continue
        }
        compared++
        if (!close(step.survival, survival)) {
          wrong.push(`${c.what}: S(${time}) ours=${step.survival} theirs=${survival}`)
        }
      }
    }
    expect(wrong).toEqual([])
    expect(compared).toBeGreaterThan(0)
  })
})
