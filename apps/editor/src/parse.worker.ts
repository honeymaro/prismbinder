/// <reference lib="webworker" />
import type { Diagnostic } from '@prismbinder/core'
import { type PrismBundle, readBundle } from '@prismbinder/formats'
import { fromBundle, type Project, readProject } from '@prismbinder/model'

/**
 * Parsing off the main thread.
 *
 * Inflating and parsing a large bundle is hundreds of milliseconds of straight
 * computation: a frozen tab, a stalled scroll, and no opportunity to show that
 * anything is happening. It moves here.
 *
 * The parsed bundle comes back whole rather than being re-derived on the main
 * thread. It is plain data - objects, arrays, `Map`s and typed arrays, with no
 * classes or functions anywhere - so structured clone can carry it, and one
 * memcpy of the parsed form is far cheaper than parsing the file a second time.
 * The main thread then owns the document outright, which is what lets the grid
 * read cells synchronously and undo stay local (no IPC round trip per action).
 *
 * Nothing is transferred. The bundle's entries are subarrays of the input
 * buffer, so detaching that buffer to save a copy would invalidate the very
 * thing being sent back. A memcpy of the file is noise next to parsing it.
 */

export interface ParseRequest {
  readonly id: number
  readonly name: string
  readonly bytes: ArrayBuffer
}

export interface ParseResponse {
  readonly id: number
  readonly project: Project | undefined
  readonly bundle: PrismBundle | undefined
  readonly diagnostics: readonly Diagnostic[]
  readonly millis: number
}

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { id, name, bytes } = e.data
  const view = new Uint8Array(bytes)
  const started = performance.now()

  const isZip = view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04

  let project: Project | undefined
  let bundle: PrismBundle | undefined
  let diagnostics: readonly Diagnostic[]

  if (isZip) {
    const result = readBundle(view)
    diagnostics = result.diagnostics
    bundle = result.value
    project = result.value === undefined ? undefined : fromBundle(result.value)
  } else {
    const result = readProject(view, name)
    diagnostics = result.diagnostics
    project = result.value
  }

  const response: ParseResponse = {
    id,
    project,
    bundle,
    diagnostics,
    millis: performance.now() - started,
  }
  scope.postMessage(response)
}
