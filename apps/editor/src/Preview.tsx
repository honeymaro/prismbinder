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
 * original graph decided. Offsets are drawn as error bars only where the
 * storage layout is one we have verified.
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

interface Series {
  readonly label: string
  readonly points: readonly Point[]
}

export function Preview({ table, title }: { table: TableView; title: string }) {
  const { series, xLabel, usedRowIndex } = useMemo(() => build(table), [table])

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
              <path className="preview__line" d={path(s.points) ?? undefined} stroke={color} />
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
          This table has no X column, so the row number is used for the horizontal axis.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Turns a table into plottable series.
 *
 * The X column is used when the table has one; otherwise the row number, which
 * is what a column table means. Extra subcolumns become error bars only for the
 * three layouts whose meaning is verified - `y_sd`, `y_plus_minus` and
 * `y_high_low`, all of which store offsets rather than absolute bounds. For
 * anything else the extra subcolumns are ignored rather than guessed at.
 */
function build(table: TableView): {
  series: Series[]
  xLabel: string
  usedRowIndex: boolean
} {
  const xColumn = table.columns.find((c) => c.role === 'x')
  const yColumns = table.columns.filter((c) => c.role === 'y')
  const usedRowIndex = xColumn === undefined

  const errorBars =
    table.dataFormat === 'y_sd' ||
    table.dataFormat === 'y_plus_minus' ||
    table.dataFormat === 'y_high_low'

  const series: Series[] = []
  for (const col of yColumns) {
    const values = col.subcolumns[0] ?? []
    const points: Point[] = []
    for (let r = 0; r < values.length; r++) {
      const yv = num(values[r])
      if (yv === undefined) continue
      const xv = usedRowIndex ? r + 1 : num(xColumn?.subcolumns[0]?.[r])
      if (xv === undefined) continue

      let up: number | undefined
      let down: number | undefined
      if (errorBars) {
        const a = num(col.subcolumns[1]?.[r])
        const b = num(col.subcolumns[2]?.[r])
        // y_sd is symmetric; the other two store independent up/down offsets.
        up = a
        down = table.dataFormat === 'y_sd' ? a : b
      }
      points.push({ x: xv, y: yv, up, down })
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
