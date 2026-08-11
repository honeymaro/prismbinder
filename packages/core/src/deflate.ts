/**
 * Deflate parameters and helpers for Prism bundles.
 *
 * Everything in this file exists because of one measured fact: Prism's ZIP
 * entries can be re-compressed byte-for-byte, but only with one exact set of
 * parameters, produced by one particular family of zlib implementations.
 * See docs/measurements.md (M1, M2).
 */
import { Inflate, deflateRaw as pakoDeflateRaw, inflateRaw as pakoInflateRaw } from 'pako'

/**
 * The exact deflate parameters Prism writes with.
 *
 * Measured over the full corpus: 1171/1171 entries reproduce byte-for-byte.
 *
 * Do not spell these out at call sites. Every field is load-bearing:
 *
 * - `level: 2`      Confirmed twice, independently. The parameter sweep lands
 *                   here, and the ZIP general-purpose bit flag `0x4` on every
 *                   file entry declares "Fast" compression per APPNOTE 4.4.4.
 * - `memLevel: 9`   Sizes the hash table. 8 and 9 diverge on larger payloads.
 * - `strategy: 0`   Z_DEFAULT_STRATEGY. Note this is a no-op at levels 1-3
 *                   anyway, since zlib only consults `strategy` in
 *                   `deflate_slow` (levels 4-9) - an earlier claim that some
 *                   entries needed Z_FILTERED was a measurement artifact.
 * - `legacyHash`    THE DANGEROUS ONE. pako 3.0.0 flipped this default to
 *                   `false`, which switches the match-finder to Chromium's
 *                   CRC32-based hash and produces node-compatible output.
 *                   Prism is in the stock-zlib family. Omitting this drops the
 *                   match rate from 100% to 4.8%.
 */
export const PRISM_DEFLATE = Object.freeze({
  level: 2,
  memLevel: 9,
  strategy: 0,
  legacyHash: true,
} as const)

/**
 * Compress with Prism's exact parameters.
 *
 * Output is byte-identical to what Prism itself would write, which is what
 * makes both the T1' oracle and `create()` possible.
 */
export function deflateRaw(data: Uint8Array): Uint8Array {
  return pakoDeflateRaw(data, PRISM_DEFLATE)
}

/**
 * Decompress a raw deflate stream.
 *
 * Inflater output is bit-determined by the stream, so any conformant
 * implementation agrees here - but we still use pako rather than `node:zlib`
 * so that a single code path serves both the browser and the CLI. What we
 * verify in a browser test is then literally what runs everywhere.
 */
export function inflateRaw(data: Uint8Array): Uint8Array {
  return pakoInflateRaw(data)
}

/** Signals that decompression was stopped on purpose. Never escapes this file. */
class OutputTooLarge extends Error {}

/**
 * Decompress, refusing to produce more than `maxBytes`.
 *
 * A ZIP header states how large an entry will be once inflated, and nothing in
 * the format makes that claim true - the deflate stream expands to whatever it
 * expands to. Checking a limit against the declared size therefore checks a
 * number the attacker chose: a 204 KB archive can declare a 1:1 ratio, pass
 * every guard, and inflate to hundreds of megabytes.
 *
 * So the limit is applied to bytes as they are produced. `undefined` means the
 * stream exceeded the bound or was malformed, and the caller is expected to
 * turn that into a diagnostic rather than a partial buffer, because half of a
 * decompressed file is not a usable answer to anything.
 */
export function inflateRawBounded(data: Uint8Array, maxBytes: number): Uint8Array | undefined {
  const inflater = new Inflate({ raw: true })
  const chunks: Uint8Array[] = []
  let total = 0

  // Overriding onData is pako's documented hook for streaming consumption.
  // Throwing from it aborts `push`, which is what stops the work rather than
  // merely discarding it afterwards.
  inflater.onData = (chunk: Uint8Array) => {
    total += chunk.length
    if (total > maxBytes) throw new OutputTooLarge()
    chunks.push(chunk)
  }

  try {
    inflater.push(data, true)
  } catch (err) {
    if (err instanceof OutputTooLarge) return undefined
    throw err
  }
  if (inflater.err !== 0) return undefined

  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
