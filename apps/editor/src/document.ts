import type { Diagnostic } from '@prismbinder/core'
import {
  applyCellEdits,
  type CellEdit,
  type PrismBundle,
  readBundle,
  writeBundleWith,
} from '@prismbinder/formats'
import { fromBundle, type Project, readProject } from '@prismbinder/model'

/**
 * What the app holds while a file is open.
 *
 * The parsed bundle is kept alongside the neutral view because saving has to go
 * back through the codec the file came from. Round-tripping through the neutral
 * model instead would quietly discard everything the model does not represent -
 * which is most of the file.
 */
export interface OpenDocument {
  readonly name: string
  readonly size: number
  readonly project: Project
  readonly diagnostics: readonly Diagnostic[]
  /** Present only for ZIP bundles; XML documents are read-only for now. */
  readonly bundle: PrismBundle | undefined
}

export type EditMap = ReadonlyMap<string, string>

/** A stable key for one cell. */
export function cellKey(sheetId: string, row: number, column: number): string {
  return `${sheetId}\0${row}\0${column}`
}

export function parseCellKey(key: string): CellEdit | undefined {
  const [sheetId, row, column] = key.split('\0')
  if (sheetId === undefined || row === undefined || column === undefined) return undefined
  return { sheetId, row: Number(row), column: Number(column), value: '' }
}

export function openDocument(
  name: string,
  bytes: Uint8Array,
): { document: OpenDocument | undefined; diagnostics: readonly Diagnostic[] } {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04

  if (isZip) {
    const { value, diagnostics } = readBundle(bytes)
    if (value === undefined) return { document: undefined, diagnostics }
    return {
      document: {
        name,
        size: bytes.length,
        project: fromBundle(value),
        diagnostics,
        bundle: value,
      },
      diagnostics,
    }
  }

  const { value, diagnostics } = readProject(bytes, name)
  if (value === undefined) return { document: undefined, diagnostics }
  return {
    document: { name, size: bytes.length, project: value, diagnostics, bundle: undefined },
    diagnostics,
  }
}

export interface SaveResult {
  readonly bytes: Uint8Array
  readonly changedEntries: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
}

/**
 * Writes the edits back into the original container.
 *
 * Entries nobody touched keep their original compressed bytes, so the saved
 * file differs from the one that was opened only where it should. That is what
 * makes it safe to round-trip a document you care about through this tool.
 */
export function saveDocument(doc: OpenDocument, edits: EditMap): SaveResult | undefined {
  if (doc.bundle === undefined || edits.size === 0) return undefined

  const list: CellEdit[] = []
  for (const [key, value] of edits) {
    const parsed = parseCellKey(key)
    if (parsed !== undefined) list.push({ ...parsed, value })
  }

  const { updates, diagnostics } = applyCellEdits(doc.bundle, list, {
    modificationDate: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  })
  return {
    bytes: writeBundleWith(doc.bundle, updates),
    changedEntries: [...updates.keys()],
    diagnostics,
  }
}

export function downloadBytes(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
