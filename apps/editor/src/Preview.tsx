import {
  allowedKinds,
  type ChartKind,
  defaultKind,
  type Provenance,
  planChart,
  WHISKER_RULES,
  type WhiskerRule,
} from '@prismbinder/charts'
import type { TableView } from '@prismbinder/model'
import { useMemo, useState } from 'react'
import { ChartFigure } from './ChartFigure.js'

/**
 * A plot of the data, drawn by us.
 *
 * All of the arithmetic lives in `@prismbinder/charts`, which knows nothing
 * about React and is tested without a browser. What is left here is the part
 * that genuinely belongs to a user interface: which chart to offer, and saying
 * plainly what the picture is.
 *
 * It is not the graph Prism would draw. That geometry is a legacy binary this
 * project carries and deliberately does not decode, so nothing here is
 * recovered from the file - these are the numbers in the table, plotted the way
 * that kind of table should be plotted. A picture is the form in which someone
 * is most likely to assume otherwise, so the badge is not decoration.
 */

const KIND_LABELS: Record<ChartKind, string> = {
  xy: 'Points and line',
  meanError: 'Mean with error bars',
  scatter: 'Scatter',
  alignedDot: 'Aligned dots',
  bar: 'Bars',
  stackedBar: 'Stacked bars',
  groupedBar: 'Grouped bars',
  box: 'Box and whiskers',
  violin: 'Violin',
  floatingBar: 'Floating bars (min to max)',
  beforeAfter: 'Before and after',
  symbolAtMean: 'Symbol at mean',
  pie: 'Pie',
  donut: 'Donut',
  survival: 'Survival curve',
  heatmap: 'Heat map',
  dendrogram: 'Dendrogram',
  bubble: 'Bubble',
  empty: 'Nothing to plot',
}

const WHISKER_LABELS: Record<WhiskerRule, string> = {
  minMax: 'Min to max',
  tukey: 'Tukey',
  p10_90: '10-90 percentile',
  p5_95: '5-95 percentile',
  p2_5_97_5: '2.5-97.5 percentile',
  p1_99: '1-99 percentile',
  minMaxAllPoints: 'Min to max, all points',
}

export function Preview({
  table,
  title,
  producedBy,
}: {
  table: TableView
  title: string
  /** The analysis that wrote this sheet, which decides what its numbers are. */
  producedBy: Provenance | undefined
}) {
  // `producedBy` matters here, not only in `planChart`. A results view's own
  // layout cannot say that its numbers are a survival curve, so without it the
  // staircase was missing from the menu and the sheet defaulted to a scatter.
  const kinds = useMemo(() => allowedKinds(table, producedBy), [table, producedBy])
  const [kind, setKind] = useState<ChartKind>(() => defaultKind(table, producedBy))
  const [rule, setRule] = useState<WhiskerRule>('tukey')
  const [logY, setLogY] = useState(false)
  const [horizontal, setHorizontal] = useState(false)

  const chosen = kinds.includes(kind) ? kind : (kinds[0] ?? 'scatter')
  const spec = useMemo(
    () =>
      planChart(table, title, {
        kind: chosen,
        whiskers: rule,
        logY,
        horizontal,
        ...(producedBy === undefined ? {} : { producedBy }),
      }),
    [table, title, chosen, rule, logY, horizontal, producedBy],
  )

  if (spec.marks.length === 0) {
    return (
      <div className="preview preview--empty">
        <p className="muted">
          Nothing numeric to plot on this sheet. Text tables, and tables whose subcolumn layout has
          never been observed, are shown as data only.
        </p>
        {spec.notes.map((n) => (
          <p className="muted small" key={n}>
            {n}
          </p>
        ))}
      </div>
    )
  }

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

      <div className="preview__controls">
        <label>
          Chart
          <select value={chosen} onChange={(e) => setKind(e.target.value as ChartKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        {chosen === 'box' ? (
          <label>
            Whiskers
            <select value={rule} onChange={(e) => setRule(e.target.value as WhiskerRule)}>
              {WHISKER_RULES.map((r) => (
                <option key={r} value={r}>
                  {WHISKER_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {spec.axisY.kind !== 'category' && !isRadial(chosen) ? (
          <label className="preview__toggle">
            <input type="checkbox" checked={logY} onChange={(e) => setLogY(e.target.checked)} />
            Log Y
          </label>
        ) : null}

        {isCategorical(chosen) ? (
          <label className="preview__toggle">
            <input
              type="checkbox"
              checked={horizontal}
              onChange={(e) => setHorizontal(e.target.checked)}
            />
            Horizontal
          </label>
        ) : null}
      </div>

      <ChartFigure spec={spec} />

      {spec.notes.map((note) => (
        <p className="muted small" key={note}>
          {note}
        </p>
      ))}
    </div>
  )
}

function isRadial(kind: ChartKind): boolean {
  return kind === 'pie' || kind === 'donut'
}

function isCategorical(kind: ChartKind): boolean {
  return (
    kind === 'bar' ||
    kind === 'scatter' ||
    kind === 'alignedDot' ||
    kind === 'beforeAfter' ||
    kind === 'stackedBar' ||
    kind === 'groupedBar' ||
    kind === 'box' ||
    kind === 'violin' ||
    kind === 'floatingBar'
  )
}
