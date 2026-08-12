import { formatNumber, type Scale, scaleFor, slotWidth } from './scales.js'
import { type ChartSpec, type El, el, type Mark } from './types.js'

/**
 * A chart spec becomes an element tree.
 *
 * The tree is plain data - tag, attributes, children - so the same output can
 * be serialised to an SVG file by the CLI and mapped to React nodes by the
 * editor, and so a test can assert about a mark's geometry without a DOM.
 *
 * Every chart is labelled. A reconstructed chart is not Prism's figure, and a
 * picture is the form in which a person is most likely to believe otherwise.
 */

export const PALETTE: readonly string[] = [
  '#3b6fd4',
  '#d4663b',
  '#3ba05f',
  '#a03b8f',
  '#c9a227',
  '#3ba0a0',
  '#8f5fd4',
  '#d43b6f',
]

export interface RenderOptions {
  readonly width?: number
  readonly height?: number
  readonly palette?: readonly string[]
}

interface Frame {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

export function renderChart(spec: ChartSpec, opts: RenderOptions = {}): El {
  const width = opts.width ?? 680
  const height = opts.height ?? 340
  const palette = opts.palette ?? PALETTE
  const colour = (i: number): string => palette[i % palette.length] as string

  const body =
    spec.kind === 'pie' || spec.kind === 'donut'
      ? radial(spec, width, height, colour)
      : spec.kind === 'heatmap'
        ? heatmap(spec, width, height)
        : cartesian(spec, width, height, colour)

  return el(
    'svg',
    {
      viewBox: `0 0 ${width} ${height}`,
      class: 'pbchart',
      role: 'img',
      'aria-label': ariaLabel(spec),
    },
    [el('title', {}, [ariaLabel(spec)]), ...body],
  )
}

function ariaLabel(spec: ChartSpec): string {
  const what = spec.fidelity === 'read' ? 'Chart' : 'Reconstructed chart'
  const n = spec.series.length
  return `${what} of ${spec.title}: ${spec.kind}, ${n} series`
}

/** Rough width of a tick label at 11px. Enough to decide whether two collide. */
const CHAR_WIDTH = 6.2
const LABEL_LINE = 13
/** Height of a single row of horizontal tick labels. */
const FLAT_LABELS = 22
/** Half the width of an error bar cap, and the length of an axis tick mark. */
const CAP = 4
const TICK = 4

/**
 * How the category labels can be made to fit, if they can.
 *
 * Long row titles are the normal case, not the awkward one: a nonlinear
 * regression results table has twenty rows called things like "95% CI (profile
 * likelihood)" and "# Y values analyzed". Drawn flat and centred they overlap
 * into a smear, which is what this decides how to avoid.
 *
 * The order of preference is Prism's own, from the Format Axes dialog: leave
 * them flat, angle them, or stop drawing some of them.
 */
interface LabelPlan {
  readonly ticks: readonly { value: number; label: string }[]
  readonly rotate: boolean
  /** Space the labels need along the axis they hang off. */
  readonly extent: number
  /** True when some labels were dropped because no angle would fit them all. */
  readonly thinned: boolean
}

function planLabels(spec: ChartSpec, plotSize: number): LabelPlan {
  const categories = spec.axisX.categories
  if (spec.axisX.kind !== 'category' || categories.length === 0) {
    // A numeric axis still writes a row of tick labels, and the axis title has
    // to clear it. Reporting zero here put "Hours" straight through "40".
    return { ticks: [], rotate: false, extent: FLAT_LABELS, thinned: false }
  }

  const slot = plotSize / categories.length
  const longest = Math.max(...categories.map((c) => c.length), 1) * CHAR_WIDTH
  const all = categories.map((label, i) => ({ value: i + 0.5, label }))

  // A horizontal chart puts these down the left edge, where they stack rather
  // than collide, so they only ever need width.
  if (spec.horizontal) {
    const fits = slot >= LABEL_LINE
    const extent = Math.min(longest + 12, MAX_SIDE)
    const room = Math.floor((extent - 12) / CHAR_WIDTH)
    return {
      ticks: cut(fits ? all : thin(all, Math.ceil(LABEL_LINE / slot)), room),
      rotate: false,
      extent,
      thinned: !fits,
    }
  }

  if (longest + 6 <= slot) {
    return { ticks: all, rotate: false, extent: FLAT_LABELS, thinned: false }
  }

  // Angled, the labels are spaced by their height rather than their width, so
  // what has to fit in a slot is a line of text rather than a whole title.
  const extent = Math.min(longest * 0.72 + 14, MAX_BELOW)
  const room = Math.floor((extent - 14) / 0.72 / CHAR_WIDTH)
  if (LABEL_LINE <= slot) {
    return { ticks: cut(all, room), rotate: true, extent, thinned: false }
  }

  const step = Math.ceil(LABEL_LINE / slot)
  return { ticks: cut(thin(all, step), room), rotate: true, extent, thinned: true }
}

/** Past this the labels would own more of the picture than the data does. */
const MAX_BELOW = 120
const MAX_SIDE = 170

function thin<T>(items: readonly T[], step: number): T[] {
  return items.filter((_, i) => i % Math.max(step, 1) === 0)
}

/**
 * Shortens a label that would run past the space reserved for it.
 *
 * Truncated rather than shrunk: making the type smaller until a twenty-row
 * results table fits produces labels nobody can read either way, and the
 * trailing dots at least say that something was cut.
 */
function cut(
  ticks: readonly { value: number; label: string }[],
  room: number,
): { value: number; label: string }[] {
  const max = Math.max(room, 6)
  return ticks.map((t) =>
    t.label.length <= max
      ? t
      : { value: t.value, label: `${t.label.slice(0, max - 3).trimEnd()}...` },
  )
}

/** Room for tick labels, axis titles and, when there is more than one, a legend. */
function frameFor(spec: ChartSpec, width: number, height: number, labels: LabelPlan): Frame {
  const legend = spec.series.length > 1 ? 18 : 0
  const title = (spec.horizontal ? spec.axisY.title : spec.axisX.title) === '' ? 0 : 16
  const left = spec.horizontal ? Math.max(62, labels.extent) : 62
  const right = 16
  const top = 16
  const bottom = (spec.horizontal ? FLAT_LABELS : labels.extent) + title + legend + 12
  return { left, right, top, bottom, width: width - left - right, height: height - top - bottom }
}

function cartesian(
  spec: ChartSpec,
  width: number,
  height: number,
  colour: (i: number) => string,
): El[] {
  // Sized against the plot area, which depends on the labels, which depend on
  // the plot area. One pass with the full width is close enough: the margins
  // only ever shrink it, so a label that fits the first estimate and not the
  // second is thinned rather than overlapped.
  const along = spec.horizontal ? height - 60 : width - 78
  const labels = planLabels(spec, Math.max(along, 1))
  const f = frameFor(spec, width, height, labels)

  // A horizontal chart is the same chart with the axes exchanged, so the marks
  // below stay written in one orientation and the mapping does the swapping.
  const xRange: [number, number] = [f.left, f.left + f.width]
  const yRange: [number, number] = [f.top + f.height, f.top]
  const sx = scaleFor(spec.axisX, spec.horizontal ? yRange : xRange)
  const sy = scaleFor(spec.axisY, spec.horizontal ? xRange : yRange)
  const px = (x: number, y: number): [number, number] =>
    spec.horizontal ? [sy.map(y), sx.map(x)] : [sx.map(x), sy.map(y)]

  const out: El[] = []
  out.push(...grid(spec, sx, sy, f, labels))
  for (const mark of spec.marks) out.push(...renderMark(mark, spec, px, sx, sy, colour, f))
  out.push(...legendOf(spec, f, colour, width, height))
  return out
}

function grid(spec: ChartSpec, sx: Scale, sy: Scale, f: Frame, labels: LabelPlan): El[] {
  const out: El[] = []
  const horizontal = spec.horizontal
  // `sx` always carries the X axis of the spec and `sy` the Y; a horizontal
  // chart swaps which pixel range each was given, not which is which.
  const valueScale = sy
  const catScale = sx

  // Gridlines follow the value axis, which is Y unless the chart is flipped.
  for (const t of valueScale.ticks()) {
    const p = valueScale.map(t.value)
    if (!Number.isFinite(p)) continue
    const [x1, y1, x2, y2] = horizontal
      ? [p, f.top, p, f.top + f.height]
      : [f.left, p, f.left + f.width, p]
    out.push(el('line', { class: 'pbchart-grid', x1, y1, x2, y2 }))
    // A mark on the axis itself, pointing away from the plot, as Prism draws
    // them. Without one a label floats beside a number it does not obviously
    // belong to.
    out.push(
      horizontal
        ? el('line', {
            class: 'pbchart-tickmark',
            x1: p,
            y1: f.top + f.height,
            x2: p,
            y2: f.top + f.height + TICK,
          })
        : el('line', {
            class: 'pbchart-tickmark',
            x1: f.left - TICK,
            y1: p,
            x2: f.left,
            y2: p,
          }),
    )
    const [tx, ty, anchor] = horizontal
      ? [p, f.top + f.height + 16, 'middle']
      : [f.left - 8, p, 'end']
    out.push(
      el('text', { class: 'pbchart-tick', x: tx, y: ty, 'text-anchor': anchor, dy: '0.32em' }, [
        t.label,
      ]),
    )
  }

  // Numeric category axes are rare but possible; fall back to the scale's own
  // ticks when there are no category names to lay out.
  const catTicks = labels.ticks.length > 0 ? labels.ticks : catScale.ticks()
  for (const t of catTicks) {
    const p = catScale.map(t.value)
    if (!Number.isFinite(p)) continue
    out.push(
      el(
        'line',
        horizontal
          ? { class: 'pbchart-tickmark', x1: f.left - TICK, y1: p, x2: f.left, y2: p }
          : {
              class: 'pbchart-tickmark',
              x1: p,
              y1: f.top + f.height,
              x2: p,
              y2: f.top + f.height + TICK,
            },
      ),
    )
    if (horizontal) {
      out.push(
        el(
          'text',
          { class: 'pbchart-tick', x: f.left - 8, y: p, 'text-anchor': 'end', dy: '0.32em' },
          [t.label],
        ),
      )
      continue
    }
    const y = f.top + f.height + 14
    out.push(
      labels.rotate
        ? el(
            'text',
            {
              class: 'pbchart-tick',
              x: p,
              y,
              'text-anchor': 'end',
              transform: `rotate(-45 ${round(p)} ${round(y)})`,
            },
            [t.label],
          )
        : el(
            'text',
            { class: 'pbchart-tick', x: p, y: y + 4, 'text-anchor': 'middle', dy: '0.32em' },
            [t.label],
          ),
    )
  }

  out.push(
    el('line', {
      class: 'pbchart-axis',
      x1: f.left,
      y1: f.top + f.height,
      x2: f.left + f.width,
      y2: f.top + f.height,
    }),
  )
  out.push(
    el('line', {
      class: 'pbchart-axis',
      x1: f.left,
      y1: f.top,
      x2: f.left,
      y2: f.top + f.height,
    }),
  )
  const xTitle = spec.horizontal ? spec.axisY.title : spec.axisX.title
  if (xTitle !== '') {
    out.push(
      el(
        'text',
        {
          class: 'pbchart-axis-title',
          x: f.left + f.width / 2,
          // Below whatever the labels needed, rather than at a fixed offset
          // that angled ones would be written straight through.
          y: f.top + f.height + (spec.horizontal ? FLAT_LABELS : labels.extent) + 12,
          'text-anchor': 'middle',
        },
        [xTitle],
      ),
    )
  }
  return out
}

type Project = (x: number, y: number) => [number, number]

function renderMark(
  mark: Mark,
  spec: ChartSpec,
  px: Project,
  sx: Scale,
  sy: Scale,
  colour: (i: number) => string,
  f: Frame,
): El[] {
  const stroke = 'series' in mark ? colour(spec.series[mark.series]?.colorIndex ?? mark.series) : ''
  switch (mark.kind) {
    case 'points':
      return mark.points
        .map((p) => px(p.x, p.y))
        .filter(finite)
        .map(([cx, cy]) => el('circle', { class: 'pbchart-point', cx, cy, r: 3, fill: stroke }))

    case 'line': {
      const pts = mark.points.map((p) => px(p.x, p.y)).filter(finite)
      if (pts.length < 2) return []
      return [el('path', { class: 'pbchart-line', d: path(pts, mark.step), stroke, fill: 'none' })]
    }

    case 'ticks':
      return mark.points
        .map((p) => px(p.x, p.y))
        .filter(finite)
        .map(([x, y]) =>
          el('line', { class: 'pbchart-censor', x1: x, y1: y - 5, x2: x, y2: y + 5, stroke }),
        )

    case 'errorBars':
      return mark.bars.flatMap((b) => {
        const hi = px(b.x, b.y + b.up)
        const lo = px(b.x, b.y - b.down)
        const mid = px(b.x, b.y)
        if (!finite(hi) || !finite(lo)) return []
        const out: El[] = [
          el('line', {
            class: 'pbchart-error',
            x1: hi[0],
            y1: hi[1],
            x2: lo[0],
            y2: lo[1],
            stroke,
          }),
        ]
        // The caps that make it an error bar rather than a stray stroke. A bare
        // line does not say where the interval ends, and on a chart that also
        // draws connecting lines it does not even say it is an error bar.
        const vertical = Math.abs(hi[0] - lo[0]) <= Math.abs(hi[1] - lo[1])
        for (const [end, arm] of [
          [hi, b.up],
          [lo, b.down],
        ] as const) {
          // No cap where the bar has no length in that direction, which would
          // otherwise draw a bar through the symbol itself.
          if (arm <= 0 || !finite(end)) continue
          if (Math.abs(end[0] - mid[0]) < 0.5 && Math.abs(end[1] - mid[1]) < 0.5) continue
          out.push(
            el('line', {
              class: 'pbchart-error-cap',
              x1: vertical ? end[0] - CAP : end[0],
              y1: vertical ? end[1] : end[1] - CAP,
              x2: vertical ? end[0] + CAP : end[0],
              y2: vertical ? end[1] : end[1] + CAP,
              stroke,
            }),
          )
        }
        return out
      })

    case 'bars':
      return mark.bars.flatMap((b) => {
        const half = b.width / 2
        const a = px(b.x - half, b.y)
        const c = px(b.x + half, b.base)
        if (!finite(a) || !finite(c)) return []
        const x = Math.min(a[0], c[0])
        const y = Math.min(a[1], c[1])
        const w = Math.abs(c[0] - a[0])
        const h = Math.abs(c[1] - a[1])
        return [el('rect', { class: 'pbchart-bar', x, y, width: w, height: h, fill: stroke })]
      })

    case 'boxes':
      return mark.boxes.flatMap((b) => boxEls(b, px, stroke))

    case 'violins':
      return mark.violins.flatMap((v) => violinEls(v, px, stroke))

    case 'hull': {
      const pts = mark.points.map((p) => px(p.x, p.y)).filter(finite)
      if (pts.length < 3) return []
      return [
        el('path', {
          class: 'pbchart-hull',
          d: `${path(pts, false)} Z`,
          stroke,
          fill: stroke,
          'fill-opacity': 0.08,
        }),
      ]
    }

    case 'ellipse': {
      const c = px(mark.cx, mark.cy)
      const edge = px(mark.cx + mark.rx, mark.cy + mark.ry)
      if (!finite(c) || !finite(edge)) return []
      return [
        el('ellipse', {
          class: 'pbchart-ellipse',
          cx: c[0],
          cy: c[1],
          rx: Math.abs(edge[0] - c[0]),
          ry: Math.abs(edge[1] - c[1]),
          transform: `rotate(${(-mark.rotation * 180) / Math.PI} ${c[0]} ${c[1]})`,
          stroke,
          fill: 'none',
        }),
      ]
    }

    case 'dendrogram':
      return dendrogramEls(mark, sx, sy, f)

    default:
      return []
  }
}

function boxEls(
  b: {
    x: number
    width: number
    lowerWhisker: number
    q1: number
    median: number
    q3: number
    upperWhisker: number
    mean: number | undefined
    outliers: readonly number[]
  },
  px: Project,
  stroke: string,
): El[] {
  const half = b.width / 2
  const a = px(b.x - half, b.q3)
  const c = px(b.x + half, b.q1)
  if (!finite(a) || !finite(c)) return []
  const out: El[] = []
  const x = Math.min(a[0], c[0])
  const y = Math.min(a[1], c[1])
  const w = Math.abs(c[0] - a[0])
  const h = Math.abs(c[1] - a[1])

  const centre = px(b.x, b.q3)
  const top = px(b.x, b.upperWhisker)
  const bottomBox = px(b.x, b.q1)
  const bottom = px(b.x, b.lowerWhisker)
  if (finite(centre) && finite(top)) {
    out.push(
      el('line', {
        class: 'pbchart-whisker',
        x1: centre[0],
        y1: centre[1],
        x2: top[0],
        y2: top[1],
        stroke,
      }),
    )
  }
  if (finite(bottomBox) && finite(bottom)) {
    out.push(
      el('line', {
        class: 'pbchart-whisker',
        x1: bottomBox[0],
        y1: bottomBox[1],
        x2: bottom[0],
        y2: bottom[1],
        stroke,
      }),
    )
  }

  out.push(
    el('rect', {
      class: 'pbchart-box',
      x,
      y,
      width: w,
      height: h,
      fill: stroke,
      'fill-opacity': 0.18,
      stroke,
    }),
  )

  const m1 = px(b.x - half, b.median)
  const m2 = px(b.x + half, b.median)
  if (finite(m1) && finite(m2)) {
    out.push(
      el('line', {
        class: 'pbchart-median',
        x1: m1[0],
        y1: m1[1],
        x2: m2[0],
        y2: m2[1],
        stroke,
      }),
    )
  }
  if (b.mean !== undefined) {
    const mp = px(b.x, b.mean)
    if (finite(mp)) {
      out.push(
        el(
          'text',
          { class: 'pbchart-mean', x: mp[0], y: mp[1], 'text-anchor': 'middle', dy: '0.32em' },
          ['+'],
        ),
      )
    }
  }
  for (const o of b.outliers) {
    const p = px(b.x, o)
    if (finite(p)) {
      out.push(el('circle', { class: 'pbchart-outlier', cx: p[0], cy: p[1], r: 2, fill: stroke }))
    }
  }
  return out
}

function violinEls(
  v: {
    x: number
    width: number
    density: readonly { value: number; halfWidth: number }[]
    q1: number
    median: number
    q3: number
  },
  px: Project,
  stroke: string,
): El[] {
  if (v.density.length < 2) return []
  const half = v.width / 2
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (const d of v.density) {
    const l = px(v.x - half * d.halfWidth, d.value)
    const r = px(v.x + half * d.halfWidth, d.value)
    if (finite(l)) left.push(l)
    if (finite(r)) right.push(r)
  }
  if (left.length < 2 || right.length < 2) return []
  const outline = `${path(right, false)} ${left
    .slice()
    .reverse()
    .map(([x, y]) => `L${round(x)},${round(y)}`)
    .join('')} Z`

  const out: El[] = [
    el('path', {
      class: 'pbchart-violin',
      d: outline,
      fill: stroke,
      'fill-opacity': 0.18,
      stroke,
    }),
  ]
  for (const [value, cls] of [
    [v.q1, 'pbchart-quartile'],
    [v.median, 'pbchart-median'],
    [v.q3, 'pbchart-quartile'],
  ] as const) {
    const a = px(v.x - half * 0.6, value)
    const b = px(v.x + half * 0.6, value)
    if (finite(a) && finite(b)) {
      out.push(el('line', { class: cls, x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke }))
    }
  }
  return out
}

function dendrogramEls(
  mark: Extract<Mark, { kind: 'dendrogram' }>,
  sx: Scale,
  sy: Scale,
  _f: Frame,
): El[] {
  const out: El[] = []
  for (const link of mark.links) {
    const x1 = sx.map(link.x1)
    const x2 = sx.map(link.x2)
    const top = sy.map(link.height)
    const c1 = sy.map(link.childHeight1)
    const c2 = sy.map(link.childHeight2)
    if (![x1, x2, top, c1, c2].every(Number.isFinite)) continue
    out.push(
      el('path', {
        class: 'pbchart-link',
        d: `M${round(x1)},${round(c1)} L${round(x1)},${round(top)} L${round(x2)},${round(top)} L${round(x2)},${round(c2)}`,
        fill: 'none',
      }),
    )
  }
  return out
}

function radial(
  spec: ChartSpec,
  width: number,
  height: number,
  colour: (i: number) => string,
): El[] {
  const wedges = spec.marks.find((m) => m.kind === 'wedges')
  if (wedges === undefined || wedges.kind !== 'wedges') return []
  const cx = width / 2
  const cy = height / 2 - 8
  // An exploded slice is pushed out by a fraction of the radius, so the circle
  // has to be drawn smaller by that same fraction or the slice leaves the page.
  // Sizing to the un-exploded circle put a wedge of `Donut plot.pzt` below the
  // bottom edge, where the part that was pulled out to be noticed was the part
  // that got cut off.
  const explode = Math.max(0, ...wedges.wedges.map((w) => w.explode))
  const radius = (Math.min(width, height) / 2 - 40) / (1 + explode)
  const hole = radius * wedges.holeRadius

  const out: El[] = []
  for (const w of wedges.wedges) {
    if (w.end - w.start <= 0) continue
    const mid = ((w.start + w.end) / 2) * 2 * Math.PI - Math.PI / 2
    const ox = Math.cos(mid) * radius * w.explode
    const oy = Math.sin(mid) * radius * w.explode
    out.push(
      el('path', {
        class: 'pbchart-wedge',
        d: wedgePath(cx + ox, cy + oy, radius, hole, w.start, w.end),
        fill: colour(spec.series[w.series]?.colorIndex ?? w.series),
        stroke: '#ffffff',
        'stroke-width': 1,
      }),
    )
  }
  out.push(
    ...legendOf(
      spec,
      { left: 16, right: 16, top: 16, bottom: 0, width, height },
      colour,
      width,
      height,
    ),
  )
  return out
}

/** A full turn cannot be drawn as an arc, so a lone slice becomes a circle. */
function wedgePath(
  cx: number,
  cy: number,
  r: number,
  hole: number,
  start: number,
  end: number,
): string {
  if (end - start >= 1) {
    const outer = `M${round(cx - r)},${round(cy)} a${round(r)},${round(r)} 0 1,0 ${round(2 * r)},0 a${round(r)},${round(r)} 0 1,0 ${round(-2 * r)},0`
    if (hole <= 0) return outer
    return `${outer} M${round(cx - hole)},${round(cy)} a${round(hole)},${round(hole)} 0 1,1 ${round(2 * hole)},0 a${round(hole)},${round(hole)} 0 1,1 ${round(-2 * hole)},0`
  }
  const a0 = start * 2 * Math.PI - Math.PI / 2
  const a1 = end * 2 * Math.PI - Math.PI / 2
  const large = end - start > 0.5 ? 1 : 0
  const p = (radius: number, angle: number): string =>
    `${round(cx + Math.cos(angle) * radius)},${round(cy + Math.sin(angle) * radius)}`
  if (hole <= 0) {
    return `M${round(cx)},${round(cy)} L${p(r, a0)} A${round(r)},${round(r)} 0 ${large},1 ${p(r, a1)} Z`
  }
  return `M${p(hole, a0)} L${p(r, a0)} A${round(r)},${round(r)} 0 ${large},1 ${p(r, a1)} L${p(hole, a1)} A${round(hole)},${round(hole)} 0 ${large},0 ${p(hole, a0)} Z`
}

function heatmap(spec: ChartSpec, width: number, height: number): El[] {
  const mark = spec.marks.find((m) => m.kind === 'heatmap')
  if (mark === undefined || mark.kind !== 'heatmap') return []
  // A heat map labels its rows down the left edge, the same problem the
  // category axis solves, so it borrows the same layout.
  const labels = planLabels({ ...spec, horizontal: true }, Math.max(height - 60, 1))
  const f = frameFor({ ...spec, horizontal: true }, width, height, labels)
  const cw = mark.columns === 0 ? 0 : f.width / mark.columns
  const ch = mark.rows === 0 ? 0 : f.height / mark.rows

  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const c of mark.cells) {
    if (c.value === undefined) continue
    lo = Math.min(lo, c.value)
    hi = Math.max(hi, c.value)
  }

  const out: El[] = []
  for (const c of mark.cells) {
    out.push(
      el('rect', {
        class: 'pbchart-cell',
        x: f.left + c.column * cw,
        y: f.top + c.row * ch,
        width: Math.max(cw, 0),
        height: Math.max(ch, 0),
        fill: c.value === undefined ? '#00000000' : ramp((c.value - lo) / (hi - lo || 1)),
      }),
    )
  }
  mark.rowLabels.forEach((label, i) => {
    if (ch < 8) return
    out.push(
      el(
        'text',
        {
          class: 'pbchart-tick',
          x: f.left - 6,
          y: f.top + i * ch + ch / 2,
          'text-anchor': 'end',
          dy: '0.32em',
        },
        [label],
      ),
    )
  })
  return out
}

/** Grayscale, which is the one colour scheme whose stops need no guessing. */
function ramp(t: number): string {
  const v = Math.round(255 * (1 - Math.max(0, Math.min(1, t))))
  const h = v.toString(16).padStart(2, '0')
  return `#${h}${h}${h}`
}

/** Room kept for the "and N more" tag when the key does not fit. */
const MORE_TAG = 84

/**
 * The key, on one line along the bottom.
 *
 * **Bounded by the page.** Entries were placed left to right with nothing
 * stopping them, so a chart with many series simply ran off the right edge: the
 * distance matrix in `Gene Expression` put a swatch at x=694 on a 680-wide page,
 * where it cannot be seen and cannot be scrolled to. A before-after plot makes
 * it worse, since its key names every row rather than every column.
 *
 * What does not fit is counted rather than dropped in silence. A key that shows
 * four of fifteen colours without saying so is worse than no key, because the
 * reader has no way to know the other eleven exist.
 */
function legendOf(
  spec: ChartSpec,
  f: Frame,
  colour: (i: number) => string,
  width: number,
  height: number,
): El[] {
  if (spec.series.length < 2) return []

  const widthOf = (label: string) => 24 + Math.max(label.length * CHAR_WIDTH, 20)
  const limit = width - f.right
  const total = spec.series.reduce((a, s) => a + widthOf(s.label), f.left)

  // How many fit. When they all do there is no tag, so nothing is reserved.
  let shown = spec.series.length
  if (total > limit) {
    const room = limit - MORE_TAG
    let used = f.left
    shown = 0
    for (const s of spec.series) {
      const w = widthOf(s.label)
      if (used + w > room) break
      used += w
      shown++
    }
  }

  const out: El[] = []
  let x = f.left
  const y = height - 12
  for (const s of spec.series.slice(0, shown)) {
    out.push(
      el('rect', {
        class: 'pbchart-swatch',
        x,
        y: y - 8,
        width: 10,
        height: 10,
        fill: colour(s.colorIndex),
      }),
    )
    out.push(el('text', { class: 'pbchart-legend', x: x + 14, y, dy: '-0.05em' }, [s.label]))
    x += widthOf(s.label)
  }
  if (shown < spec.series.length) {
    out.push(
      el('text', { class: 'pbchart-legend', x, y, dy: '-0.05em' }, [
        `and ${spec.series.length - shown} more`,
      ]),
    )
  }
  return out
}

function path(points: readonly [number, number][], step: boolean): string {
  let d = ''
  points.forEach(([x, y], i) => {
    if (i === 0) {
      d += `M${round(x)},${round(y)}`
      return
    }
    const prev = points[i - 1] as [number, number]
    // A survival curve holds its value until the next event, so the vertical
    // drop happens at the event time rather than being sloped into.
    if (step) d += `L${round(x)},${round(prev[1])}`
    d += `L${round(x)},${round(y)}`
  })
  return d
}

function finite(p: readonly [number, number]): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1])
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}

export { formatNumber }
