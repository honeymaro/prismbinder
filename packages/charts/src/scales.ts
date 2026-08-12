import type { Axis, ScaleKind } from './types.js'

/**
 * Data space to pixel space.
 *
 * Written here rather than taken from d3 for the same reason the ZIP and CSV
 * codecs are: the package has to run unchanged in a browser and in the CLI, and
 * three scale kinds are less code than the shim that would keep a dependency
 * honest about ticks on a log axis.
 */

export interface Scale {
  readonly kind: ScaleKind
  readonly domain: readonly [number, number]
  readonly range: readonly [number, number]
  map(value: number): number
  ticks(target?: number): readonly { value: number; label: string }[]
}

export function scaleFor(axis: Axis, range: readonly [number, number]): Scale {
  if (axis.kind === 'category') return categoryScale(axis, range)
  if (axis.kind === 'log') return logScale(axis, range)
  return linearScale(axis, range)
}

function project(
  value: number,
  d0: number,
  d1: number,
  r0: number,
  r1: number,
  reversed: boolean,
): number {
  if (d1 === d0) return (r0 + r1) / 2
  const t = (value - d0) / (d1 - d0)
  return reversed ? r1 - t * (r1 - r0) : r0 + t * (r1 - r0)
}

function linearScale(axis: Axis, range: readonly [number, number]): Scale {
  const [d0, d1] = niceDomain(axis.min, axis.max)
  return {
    kind: 'linear',
    domain: [d0, d1],
    range,
    map: (v) => project(v, d0, d1, range[0], range[1], axis.reversed),
    ticks: (target = 6) => linearTicks(d0, d1, axis.tickInterval, target),
  }
}

/**
 * A log axis, which a dose-response curve is unreadable without.
 *
 * Non-positive values cannot be placed. They are dropped by the caller rather
 * than clamped, because clamping a zero onto the axis minimum draws a point
 * where there is no measurement.
 */
function logScale(axis: Axis, range: readonly [number, number]): Scale {
  const lo = Math.log10(Math.max(axis.min, Number.MIN_VALUE))
  const hi = Math.log10(Math.max(axis.max, Number.MIN_VALUE * 10))
  const d0 = Math.floor(lo)
  const d1 = Math.ceil(hi)
  return {
    kind: 'log',
    domain: [10 ** d0, 10 ** d1],
    range,
    map: (v) =>
      v <= 0 ? Number.NaN : project(Math.log10(v), d0, d1, range[0], range[1], axis.reversed),
    ticks: () => {
      const out: { value: number; label: string }[] = []
      const step = Math.max(1, Math.ceil((d1 - d0) / 8))
      for (let e = d0; e <= d1; e += step) {
        const value = 10 ** e
        out.push({ value, label: formatNumber(value) })
      }
      return out
    },
  }
}

/**
 * One slot per category, with the tick at the middle of the slot.
 *
 * Bars sit inside their slot, so the slot width is what a caller divides among
 * however many series it is interleaving.
 */
function categoryScale(axis: Axis, range: readonly [number, number]): Scale {
  const count = Math.max(axis.categories.length, 1)
  return {
    kind: 'category',
    domain: [0, count],
    range,
    map: (v) => project(v, 0, count, range[0], range[1], axis.reversed),
    ticks: () =>
      axis.categories.map((label, i) => ({ value: i + 0.5, label: label === '' ? ' ' : label })),
  }
}

/** Slot width in pixels for a category axis. */
export function slotWidth(scale: Scale): number {
  const count = scale.domain[1] - scale.domain[0]
  return count === 0 ? 0 : Math.abs(scale.range[1] - scale.range[0]) / count
}

/**
 * Rounds a domain out to friendly bounds.
 *
 * A flat series would otherwise collapse to zero height, and a domain that ends
 * exactly on the largest value puts a point on the frame.
 */
export function niceDomain(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) {
    const pad = Math.abs(min) || 1
    return [min - pad, max + pad]
  }
  const step = tickStep(min, max, 6)
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step]
}

function tickStep(min: number, max: number, target: number): number {
  const raw = (max - min) / Math.max(target, 1)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalised = raw / magnitude
  const nice = normalised >= 5 ? 10 : normalised >= 2 ? 5 : normalised >= 1 ? 2 : 1
  return nice * magnitude
}

function linearTicks(
  d0: number,
  d1: number,
  interval: number | undefined,
  target: number,
): { value: number; label: string }[] {
  const step = interval !== undefined && interval > 0 ? interval : tickStep(d0, d1, target)
  const out: { value: number; label: string }[] = []
  const first = Math.ceil(d0 / step) * step
  // Guard against a step so small the loop would not terminate usefully.
  const count = Math.floor((d1 - first) / step)
  if (!Number.isFinite(count) || count > 1000) return [{ value: d0, label: formatNumber(d0) }]
  for (let i = 0; i <= count; i++) {
    const value = first + i * step
    out.push({ value: cleanFloat(value), label: formatNumber(cleanFloat(value)) })
  }
  return out
}

/** 0.1 + 0.2 should tick as 0.3, not as 0.30000000000000004. */
function cleanFloat(v: number): number {
  return Math.round(v * 1e10) / 1e10
}

export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return ''
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(1)
  return String(cleanFloat(v))
}
