import { encodeUtf8, printXml } from '@prismbinder/core'
import type { PzfxDocument } from './read.js'

/**
 * Serialises a pzfx document.
 *
 * Unedited input comes back byte-for-byte, including the BOM some files carry,
 * CRLF line endings, the non-canonical entity choices, and whether the root
 * declared a namespace - all of which a conventional XML serialiser would
 * quietly normalise.
 */
export function writePzfx(doc: PzfxDocument): Uint8Array {
  return encodeUtf8(printXml(doc.xml))
}
