import { mvContext } from '@prismbinder/charts'
import type { Diagnostic } from '@prismbinder/core'
import type { Project, Sheet } from '@prismbinder/model'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadBytes, type OpenDocument, saveDocument } from './document.js'
import { canRedo, canUndo, commit, EMPTY_HISTORY, redo, type Step, undo } from './history.js'
import { parseFile } from './parseClient.js'
import * as persist from './persist.js'
import { SheetView } from './SheetView.js'

type Loaded = OpenDocument

const EMPTY_WORK: Step = { edits: new Map(), history: EMPTY_HISTORY }

interface Failed {
  readonly name: string
  readonly diagnostics: readonly Diagnostic[]
}

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<Failed | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  /**
   * The pending edits and the ability to walk them backwards are one value.
   * Kept as two `useState`s they can render out of step, and undo would then
   * restore a value the grid never displayed.
   */
  const [work, setWork] = useState<Step>(EMPTY_WORK)
  const { edits, history } = work
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<persist.Session | null>(null)
  /** Set when a write is refused, so the promise of a safety net is not silent. */
  const [autosaveFailed, setAutosaveFailed] = useState(false)
  /** The bytes of whatever is open, kept so autosave has something to store. */
  const source = useRef<Uint8Array | null>(null)

  /** Which open is current. A parse that finishes after a newer one is stale. */
  const openSeq = useRef(0)

  const openBytes = useCallback(async (name: string, bytes: Uint8Array, restored: Step) => {
    const seq = ++openSeq.current
    const { document: doc, diagnostics } = await parseFile(name, bytes)
    // Two files opened in quick succession finish in whatever order parsing
    // takes, not the order they were asked for. Without this the slower one
    // wins and the user is looking at the document they just replaced.
    if (seq !== openSeq.current) return
    if (doc === undefined) {
      setLoaded(null)
      setFailed({ name, diagnostics })
      return
    }
    source.current = bytes
    setLoaded(doc)
    setWork(restored)
    setSelected(doc.project.sheets[0]?.id ?? null)
  }, [])

  const open = useCallback(
    async (file: File) => {
      setBusy(true)
      setFailed(null)
      // The outgoing document goes away before the incoming one is parsed.
      // Leaving it on screen leaves its grid editable for as long as parsing
      // takes, and every keystroke in that window is discarded when the new
      // document replaces it - no error, no warning, the value simply is not
      // there afterwards. Better a moment of "Reading..." than edits that
      // silently do not count.
      setLoaded(null)
      setSelected(null)
      setWork(EMPTY_WORK)
      setSaveNote(null)
      setRecovery(null)
      source.current = null
      try {
        await openBytes(file.name, new Uint8Array(await file.arrayBuffer()), EMPTY_WORK)
        await persist.clear()
      } finally {
        setBusy(false)
      }
    },
    [openBytes],
  )

  // Offer to pick up where a previous tab left off, once, at startup.
  useEffect(() => {
    let live = true
    void persist.load().then((s) => {
      if (live && s !== undefined && s.edits.size > 0) setRecovery(s)
    })
    return () => {
      live = false
    }
  }, [])

  /**
   * Autosave, debounced.
   *
   * Writing on every keystroke would put a multi-megabyte file system call in
   * the typing path. Two seconds of quiet is short enough that a crash costs a
   * word, and long enough that continuous typing writes nothing.
   *
   * `storedFor` holds *which* buffer has been written, rather than whether
   * anything has. A boolean would have to be reset when a document is replaced,
   * and the one time that is forgotten the symptom is silent: the session's
   * second document writes its edits but not the bytes they belong to, and
   * recovery stops working while still looking like it works. Identity cannot
   * be forgotten - a different document is a different buffer.
   */
  const storedFor = useRef<Uint8Array | null>(null)
  useEffect(() => {
    if (loaded === null || source.current === null) return
    if (edits.size === 0) {
      // Undoing back to a clean document, or discarding, has to reach the
      // saved copy too. Otherwise a crash later offers to restore work the
      // user deliberately reverted, and nothing on screen says it is stale.
      if (storedFor.current !== null) {
        storedFor.current = null
        void persist.clear()
      }
      return
    }
    const bytes = source.current
    const name = loaded.name
    const id = setTimeout(() => {
      const withBytes = storedFor.current !== bytes
      storedFor.current = bytes
      void persist
        .save({ name, bytes, edits, history, savedAt: Date.now() }, withBytes)
        .then((ok) => {
          // A private window, a denied quota, an old browser. The edits are
          // safe in the tab either way, but someone who believes the work is
          // being kept should be told when it is not.
          if (!ok) storedFor.current = null
          setAutosaveFailed(!ok)
        })
    }, 2000)
    return () => clearTimeout(id)
  }, [loaded, edits, history])

  const onEdit = useCallback((key: string, value: string) => {
    setWork((w) =>
      commit(w.edits, w.history, `edit ${key}`, [{ key, before: w.edits.get(key), after: value }]),
    )
    setSaveNote(null)
  }, [])

  const onUndo = useCallback(() => {
    setWork((w) => undo(w.edits, w.history))
    setSaveNote(null)
  }, [])

  const onRedo = useCallback(() => {
    setWork((w) => redo(w.edits, w.history))
    setSaveNote(null)
  }, [])

  // Ctrl+Z / Ctrl+Shift+Z, except while the browser is handling its own undo
  // inside a text field - retyping a character is not a document-level command.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      e.preventDefault()
      if (e.shiftKey) onRedo()
      else onUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onUndo, onRedo])

  const onSave = useCallback(() => {
    if (loaded === null) return
    const result = saveDocument(loaded, edits)
    if (result === undefined) return
    const dot = loaded.name.lastIndexOf('.')
    const stem = dot > 0 ? loaded.name.slice(0, dot) : loaded.name
    const ext = dot > 0 ? loaded.name.slice(dot) : '.prism'
    downloadBytes(`${stem} (edited)${ext}`, result.bytes)
    setSaveNote(
      `Saved. ${result.changedEntries.length} entr${result.changedEntries.length === 1 ? 'y' : 'ies'} rewritten; everything else was copied through unchanged.`,
    )
  }, [loaded, edits])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file !== undefined) void open(file)
    },
    [open],
  )

  const sheet = useMemo(
    () => loaded?.project.sheets.find((s) => s.id === selected) ?? null,
    [loaded, selected],
  )

  // A Multiple Variables graph points at a data sheet and at an analysis
  // result, so it can only be drawn with the whole project in hand. Built once
  // per document rather than per sheet change.
  const mv = useMemo(() => mvContext(loaded?.project ?? EMPTY_PROJECT), [loaded])

  return (
    <div
      className={`app${dragging ? ' app--dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          prismbinder
          <span className="brand__sub">GraphPad Prism files, in your browser</span>
        </div>
        <label className="filebutton">
          Open a file
          <input
            type="file"
            accept=".prism,.prismt,.pzfx,.pzt,.xml"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f !== undefined) void open(f)
            }}
          />
        </label>
      </header>

      {recovery !== null && loaded === null ? (
        <Recovery
          session={recovery}
          onRestore={() => {
            // These bytes came off disk, so there is nothing to write back.
            storedFor.current = recovery.bytes
            void openBytes(recovery.name, recovery.bytes, {
              edits: recovery.edits,
              history: recovery.history,
            })
            setRecovery(null)
          }}
          onDiscard={() => {
            setRecovery(null)
            void persist.clear()
          }}
        />
      ) : null}

      {loaded === null && failed === null ? (
        <Welcome busy={busy} />
      ) : failed !== null ? (
        <Failure failed={failed} />
      ) : loaded !== null ? (
        <main className="layout">
          <nav className="sidebar">
            <FileSummary loaded={loaded} />
            <SaveBar
              canSave={loaded.bundle !== undefined}
              pending={edits.size}
              note={saveNote}
              onSave={onSave}
              onDiscard={() => {
                setWork(EMPTY_WORK)
                setSaveNote(null)
                storedFor.current = null
                void persist.clear()
              }}
              autosaveFailed={autosaveFailed}
              canUndo={canUndo(history)}
              canRedo={canRedo(history)}
              onUndo={onUndo}
              onRedo={onRedo}
            />
            <SheetList sheets={loaded.project.sheets} selected={selected} onSelect={setSelected} />
          </nav>
          <section className="content">
            {sheet !== null ? (
              <SheetView
                sheet={sheet}
                edits={edits}
                onEdit={loaded.bundle !== undefined ? onEdit : undefined}
                mv={mv}
              />
            ) : (
              <p className="muted">No sheet selected.</p>
            )}
          </section>
        </main>
      ) : null}

      <footer className="footer">
        Everything happens in this tab. No file is uploaded anywhere. | Unofficial; not affiliated
        with GraphPad Software.
      </footer>
    </div>
  )
}

function Recovery({
  session,
  onRestore,
  onDiscard,
}: {
  session: persist.Session
  onRestore: () => void
  onDiscard: () => void
}) {
  const when = new Date(session.savedAt).toLocaleString()
  return (
    <div className="recovery">
      <div>
        <strong>{session.name}</strong> was open with {session.edits.size} unsaved cell
        {session.edits.size === 1 ? '' : 's'} as of {when}. It never left this browser.
      </div>
      <div className="savebar__actions">
        <button type="button" className="primary" onClick={onRestore}>
          Restore
        </button>
        <button type="button" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  )
}

function Welcome({ busy }: { busy: boolean }) {
  return (
    <div className="welcome">
      <h1>Drop a Prism file</h1>
      <p className="muted">
        <code>.prism</code> | <code>.prismt</code> | <code>.pzfx</code> | <code>.pzt</code>
      </p>
      {busy ? <p>Reading...</p> : null}
      <div className="capabilities">
        <div>
          <h3>What you get</h3>
          <ul>
            <li>Every data table, with its real column layout</li>
            <li>Which analyses ran, and whether results are stored</li>
            <li>A byte-exact read: nothing is normalised on the way in</li>
          </ul>
        </div>
        <div>
          <h3>What is not shown</h3>
          <ul>
            <li>Graphs - their geometry is a legacy binary we carry but do not decode</li>
            <li>Statistics are never recomputed; stored results are shown as-is</li>
            <li>
              The legacy <code>.pzf</code> format is not read at all
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function SaveBar({
  canSave,
  pending,
  note,
  onSave,
  onDiscard,
  canUndo: undoable,
  canRedo: redoable,
  onUndo,
  onRedo,
  autosaveFailed,
}: {
  canSave: boolean
  pending: number
  note: string | null
  onSave: () => void
  onDiscard: () => void
  autosaveFailed: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}) {
  if (!canSave) {
    return (
      <div className="savebar">
        <span className="muted small">
          XML documents open read-only for now. Bundles (<code>.prism</code>, <code>.prismt</code>)
          can be edited and saved.
        </span>
      </div>
    )
  }
  if (pending === 0 && note === null && !undoable && !redoable) return null

  return (
    <div className={`savebar${pending > 0 ? ' savebar--active' : ''}`}>
      {/* The note stays visible after saving: the edits are still pending
          relative to the file on disk, since we hand back a copy rather than
          overwriting anything. */}
      {note !== null ? <div className="muted small">{note}</div> : null}
      {autosaveFailed && pending > 0 ? (
        <div className="warnbox small">
          This browser will not let us keep a local backup, so unsaved edits will be lost if the tab
          closes. Save a copy when you are done.
        </div>
      ) : null}
      {pending > 0 ? (
        <>
          <div className="small">
            {pending} unsaved cell{pending === 1 ? '' : 's'}
          </div>
          <div className="savebar__actions">
            <button type="button" className="primary" onClick={onSave}>
              Save a copy
            </button>
            <button type="button" onClick={onDiscard}>
              Discard
            </button>
          </div>
        </>
      ) : null}
      {undoable || redoable ? (
        <div className="savebar__actions">
          <button type="button" onClick={onUndo} disabled={!undoable} title="Ctrl+Z">
            Undo
          </button>
          <button type="button" onClick={onRedo} disabled={!redoable} title="Ctrl+Shift+Z">
            Redo
          </button>
        </div>
      ) : null}
    </div>
  )
}

function FileSummary({ loaded }: { loaded: Loaded }) {
  const p = loaded.project
  const errors = loaded.diagnostics.filter((d) => d.severity === 'error')
  const warnings = loaded.diagnostics.filter((d) => d.severity === 'warning')
  return (
    <div className="filesummary">
      <div className="filesummary__name" title={loaded.name}>
        {loaded.name}
      </div>
      <div className="muted small">
        {(loaded.size / 1024).toFixed(1)} KB |{' '}
        {p.source === 'bundle' ? 'ZIP bundle' : 'XML document'}
        {p.formatVersion !== undefined ? ` | format ${p.formatVersion}` : ''}
      </div>
      {p.notes.map((n) => (
        <div className="note" key={n}>
          {n}
        </div>
      ))}
      {errors.length > 0 || warnings.length > 0 ? (
        <details className="diagnostics">
          <summary>
            {errors.length} error{errors.length === 1 ? '' : 's'}, {warnings.length} warning
            {warnings.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {[...errors, ...warnings].slice(0, 40).map((d, i) => (
              <li key={`${d.code}-${d.path}-${i}`}>
                <code>{d.code}</code> {d.path} - {d.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function SheetList({
  sheets,
  selected,
  onSelect,
}: {
  sheets: readonly Sheet[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  const groups: { label: string; kind: Sheet['kind'] }[] = [
    { label: 'Data', kind: 'data' },
    { label: 'Analyses', kind: 'analysis' },
    { label: 'Graphs', kind: 'graph' },
    { label: 'Info', kind: 'info' },
  ]
  return (
    <div className="sheetlist">
      {groups.map(({ label, kind }) => {
        const items = sheets.filter((s) => s.kind === kind)
        if (items.length === 0) return null
        return (
          <div key={kind} className="sheetgroup">
            <h4>
              {label} <span className="muted">{items.length}</span>
            </h4>
            <ul>
              {items.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={s.id === selected ? 'is-selected' : ''}
                    onClick={() => onSelect(s.id)}
                  >
                    <span className="sheetlist__title">{s.title}</span>
                    {s.kind === 'graph' && s.opaque ? (
                      <span className="badge" title="Geometry is a legacy binary blob">
                        binary
                      </span>
                    ) : null}
                    {s.kind === 'data' && s.table.storage === 'offsets' ? (
                      <span className="badge badge--warn" title="Stored values are offsets">
                        offsets
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function Failure({ failed }: { failed: Failed }) {
  return (
    <div className="welcome">
      <h1>Could not read {failed.name}</h1>
      <ul className="failure">
        {failed.diagnostics.map((d, i) => (
          <li key={`${d.code}-${i}`}>
            <code>{d.code}</code> - {d.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Stands in while no document is open, so the chart context is never null. */
const EMPTY_PROJECT: Project = {
  source: 'bundle',
  title: undefined,
  formatVersion: undefined,
  minPrismVersion: undefined,
  sheets: [],
  notes: [],
}
