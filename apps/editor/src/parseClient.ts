import type { Diagnostic } from '@prismbinder/core'
import { type OpenDocument, openDocument } from './document.js'
import type { ParseRequest, ParseResponse } from './parse.worker.js'

/**
 * Talks to the parsing worker, and copes without one.
 *
 * A worker is an optimisation, not a dependency: if the environment cannot
 * start one - a stray CSP, an old browser, a test harness - parsing happens on
 * the main thread instead and the only difference the user sees is a pause. A
 * tool whose whole premise is "your file never leaves this tab" should not be
 * defeated by a failed worker construction.
 *
 * One worker, one in-flight request. Opening a second file while the first is
 * still parsing discards the first result rather than racing it onto the
 * screen; `id` is what distinguishes them.
 */

let worker: Worker | null = null
let broken = false
let nextId = 1

function get(): Worker | null {
  if (broken) return null
  if (worker !== null) return worker
  try {
    worker = new Worker(new URL('./parse.worker.js', import.meta.url), { type: 'module' })
    worker.onerror = () => {
      broken = true
      worker?.terminate()
      worker = null
    }
    return worker
  } catch {
    broken = true
    return null
  }
}

export interface ParseOutcome {
  readonly document: OpenDocument | undefined
  readonly diagnostics: readonly Diagnostic[]
  /** Milliseconds spent parsing, and whether a worker did it. */
  readonly millis: number
  readonly offMainThread: boolean
}

export async function parseFile(name: string, bytes: Uint8Array): Promise<ParseOutcome> {
  const w = get()
  if (w === null) return onMainThread(name, bytes)

  const id = nextId++
  try {
    const reply = await new Promise<ParseResponse>((resolve, reject) => {
      const onMessage = (e: MessageEvent<ParseResponse>) => {
        if (e.data.id !== id) return
        w.removeEventListener('message', onMessage)
        resolve(e.data)
      }
      w.addEventListener('message', onMessage)
      w.addEventListener('error', reject, { once: true })
      const request: ParseRequest = {
        id,
        name,
        // A copy: the worker holds subarrays of whatever it is given, and this
        // buffer stays in use here for saving.
        bytes: bytes.slice().buffer,
      }
      w.postMessage(request)
    })

    if (reply.project === undefined) {
      return {
        document: undefined,
        diagnostics: reply.diagnostics,
        millis: reply.millis,
        offMainThread: true,
      }
    }
    return {
      document: {
        name,
        size: bytes.length,
        project: reply.project,
        diagnostics: reply.diagnostics,
        bundle: reply.bundle,
      },
      diagnostics: reply.diagnostics,
      millis: reply.millis,
      offMainThread: true,
    }
  } catch {
    // Whatever went wrong, the file is still readable here.
    broken = true
    return onMainThread(name, bytes)
  }
}

function onMainThread(name: string, bytes: Uint8Array): ParseOutcome {
  const started = performance.now()
  const { document, diagnostics } = openDocument(name, bytes)
  return {
    document,
    diagnostics,
    millis: performance.now() - started,
    offMainThread: false,
  }
}
