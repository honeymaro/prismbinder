import { type MvContext, planGraphSheet, planMvGraph } from '@prismbinder/charts'
import type { GraphSheetView, Sheet } from '@prismbinder/model'
import { useMemo, useState } from 'react'
import { ChartFigure } from './ChartFigure.js'
import { DataGrid, type GridColumn } from './DataGrid.js'
import type { EditMap } from './document.js'
import { Preview } from './Preview.js'
import { ResultsView } from './ResultsView.js'

export interface SheetViewProps {
  readonly sheet: Sheet
  readonly edits: EditMap
  /** Absent when the container cannot be written back (XML documents, for now). */
  readonly onEdit: ((key: string, value: string) => void) | undefined
  /** Lets a Multiple Variables graph resolve the data and results it points at. */
  readonly mv: MvContext
}

export function SheetView({ sheet, edits, onEdit, mv }: SheetViewProps) {
  switch (sheet.kind) {
    case 'data':
      return <DataSheet sheet={sheet} edits={edits} onEdit={onEdit} />
    case 'analysis':
      return (
        <div className="panel">
          <h2>{sheet.title}</h2>
          <dl className="kv">
            <div className="kv__row">
              <dt>Analysis</dt>
              <dd>{sheet.analysisClass ?? 'unknown'}</dd>
            </div>
            <div className="kv__row">
              <dt>Stored results</dt>
              <dd>{sheet.hasResults ? 'yes' : 'no'}</dd>
            </div>
          </dl>
          {sheet.results === undefined ? (
            <p className="muted">
              This analysis has no stored results in the file. prismbinder does not recompute
              statistics.
            </p>
          ) : (
            <>
              <p className="muted small">
                Read from the file as Prism computed them, at the precision it stored. The rendered
                result sheet shows the same numbers rounded for display. Nothing here is
                recalculated.
              </p>
              {/* Keyed, like the grid below: without it React keeps the same
                  Node instances across a sheet change and a group collapsed on
                  one analysis renders collapsed on the next. */}
              <ResultsView node={sheet.results} key={sheet.id} />
            </>
          )}
        </div>
      )
    case 'graph':
      return <GraphSheet sheet={sheet} mv={mv} />
    case 'info':
      return (
        <div className="panel">
          <h2>{sheet.title}</h2>
          {sheet.constants.length === 0 ? (
            <p className="muted">No constants recorded.</p>
          ) : (
            <dl className="kv">
              {sheet.constants.map((c) => (
                <div key={c.name} className="kv__row">
                  <dt>{c.name}</dt>
                  <dd>{c.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )
  }
}

/**
 * A graph sheet, which is one of two very different things.
 *
 * A Multiple Variables graph states its own appearance in JSON - its figures,
 * axis limits, colour scheme, and a link into the analysis result holding a
 * dendrogram's branches - so it is drawn, and drawn without the reconstructed
 * badge, because it is not a reconstruction.
 *
 * Every other family keeps its appearance in the legacy binary. That blob is
 * not decoded, but it is framed, and three of its facts are legible: the
 * datasets plotted, the range and scale of each axis, and the kind of graph.
 * Those are drawn, badged as a reconstruction, because the marks are still
 * ours. Only a graph that names no data it can find is left as a placeholder.
 */
function GraphSheet({ sheet, mv }: { sheet: GraphSheetView; mv: MvContext }) {
  const spec = useMemo(() => planMvGraph(sheet, mv), [sheet, mv])

  if (spec !== undefined && spec.marks.length > 0) {
    return (
      <div className="panel">
        <h2>{sheet.title}</h2>
        <div className="preview">
          <div className="preview__head">
            <span className="badge" title="Read from the graph sheet, which states its appearance">
              from the file
            </span>
            <span className="muted small">
              A Multiple Variables graph records what it draws, so this one is read rather than
              reconstructed.
            </span>
          </div>
          <ChartFigure spec={spec} />
          {spec.notes.map((note) => (
            <p className="muted small" key={note}>
              {note}
            </p>
          ))}
        </div>
      </div>
    )
  }

  // The legacy binary does not describe its own appearance, but it does say
  // which datasets are plotted, the range and scale of each axis, and what kind
  // of graph it is. That is enough to draw, and a great deal more use than a
  // paragraph explaining that it is not being drawn.
  const rebuilt = useMemo(() => planGraphSheet(sheet, mv), [sheet, mv])
  if (rebuilt !== undefined) {
    // Only what the file actually states. Four graph sheets in the corpus reach
    // here with neither axes nor a kind - Multiple Variables figures this
    // project cannot draw, resolved through their data sheet - and telling a
    // reader those axes were Prism's would be untrue of exactly the sheets
    // where nothing was read.
    const stated = [
      sheet.axes === undefined ? undefined : 'the axis range and scale',
      sheet.graphType === undefined ? undefined : 'the kind of graph',
    ].filter((s): s is string => s !== undefined)
    return (
      <div className="panel">
        <h2>{sheet.title}</h2>
        <div className="preview">
          <div className="preview__head">
            <span className="badge badge--warn" title="Drawn from the data, not from Prism's graph">
              reconstructed
            </span>
            <span className="muted small">
              {stated.length === 0
                ? 'Drawn from the data this graph names. Nothing about its appearance was read: that lives in a binary this project does not decode, and everything you see here is ours.'
                : `${stated.join(' and ')} ${stated.length > 1 ? 'are' : 'is'} the one${stated.length > 1 ? 's' : ''} Prism recorded. The symbols, colours and spacing are ours, and the rest of the graph's geometry is a binary this project does not decode.`}
            </span>
          </div>
          <ChartFigure spec={rebuilt} />
          {rebuilt.notes.map((note) => (
            <p className="muted small" key={note}>
              {note}
            </p>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <h2>{sheet.title}</h2>
      {sheet.opaque ? (
        <div className="placeholder">
          <strong>Not rendered.</strong>
          <p>
            This graph's geometry lives in Prism's legacy binary format, which prismbinder carries
            through untouched. Enough of it is legible to draw a chart wherever the graph names the
            data it plots, but this one does not, or its table is not in the document.
          </p>
          <p className="muted">
            The underlying data is available on its data sheet, where "Plot the data" draws it.
          </p>
        </div>
      ) : (
        <div className="placeholder">
          <strong>Not drawn.</strong>
          <p>{spec?.notes[0] ?? 'This graph has no stored geometry.'}</p>
          <p className="muted">The underlying data is available on its data sheet.</p>
        </div>
      )}
    </div>
  )
}

function DataSheet({
  sheet,
  edits,
  onEdit,
}: {
  sheet: Extract<Sheet, { kind: 'data' }>
  edits: EditMap
  onEdit: ((key: string, value: string) => void) | undefined
}) {
  const [showPlot, setShowPlot] = useState(false)
  const t = sheet.table

  // A dataset with several subcolumns (replicates, SD, offsets) occupies
  // several grid columns, so flatten before rendering. `csvIndex` is the real
  // column in data.csv, which is what an edit has to name.
  const flat: GridColumn[] = []
  let csvIndex = 0
  let dataColumn = 0
  for (const c of t.columns) {
    // Counted over data columns only, so the placeholder matches what a person
    // would call the third column rather than the third entry in the layout.
    const nth = c.role === 'y' ? ++dataColumn : 0
    c.subcolumns.forEach((cells, i) => {
      flat.push({
        key: `${c.id}-${i}`,
        // The file's own title, or nothing. It used to read `Column 1`,
        // `Column 2`, `Column 3` for columns the document never named, which
        // then travelled into chart legends and exports as though the file had
        // said it. The placeholder below is shown greyed instead.
        label: i === 0 ? c.title : '',
        placeholder: i === 0 && nth > 0 ? `Column ${nth}` : '',
        sub: c.subcolumns.length > 1 ? subLabel(t.dataFormat, i) : '',
        cells,
        csvIndex: csvIndex++,
      })
    })
  }

  return (
    <div className="panel">
      <h2>{sheet.title}</h2>
      <div className="sheethead">
        <div className="muted small">
          {t.rowCount} rows | {flat.length} columns | {t.tableFormat}/{t.dataFormat}
          {onEdit === undefined ? ' | read-only' : ''}
        </div>
        <button
          type="button"
          className="linky"
          aria-expanded={showPlot}
          onClick={() => setShowPlot(!showPlot)}
        >
          {showPlot ? 'Hide plot' : 'Plot the data'}
        </button>
      </div>

      {showPlot ? (
        <Preview
          // Keyed, like the grid and the results view. Without it React reuses
          // the instance across a sheet change and the chart kind, orientation
          // and whisker rule seeded from one sheet's graph carry to the next.
          key={sheet.id}
          table={t}
          title={sheet.title}
          producedBy={sheet.producedBy}
          graphAxes={sheet.graphAxes}
          graphType={sheet.graphType}
        />
      ) : null}

      {t.storage === 'offsets' ? (
        <div className="warnbox">
          The extra subcolumns here hold <strong>offsets</strong>, not the values Prism displays.
          Prism adds them to the first subcolumn when drawing.
        </div>
      ) : null}
      {t.storage === 'unknown' ? (
        <div className="warnbox">
          This subcolumn layout does not appear in any file we have been able to examine, so what
          the extra columns mean is unverified. They are shown exactly as stored.
        </div>
      ) : null}

      <DataGrid
        sheetId={sheet.id}
        table={t}
        columns={flat}
        edits={edits}
        onEdit={onEdit}
        key={sheet.id}
      />
    </div>
  )
}

/** Names the extra subcolumns, but only for layouts we have actually verified. */
function subLabel(dataFormat: string, index: number): string {
  if (index === 0) return 'value'
  switch (dataFormat) {
    case 'y_sd':
      return 'SD'
    case 'y_high_low':
      return index === 1 ? 'up offset' : 'down offset'
    case 'y_plus_minus':
      return index === 1 ? '+ offset' : '- offset'
    case 'y_replicates':
      return `rep ${index + 1}`
    default:
      return `sub ${index + 1}`
  }
}
