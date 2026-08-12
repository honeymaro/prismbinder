import type { TableView } from '@prismbinder/model'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useRef } from 'react'
import { cellKey, type EditMap } from './document.js'

/**
 * The data grid.
 *
 * Rows are virtualized; columns are not. That asymmetry is measured rather than
 * assumed: across the documents we can read, tables run to 500,000 rows but the
 * widest is 44 columns and the median is 5. Virtualizing an axis costs absolute
 * positioning, width bookkeeping and a pile of ARIA plumbing, and it is worth
 * paying once for the axis that actually grows.
 *
 * It stays a real `<table>`. Research software gets bought by universities and
 * hospitals under WCAG 2.1 AA, and "the data table cannot be read by a screen
 * reader" is a procurement blocker. A table also gives find-in-page and native
 * copy for free, which a canvas grid spends weeks reimplementing badly.
 *
 * Virtualization and semantics are reconciled with spacer rows rather than
 * transforms, so the DOM stays a table whose rows happen to be a window onto a
 * longer one. `aria-rowcount` carries the real total and each row carries its
 * true `aria-rowindex`, so a screen reader announces "row 240,001 of 500,000"
 * even though only forty rows exist.
 */

/** Must match `--row-h` in styles.css: the virtualizer needs it in advance. */
const ROW_HEIGHT = 27
const OVERSCAN = 12

export interface GridColumn {
  readonly key: string
  readonly label: string
  /**
   * Shown greyed when the file names no column, so the header band stays
   * usable without claiming a title the document does not contain. 97 of the
   * corpus's 513 data columns have none.
   */
  readonly placeholder: string
  readonly sub: string
  readonly cells: readonly string[]
  /** The column in `data.csv`, which is what an edit has to name. */
  readonly csvIndex: number
}

export interface DataGridProps {
  readonly sheetId: string
  readonly table: TableView
  readonly columns: readonly GridColumn[]
  readonly edits: EditMap
  readonly onEdit: ((key: string, value: string) => void) | undefined
}

export function DataGrid({ sheetId, table, columns, edits, onEdit }: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useVirtualizer({
    count: table.rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  })

  const items = rows.getVirtualItems()
  const first = items[0]
  const last = items[items.length - 1]
  const padTop = first?.start ?? 0
  const padBottom = last === undefined ? 0 : rows.getTotalSize() - last.end

  /**
   * Arrow keys move between cells.
   *
   * The target row may not be rendered, so scroll it into view first and let the
   * effect of that render put focus where it belongs - hence the id lookup after
   * a frame rather than a direct `.focus()` on a node that does not exist yet.
   */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
      const target = e.target as HTMLInputElement
      if (target.tagName !== 'INPUT') return
      const r = Number(target.dataset.row)
      const c = Number(target.dataset.col)
      if (Number.isNaN(r) || Number.isNaN(c)) return

      let nr = r
      let nc = c
      switch (e.key) {
        case 'ArrowUp':
          nr = r - 1
          break
        case 'ArrowDown':
        case 'Enter':
          nr = r + 1
          break
        case 'ArrowLeft':
          if (target.selectionStart !== 0) return
          nc = c - 1
          break
        case 'ArrowRight':
          if (target.selectionStart !== target.value.length) return
          nc = c + 1
          break
        default:
          return
      }
      if (nr < 0 || nr >= table.rowCount || nc < 0 || nc >= columns.length) return
      e.preventDefault()

      rows.scrollToIndex(nr, { align: 'auto' })
      requestAnimationFrame(() => {
        document.getElementById(cellId(sheetId, nr, nc))?.focus()
      })
    },
    [rows, sheetId, table.rowCount, columns.length],
  )

  return (
    <div className="tablewrap" ref={scrollRef}>
      <table
        className="grid"
        role="grid"
        aria-rowcount={table.rowCount + 1}
        aria-colcount={columns.length + 1}
        aria-readonly={onEdit === undefined}
      >
        {/* Fixed widths, or columns resize as the window scrolls past longer values. */}
        <colgroup>
          <col className="col-rownum" />
          {columns.map((c) => (
            <col key={c.key} />
          ))}
        </colgroup>
        <thead>
          <tr aria-rowindex={1}>
            <th className="rownum" aria-colindex={1} scope="col" />
            {columns.map((c, i) => (
              <th key={c.key} aria-colindex={i + 2} scope="col">
                <div className={c.label === '' ? 'grid__title grid__title--none' : 'grid__title'}>
                  {c.label === '' ? c.placeholder : c.label}
                </div>
                {c.sub !== '' ? <div className="grid__sub">{c.sub}</div> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody onKeyDown={onKeyDown}>
          {padTop > 0 ? (
            <tr aria-hidden="true" className="spacer" style={{ height: padTop }}>
              <td colSpan={columns.length + 1} />
            </tr>
          ) : null}

          {items.map((v) => (
            <tr key={v.key} aria-rowindex={v.index + 2} style={{ height: ROW_HEIGHT }}>
              <td className="rownum" aria-colindex={1}>
                {v.index + 1}
              </td>
              {columns.map((c, i) => {
                const key = cellKey(sheetId, v.index, c.csvIndex)
                const edited = edits.get(key)
                const value = edited ?? c.cells[v.index] ?? ''
                return (
                  <td
                    key={c.key}
                    aria-colindex={i + 2}
                    className={`${isNumeric(value) ? 'num' : ''}${edited !== undefined ? ' edited' : ''}`}
                  >
                    {onEdit === undefined ? (
                      value
                    ) : (
                      <input
                        id={cellId(sheetId, v.index, i)}
                        data-row={v.index}
                        data-col={i}
                        value={value}
                        aria-label={`${c.label || c.placeholder || 'column'} row ${v.index + 1}`}
                        onChange={(e) => onEdit(key, e.target.value)}
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}

          {padBottom > 0 ? (
            <tr aria-hidden="true" className="spacer" style={{ height: padBottom }}>
              <td colSpan={columns.length + 1} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

/** Grid position, not CSV position: focus moves through what is on screen. */
function cellId(sheetId: string, row: number, col: number): string {
  return `c_${sheetId}_${row}_${col}`
}

function isNumeric(text: string | undefined): boolean {
  return text !== undefined && text !== '' && !Number.isNaN(Number(text))
}
