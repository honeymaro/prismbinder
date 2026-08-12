/**
 * What a chart claims, read back out of an SVG.
 *
 * The point of this file is to make "does our chart match Prism's" a question a
 * machine can answer. Comparing pixels cannot: fonts, anti-aliasing, colours
 * and page size all differ and none of those differences are mistakes. What can
 * be compared is structure - how many series, where the axes run, whether the
 * error bars have caps, whether the line steps or slopes - and every defect
 * found by eye so far has been structural:
 *
 *   the connecting line ran through the replicates instead of the means
 *   the survival curve sloped instead of stepping
 *   the error bars had no caps
 *   the axis title sat on top of the tick labels
 *
 * Prism exports SVG (`ExportSVG` in its scripting language), so the same
 * extractor runs over both sides and the comparison is between two feature
 * sets rather than between two images.
 *
 * Deliberately tolerant: it reads any SVG, not only ours. Prism nests and
 * groups differently, uses its own class names or none at all, and draws
 * symbols as paths where we use circles. So the features are counted from
 * geometry - what is a short stroke perpendicular to a long one - rather than
 * from anything either renderer promises to call things.
 */

const TAG = /<(\w+)\b([^>]*?)(\/?)>/g
const ATTR = /([\w:-]+)="([^"]*)"/g

/** Every element in document order, as `{tag, attrs}`. */
export function elements(svg) {
  const out = []
  for (const m of svg.matchAll(TAG)) {
    const attrs = {}
    for (const a of m[2].matchAll(ATTR)) attrs[a[1]] = a[2]
    out.push({ tag: m[1], attrs })
  }
  return out
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Text nodes, which is where axis tick labels live in both renderers. */
export function texts(svg) {
  const out = []
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = {}
    for (const a of m[1].matchAll(ATTR)) attrs[a[1]] = a[2]
    // Prism wraps label text in tspans; take whatever plain text is inside.
    const body = m[2].replace(/<[^>]*>/g, '').trim()
    if (body !== '') out.push({ attrs, text: body })
  }
  return out
}

/**
 * Straight segments, from `<line>` and from the two-point moves in a `<path>`.
 *
 * Both renderers draw error bars, caps and axes as straight strokes, but ours
 * uses `<line>` and Prism uses paths. Normalising them here is what lets one
 * rule ask about "a short stroke crossing a long one" on either side.
 */
export function segments(svg) {
  const out = []
  for (const e of elements(svg)) {
    if (e.tag === 'line') {
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => num(e.attrs[k]))
      if ([x1, y1, x2, y2].every((v) => v !== undefined)) out.push({ x1, y1, x2, y2 })
      continue
    }
    if (e.tag !== 'path' || e.attrs.d === undefined) continue
    let cx
    let cy
    for (const c of e.attrs.d.matchAll(/([MLHVml])\s*(-?[\d.]+)?[ ,]*(-?[\d.]+)?/g)) {
      const op = c[1]
      const a = num(c[2])
      const b = num(c[3])
      if (op === 'M' || op === 'm') {
        cx = a
        cy = b
        continue
      }
      if (cx === undefined || cy === undefined) continue
      const nx = op === 'V' ? cx : (a ?? cx)
      const ny = op === 'H' ? cy : op === 'V' ? (a ?? cy) : (b ?? cy)
      out.push({ x1: cx, y1: cy, x2: nx, y2: ny })
      cx = nx
      cy = ny
    }
  }
  return out
}

/** Shorter than this and a vertical stroke is axis furniture, not a bar. */
const MIN_BAR = 8

const len = (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
const isVertical = (s) => Math.abs(s.x2 - s.x1) < 0.75 && Math.abs(s.y2 - s.y1) > 0.75
const isHorizontal = (s) => Math.abs(s.y2 - s.y1) < 0.75 && Math.abs(s.x2 - s.x1) > 0.75

/**
 * Structural features, comparable across renderers.
 *
 * Nothing here is a pixel measurement. Counts, ratios and the text of the tick
 * labels survive a different page size, a different font and a different
 * colour scheme, which is exactly what has to be true for the comparison to be
 * about the chart rather than about the styling.
 */
export function features(svg) {
  const segs = segments(svg)
  const labels = texts(svg).map((t) => t.text)

  // A cap is a short stroke that crosses the end of a long one at right
  // angles. Counting them this way finds Prism's and ours alike, without
  // either having to label them.
  //
  // The length floor is what separates a bar from the furniture. An axis tick
  // mark is a short vertical stroke too, and at a 3px floor the corner tick of
  // a chart with no error bars at all was reported as capped - which would
  // have hidden exactly the defect this is here to catch.
  const verticals = segs.filter(isVertical)
  const horizontals = segs.filter(isHorizontal)
  const longVertical = verticals.filter((s) => len(s) > MIN_BAR)
  const shortHorizontal = horizontals.filter((s) => len(s) > 1 && len(s) <= 14)

  let cappedEnds = 0
  for (const bar of longVertical) {
    for (const end of [
      [bar.x1, bar.y1],
      [bar.x2, bar.y2],
    ]) {
      const capped = shortHorizontal.some(
        (c) =>
          Math.abs(c.y1 - end[1]) < 1.5 &&
          // Straddling the stroke, not merely touching it end to end.
          Math.min(c.x1, c.x2) < end[0] &&
          Math.max(c.x1, c.x2) > end[0] &&
          Math.abs((c.x1 + c.x2) / 2 - end[0]) < 2,
      )
      if (capped) cappedEnds++
    }
  }

  return {
    /** Anything drawn as a filled dot. Prism uses paths for some symbols. */
    symbols: elements(svg).filter((e) => e.tag === 'circle' || e.tag === 'rect').length,
    polylines: elements(svg).filter(
      (e) => e.tag === 'path' && (e.attrs.d ?? '').split(/[Ll]/).length > 3,
    ).length,
    verticalStrokes: longVertical.length,
    cappedEnds,
    /** Numbers appearing as tick labels, which is where the axis range shows. */
    numericLabels: labels.map(Number).filter((n) => Number.isFinite(n)),
    textLabels: labels.filter((t) => !Number.isFinite(Number(t))),
    /** A stepped line alternates horizontal and vertical moves. */
    steppedPaths: elements(svg).filter((e) => e.tag === 'path' && looksStepped(e.attrs.d)).length,
  }
}

/**
 * Whether a path is drawn as a staircase.
 *
 * A survival curve holds its value between events, so its segments alternate
 * horizontal, vertical, horizontal. A sloped line has neither.
 */
function looksStepped(d) {
  if (d === undefined) return false
  const pts = [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ])
  if (pts.length < 4) return false
  let axisAligned = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0])
    const dy = Math.abs(pts[i][1] - pts[i - 1][1])
    if (dx < 0.75 || dy < 0.75) axisAligned++
  }
  return axisAligned / (pts.length - 1) > 0.9
}

/** The axis range a set of numeric tick labels implies. */
export function axisRange(numericLabels) {
  if (numericLabels.length === 0) return undefined
  return { min: Math.min(...numericLabels), max: Math.max(...numericLabels) }
}

/**
 * Compares two feature sets and reports what differs.
 *
 * Returns a list of findings rather than a pass or fail. Some differences are
 * ours by choice - a colour scheme, a legend position - and a harness that
 * called those failures would be turned off within a week. What it reports is
 * the shape of the disagreement; a human decides which ones are defects, and
 * `docs/charts.md` records the ones already decided.
 */
export function compare(mine, theirs) {
  const out = []
  const say = (what, a, b) => out.push({ what, ours: a, prism: b })

  if (mine.cappedEnds === 0 && theirs.cappedEnds > 0) {
    say('error bar caps', mine.cappedEnds, theirs.cappedEnds)
  }
  if (mine.steppedPaths === 0 && theirs.steppedPaths > 0) {
    say('stepped line', mine.steppedPaths, theirs.steppedPaths)
  }
  if (mine.steppedPaths > 0 && theirs.steppedPaths === 0) {
    say('stepped line we drew and Prism did not', mine.steppedPaths, theirs.steppedPaths)
  }

  const a = axisRange(mine.numericLabels)
  const b = axisRange(theirs.numericLabels)
  if (a !== undefined && b !== undefined) {
    if (a.min !== b.min) say('axis floor', a.min, b.min)
    if (a.max !== b.max) say('axis ceiling', a.max, b.max)
  }

  // Symbol counts differ legitimately when one side summarises and the other
  // does not, which is the single most informative disagreement there is.
  const ratio = theirs.symbols === 0 ? 0 : mine.symbols / theirs.symbols
  if (theirs.symbols > 0 && (ratio > 1.6 || ratio < 0.625)) {
    say('symbols drawn', mine.symbols, theirs.symbols)
  }

  return out
}
