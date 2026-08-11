import type { History } from './history.js'

/**
 * Surviving a closed tab.
 *
 * The app never uploads a file, which means a crash or an accidental close is
 * the one way to lose work outright - there is no copy on a server to fall back
 * to. Autosave puts the original bytes and the pending edits into the origin
 * private file system, which is local to the browser and invisible to any site
 * including this one when served from elsewhere.
 *
 * The undo stack is saved with the edits. Restoring the values while dropping
 * the ability to reverse them would hand back a document you cannot back out
 * of, which is worse than a clean restart.
 *
 * OPFS rather than IndexedDB: the payload is one large opaque blob plus a small
 * JSON record, which is exactly what a file system is for, and writing bytes
 * through a file handle avoids the structured-clone copy IndexedDB imposes on a
 * multi-megabyte `Uint8Array`.
 */

const DIR = 'session'
const BYTES = 'document.bin'
const STATE = 'state.json'

export interface Session {
  readonly name: string
  readonly bytes: Uint8Array
  readonly edits: ReadonlyMap<string, string>
  readonly history: History
  readonly savedAt: number
}

interface StoredState {
  readonly version: 1
  readonly name: string
  readonly edits: [string, string][]
  readonly history: History
  readonly savedAt: number
}

/** False in Firefox's private mode and in any context without OPFS. */
export function isSupported(): boolean {
  return typeof navigator !== 'undefined' && navigator.storage?.getDirectory !== undefined
}

async function dir(): Promise<FileSystemDirectoryHandle | undefined> {
  if (!isSupported()) return undefined
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(DIR, { create: true })
  } catch {
    return undefined
  }
}

async function writeFile(
  d: FileSystemDirectoryHandle,
  name: string,
  data: Uint8Array | string,
): Promise<void> {
  const handle = await d.getFileHandle(name, { create: true })
  const w = await handle.createWritable()
  await w.write(data as unknown as FileSystemWriteChunkType)
  await w.close()
}

/**
 * Saves the document bytes once, then only the edits.
 *
 * The original never changes while a document is open, so rewriting tens of
 * megabytes on every keystroke would be pure waste. `withBytes` is true only on
 * the first save for a given document.
 */
export async function save(session: Session, withBytes: boolean): Promise<boolean> {
  const d = await dir()
  if (d === undefined) return false
  try {
    if (withBytes) await writeFile(d, BYTES, session.bytes)
    const state: StoredState = {
      version: 1,
      name: session.name,
      edits: [...session.edits],
      history: session.history,
      savedAt: session.savedAt,
    }
    await writeFile(d, STATE, JSON.stringify(state))
    return true
  } catch {
    // A full disk or a revoked quota is not worth interrupting an edit for.
    // The document in the tab is untouched; `false` tells the caller to say
    // that the safety net is not there, rather than let it be assumed.
    return false
  }
}

export async function load(): Promise<Session | undefined> {
  const d = await dir()
  if (d === undefined) return undefined
  try {
    const stateFile = await (await d.getFileHandle(STATE)).getFile()
    const parsed: unknown = JSON.parse(await stateFile.text())
    if (!isStoredState(parsed)) return undefined

    const bytesFile = await (await d.getFileHandle(BYTES)).getFile()
    return {
      name: parsed.name,
      bytes: new Uint8Array(await bytesFile.arrayBuffer()),
      edits: new Map(parsed.edits),
      history: parsed.history,
      savedAt: parsed.savedAt,
    }
  } catch {
    return undefined
  }
}

export async function clear(): Promise<void> {
  const d = await dir()
  if (d === undefined) return
  for (const name of [BYTES, STATE]) {
    try {
      await d.removeEntry(name)
    } catch {
      // Already gone.
    }
  }
}

/**
 * Validates what came back off disk.
 *
 * Storage written by an older build of this app is the realistic failure, not
 * an attacker: silently feeding a stale shape into the history stack would
 * produce an undo that throws halfway through. A rejected record just means no
 * recovery offer.
 */
function isStoredState(v: unknown): v is StoredState {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.version !== 1 || typeof o.name !== 'string' || typeof o.savedAt !== 'number') return false
  if (!Array.isArray(o.edits)) return false
  if (
    !o.edits.every(
      (e) =>
        Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string',
    )
  ) {
    return false
  }
  const h = o.history as Record<string, unknown> | undefined
  return typeof h === 'object' && h !== null && Array.isArray(h.past) && Array.isArray(h.future)
}
