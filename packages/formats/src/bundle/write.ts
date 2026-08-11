import { encodeUtf8, printJson, withEntryContents, writeZip } from '@prismbinder/core'
import type { PrismBundle } from './types.js'

/**
 * Serialises a bundle.
 *
 * With no pending edits this re-emits the archive exactly as it was read, so
 * `writeBundle(readBundle(x)) === x`. That equality is the regression gate for
 * the whole stack: ZIP headers, deflate parameters, JSON layout and CSV
 * quoting all have to be right simultaneously for it to hold.
 */
export function writeBundle(bundle: PrismBundle): Uint8Array {
  return writeZip(bundle.archive)
}

/**
 * Applies edited entry contents and serialises.
 *
 * Entries not mentioned keep their original compressed bytes, so a one-cell
 * change produces a file that differs from the original only where it should.
 */
export function writeBundleWith(
  bundle: PrismBundle,
  updates: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  return writeZip(withEntryContents(bundle.archive, updates))
}

/** Encodes a parsed JSON document back to entry bytes. */
export function encodeJsonEntry(doc: Parameters<typeof printJson>[0]): Uint8Array {
  return encodeUtf8(printJson(doc))
}
