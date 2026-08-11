import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, commit, type EditMap, EMPTY_HISTORY, redo, undo } from './history.js'

const A = 'sheet 0 0'
const B = 'sheet 0 1'

/** Applies a single-cell edit the way the app does. */
function type(edits: EditMap, history: typeof EMPTY_HISTORY, key: string, value: string) {
  return commit(edits, history, `edit ${key}`, [{ key, before: edits.get(key), after: value }])
}

describe('undo history', () => {
  it('steps back to the value before the edit', () => {
    let s = type(new Map(), EMPTY_HISTORY, A, '42')
    expect(s.edits.get(A)).toBe('42')

    s = undo(s.edits, s.history)
    // Not "empty string" - no pending edit at all, so the cell falls back to
    // whatever the file holds.
    expect(s.edits.has(A)).toBe(false)

    s = redo(s.edits, s.history)
    expect(s.edits.get(A)).toBe('42')
  })

  it('coalesces consecutive typing in one cell', () => {
    let s = type(new Map(), EMPTY_HISTORY, A, '4')
    s = type(s.edits, s.history, A, '42')
    s = type(s.edits, s.history, A, '425')
    expect(s.history.past).toHaveLength(1)

    s = undo(s.edits, s.history)
    expect(s.edits.has(A)).toBe(false)
  })

  it('does not coalesce across cells', () => {
    let s = type(new Map(), EMPTY_HISTORY, A, '1')
    s = type(s.edits, s.history, B, '2')
    expect(s.history.past).toHaveLength(2)

    s = undo(s.edits, s.history)
    expect(s.edits.get(A)).toBe('1')
    expect(s.edits.has(B)).toBe(false)
  })

  it('keeps a deliberate blanking distinct from no edit', () => {
    let s = type(new Map(), EMPTY_HISTORY, A, '7')
    // A separate command, or clearing the cell would merge into the typing.
    s = commit(s.edits, s.history, 'clear', [{ key: A, before: '7', after: '' }])

    s = undo(s.edits, s.history)
    expect(s.edits.get(A)).toBe('7')
    s = redo(s.edits, s.history)
    expect(s.edits.get(A)).toBe('')
    expect(s.edits.has(A)).toBe(true)
  })

  it('drops the redo branch once you edit again', () => {
    let s = type(new Map(), EMPTY_HISTORY, A, '1')
    s = undo(s.edits, s.history)
    expect(canRedo(s.history)).toBe(true)

    s = type(s.edits, s.history, B, '2')
    expect(canRedo(s.history)).toBe(false)
  })

  it('handles a multi-cell command atomically', () => {
    const changes = [
      { key: A, before: undefined, after: '1' },
      { key: B, before: undefined, after: '2' },
    ]
    let s = commit(new Map(), EMPTY_HISTORY, 'paste 2 cells', changes)
    expect(s.edits.size).toBe(2)

    s = undo(s.edits, s.history)
    expect(s.edits.size).toBe(0)
    expect(canUndo(s.history)).toBe(false)
  })

  it('is a no-op at either end', () => {
    const s = undo(new Map(), EMPTY_HISTORY)
    expect(s.edits.size).toBe(0)
    expect(redo(s.edits, s.history).edits.size).toBe(0)
  })
})
