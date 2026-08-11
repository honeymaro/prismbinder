import type { TableView } from '@prismbinder/model'
import { scaleLinear } from 'd3-scale'
import { line as d3line } from 'd3-shape'
import { useMemo } from 'react'

/**
 * A plot of the data, drawn by us.
 *
 * This is emphatically **not** the graph Prism would draw. Prism's graph
 * geometry - axes, symbols, fits, annotations, every styling decision - lives
 * in a legacy binary blob we deliberately do not decode, so nothing here is
 * recovered from the file. This reads the numbers in the data table and plots
 * them, in the same sense that pasting the table into any plotting tool would.
 *
 * It exists because the alternative for someone without Prism is reading a
 * column of numbers, and a rough shape answers most questions ("did the assay
 * work?") that a person opening a file actually has. It is labelled as
 * reconstructed everywhere it appears, because a plot that looked authoritative
 * while quietly differing from the real figure would be worse than no plot.
 *
 * What it does not do: fitted curves, error bars derived from a model, log
 * axes chosen by Prism, or anything else that would require knowing what the
 * original graph decided. Error bars are drawn only where the storage layout
 * is one we have verified, and are read from `storage` rather than from the
 * layout's name - `y_high_low` covers both a value with two offsets and a
 * value with the absolute limits that bracket it, and drawing one as the other
 * turns a bar of [70, 110] into [30, 210].
 *
 * A connecting line is drawn only when the table has a real X column. Most
 * tables do not: in a column, grouped or multiple-variables table each row is
 * a separate observation or case, and joining them in row order draws a trend
 * that does not exist. Those get points and nothing else.
 */

const W = 680
const H = 320
const PAD = { top: 16, right: 16, bottom: 36, left: 56 }

const SERIES_COLORS = [
  '#3b6fd4',
  '#d4663b',
  '#3ba05f',
  '#a03b8f',
  '#c9a227',
  '#3ba0a0',
  '#8f5fd4',
  '#d43b6f',
]

interface Point {
  readonly x: number
  readonly y: number
  /** Half-length of the error bar, when the layout defines one. */
  readonly up: number | undefined
  readonly down: number | undefined
}

export interface Series {
  readonly label: string
  readonly points: readonly Point[]
}

export function Preview({ table, title }: { table: TableView; title: string }) {
  const { series, xLabel, usedRowIndex, spread } = useMemo(() => build(table), [table])
  // Joining points in row order asserts that the rows are a sequence. In a
  // column, grouped or multiple-variables table they are separate observations
  // and the assertion is false, so those get points and no line.
  const connect = !usedRowIndex

  if (series.length === 0) {
    return (
      <div className="preview preview--empty">
        <p className="muted">
          Nothing numeric to plot on this sheet. Text tables and tables whose subcolumn layout we
          have not verified are shown as data only.
        </p>
      </div>
    )
  }

  const xs = series.flatMap((s) => s.points.map((p) => p.x))
  const ys = series.flatMap((s) =>
    s.points.flatMap((p) => [p.y - (p.down ?? 0), p.y + (p.up ?? 0)]),
  )

  const x = scaleLinear()
    .domain(niceDomain(xs))
    .range([PAD.left, W - PAD.right])
  const y = scaleLinear()
    .domain(niceDomain(ys))
    .range([H - PAD.bottom, PAD.top])

  const path = d3line<Point>()
    .x((p) => x(p.x))
    .y((p) => y(p.y))

  return (
    <div className="preview">
      <div className="preview__head">
        <span className="badge badge--warn" title="Drawn from the data, not from Prism's graph">
          reconstructed
        </span>
        <span className="muted small">
          Plotted from the table by prismbinder. This is not Prism's graph - that geometry is a
          binary blob we carry but do not decode.
        </span>
      </div>

      <svg
        className="preview__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Reconstructed plot of ${title}: ${series.length} series`}
      >
        <title>{`Reconstructed plot of ${title}`}</title>

        {y.ticks(6).map((t) => (
          <g key={`y${t}`}>
            <line className="preview__grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="preview__tick" x={PAD.left - 8} y={y(t)} textAnchor="end" dy="0.32em">
              {format(t)}
            </text>
          </g>
        ))}
        {x.ticks(7).map((t) => (
          <text
            key={`x${t}`}
            className="preview__tick"
            x={x(t)}
            y={H - PAD.bottom + 18}
            textAnchor="middle"
          >
            {format(t)}
          </text>
        ))}

        <line
          className="preview__axis"
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
        />
        <line
          className="preview__axis"
          x1={PAD.left}
          x2={PAD.left}
          y1={PAD.top}
          y2={H - PAD.bottom}
        />

        <text className="preview__label" x={(W + PAD.left) / 2} y={H - 4} textAnchor="middle">
          {xLabel}
        </text>

        {series.map((s, i) => {
          const color = SERIES_COLORS[i % SERIES_COLORS.length]
          return (
            <g key={s.label}>
              {connect ? (
                <path className="preview__line" d={path(s.points) ?? undefined} stroke={color} />
              ) : null}
              {s.points.map((p, pi) =>
                p.up === undefined && p.down === undefined ? null : (
                  <line
                    key={`e${pi}`}
                    className="preview__err"
                    stroke={color}
                    x1={x(p.x)}
                    x2={x(p.x)}
                    y1={y(p.y + (p.up ?? 0))}
                    y2={y(p.y - (p.down ?? 0))}
                  />
                ),
              )}
              {s.points.map((p, pi) => (
                <circle key={`p${pi}`} cx={x(p.x)} cy={y(p.y)} r={3} fill={color} />
              ))}
            </g>
          )
        })}
      </svg>

      <ul className="preview__legend">
        {series.map((s, i) => (
          <li key={s.label}>
            <span
              className="preview__swatch"
              style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
            />
            {s.label}
          </li>
        ))}
      </ul>

      {usedRowIndex ? (
        <p className="muted small">
          This table has no X column, so the row number is used for the horizontal axis. The points
          are not joined: the rows are separate observations, not a sequence.
        </p>
      ) : null}
      {spread === 'replicates' ? (
        <p className="muted small">
          Every replicate is drawn, so a row with subcolumns contributes several points at the same
          horizontal position.
        </p>
      ) : null}
      {spread === 'bounds' ? (
        <p className="muted small">
          The bars run between the limits the file stores, which for this layout are absolute values
          rather than distances from the point.
        </p>
      ) : null}
    </div>
  )
}

/**
 * What the subcolumns after the first one hold, for plotting purposes.
 *
 * Keyed on `storage`, which is the field that knows. The layout's *name* does
 * not: `y_high_low` is what both a two-offset layout and an absolute-limits
 * layout are called once they reach the bundle vocabulary.
 */
export type Spread = 'replicates' | 'symmetric' | 'offsets' | 'bounds' | 'none'

export function spreadOf(table: TableView): Spread {
  // Repeated measurements, not a summary. Every subcolumn is a real datum.
  if (table.dataFormat === 'y_replicates' || table.dataFormat === 'text_replicates') {
    return 'replicates'
  }
  switch (table.storage) {
    case 'offsets':
      return 'offsets'
    case 'bounds':
      return 'bounds'
    // `y_cv` and `y_cv_n` label the column %CV, but every dataset inside such
    // a table declares its own format as `y_sd`: the stored number is an SD,
    // and a symmetric bar is what it describes.
    case 'derived':
      return 'symmetric'
    case 'direct':
      return table.dataFormat === 'y_sd' ||
        table.dataFormat === 'y_se' ||
        table.dataFormat === 'y_sd_n' ||
        table.dataFormat === 'y_se_n'
        ? 'symmetric'
        : 'none'
    default:
      return 'none'
  }
}

/**
 * Turns a table into plottable series.
 *
 * The X column is used when the table has one; otherwise the row number, which
 * is all a column table offers. Replicates are plotted individually rather than
 * summarised: showing only the first of three and saying nothing is the one
 * option that misrepresents the data while looking complete.
 */
export function build(table: TableView): {
  series: Series[]
  xLabel: string
  usedRowIndex: boolean
  spread: Spread
} {
  const xColumn = table.columns.find((c) => c.role === 'x')
  const yColumns = table.columns.filter((c) => c.role === 'y')
  const usedRowIndex = xColumn === undefined
  const spread = spreadOf(table)

  const series: Series[] = []
  for (const col of yColumns) {
    const values = col.subcolumns[0] ?? []
    const points: Point[] = []
    for (let r = 0; r < values.length; r++) {
      const xv = usedRowIndex ? r + 1 : num(xColumn?.subcolumns[0]?.[r])
      if (xv === undefined) continue

      if (spread === 'replicates') {
        for (const sub of col.subcolumns) {
          const v = num(sub[r])
          if (v !== undefined) points.push({ x: xv, y: v, up: undefined, down: undefined })
        }
        continue
      }

      const yv = num(values[r])
      if (yv === undefined) continue
      points.push({ x: xv, y: yv, ...bar(spread, col.subcolumns, r, yv) })
    }
    if (points.length > 0) {
      points.sort((p, q) => p.x - q.x)
      series.push({ label: col.title === '' ? 'untitled' : col.title, points })
    }
  }

  return {
    series,
    xLabel: usedRowIndex ? 'Row' : (xColumn?.title ?? 'X'),
    usedRowIndex,
    spread,
  }
}

/** Half-lengths above and below the point, whatever form the file stores. */
function bar(
  spread: Spread,
  subcolumns: readonly (readonly string[])[],
  row: number,
  value: number,
): { up: number | undefined; down: number | undefined } {
  const a = num(subcolumns[1]?.[row])
  const b = num(subcolumns[2]?.[row])
  switch (spread) {
    case 'symmetric':
      // `*_n` layouts put the count in the third subcolumn; it is not a bound.
      return { up: a, down: a }
    case 'offsets':
      return { up: a, down: b }
    case 'bounds': {
      // Absolute limits, upper then lower. Converted to half-lengths here, and
      // dropped rather than mirrored if they do not actually bracket the value.
      if (a === undefined || b === undefined) return { up: undefined, down: undefined }
      if (a < value || b > value) return { up: undefined, down: undefined }
      return { up: a - value, down: value - b }
    }
    default:
      return { up: undefined, down: undefined }
  }
}

function num(text: string | undefined): number | undefined {
  if (text === undefined || text === '') return undefined
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}

/** A flat series would otherwise collapse to a zero-height domain. */
function niceDomain(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 1]
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (lo === hi) {
    const pad = Math.abs(lo) || 1
    lo -= pad
    hi += pad
  }
  return [lo, hi]
}

function format(v: number): string {
  const a = Math.abs(v)
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(1)
  return String(Math.round(v * 1e6) / 1e6)
}
