/**
 * Undo/redo for cell edits.
 *
 * A command stack, not a stack of state snapshots. The distinction matters at
 * this scale: the format allows 500,000 rows, and a snapshot-per-keystroke -
 * or an immer patch set, which for an insert near the top of a long column
 * produces one patch per shifted index - turns a routine edit into O(rows) of
 * work and memory. A command stores what changed and what it was before, so it
 * costs the same whether the table has ten rows or half a million.
 *
 * The edit map is the source of truth for what is pending; this module owns
 * only the ability to move backwards and forwards through it. `undefined` in
 * `before`/`after` means "no pending edit for this cell", which is different
 * from an edit whose value happens to be the empty string - the latter is a
 * deliberate blanking that must survive a redo.
 */

export type EditMap = ReadonlyMap<string, string>

export interface CellChange {
  readonly key: string
  readonly before: string | undefined
  readonly after: string | undefined
}

export interface Command {
  /** Shown in the UI, e.g. "edit B4" or "paste 240 cells". */
  readonly label: string
  readonly changes: readonly CellChange[]
}

export interface History {
  readonly past: readonly Command[]
  readonly future: readonly Command[]
}

export const EMPTY_HISTORY: History = { past: [], future: [] }

/**
 * How many commands to keep.
 *
 * Bounded because a long editing session should not grow without limit, and
 * generous because the cost of one command is a handful of strings, not a copy
 * of the document.
 */
const LIMIT = 500

function apply(edits: EditMap, changes: readonly CellChange[], forward: boolean): EditMap {
  const next = new Map(edits)
  for (const c of changes) {
    const value = forward ? c.after : c.before
    if (value === undefined) next.delete(c.key)
    else next.set(c.key, value)
  }
  return next
}

export interface Step {
  readonly edits: EditMap
  readonly history: History
}

/**
 * Records a change and applies it.
 *
 * Consecutive keystrokes in one cell coalesce into a single command, so undo
 * steps back to the value the cell had before you started typing rather than
 * replaying it one character at a time. Coalescing keeps the *original*
 * `before`, which is the whole point.
 */
export function commit(
  edits: EditMap,
  history: History,
  label: string,
  changes: readonly CellChange[],
): Step {
  if (changes.length === 0) return { edits, history }

  // Same label as well as same cell: typing merges into typing, but a distinct
  // operation on that cell - clearing it, pasting over it - stays its own step,
  // because that is a thing the user did on purpose and expects to undo alone.
  const last = history.past[history.past.length - 1]
  const coalesce =
    last !== undefined &&
    last.label === label &&
    last.changes.length === 1 &&
    changes.length === 1 &&
    last.changes[0]?.key === changes[0]?.key &&
    history.future.length === 0

  const merged: Command = coalesce
    ? {
        label,
        changes: [{ ...(changes[0] as CellChange), before: last.changes[0]?.before }],
      }
    : { label, changes }

  const past = coalesce ? history.past.slice(0, -1) : history.past
  return {
    edits: apply(edits, changes, true),
    history: { past: [...past, merged].slice(-LIMIT), future: [] },
  }
}

export function undo(edits: EditMap, history: History): Step {
  const cmd = history.past[history.past.length - 1]
  if (cmd === undefined) return { edits, history }
  return {
    edits: apply(edits, cmd.changes, false),
    history: { past: history.past.slice(0, -1), future: [cmd, ...history.future] },
  }
}

export function redo(edits: EditMap, history: History): Step {
  const cmd = history.future[0]
  if (cmd === undefined) return { edits, history }
  return {
    edits: apply(edits, cmd.changes, true),
    history: { past: [...history.past, cmd], future: history.future.slice(1) },
  }
}

export function canUndo(h: History): boolean {
  return h.past.length > 0
}

export function canRedo(h: History): boolean {
  return h.future.length > 0
}
