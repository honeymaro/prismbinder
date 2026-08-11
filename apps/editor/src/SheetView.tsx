import type { Sheet } from '@prismbinder/model'
import { useState } from 'react'
import { DataGrid, type GridColumn } from './DataGrid.js'
import type { EditMap } from './document.js'
import { Preview } from './Preview.js'
import { ResultsView } from './ResultsView.js'

export interface SheetViewProps {
  readonly sheet: Sheet
  readonly edits: EditMap
  /** Absent when the container cannot be written back (XML documents, for now). */
  readonly onEdit: ((key: string, value: string) => void) | undefined
}

export function SheetView({ sheet, edits, onEdit }: SheetViewProps) {
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
      return (
        <div className="panel">
          <h2>{sheet.title}</h2>
          {sheet.opaque ? (
            <div className="placeholder">
              <strong>Not rendered.</strong>
              <p>
                This graph's geometry lives in Prism's legacy binary format, which prismbinder
                carries through untouched but does not decode. Reproducing it would mean decoding
                hundreds of structure fields, and a graph drawn from a partial understanding would
                be worse than none.
              </p>
              <p className="muted">The underlying data is available on its data sheet.</p>
            </div>
          ) : (
            <p className="muted">This graph has no stored geometry.</p>
          )}
        </div>
      )
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
  for (const c of t.columns) {
    c.subcolumns.forEach((cells, i) => {
      flat.push({
        key: `${c.id}-${i}`,
        label: i === 0 ? c.title : '',
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

      {showPlot ? <Preview table={t} title={sheet.title} /> : null}

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
