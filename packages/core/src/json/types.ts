/**
 * A JSON document model that survives a byte-exact round trip.
 *
 * `JSON.parse` + `JSON.stringify` cannot do this for Prism's files, for three
 * measured reasons:
 *
 *  - Integral doubles are written with a decimal point. `1676.0` becomes `1676`
 *    once it passes through a JS number. 1,611 literals in the sample corpus.
 *  - One integer exceeds 2^53 (`-9223372036854775807`), so the *value* is lost,
 *    not merely its spelling.
 *  - Objects can carry numeric-looking keys in non-ascending order, and JS
 *    object property order promotes integer-like keys to the front.
 *
 * So scalars keep their source text, and members keep their order.
 */

export type JsonNode = JsonObject | JsonArray | JsonScalar

export interface JsonObject {
  readonly kind: 'object'
  readonly members: readonly JsonMember[]
}

export interface JsonMember {
  /** The key's source text including quotes, so escape spelling survives. */
  readonly keyRaw: string
  /** The decoded key, for lookups. */
  readonly key: string
  readonly value: JsonNode
}

export interface JsonArray {
  readonly kind: 'array'
  readonly items: readonly JsonNode[]
}

export interface JsonScalar {
  readonly kind: 'scalar'
  /**
   * Exact source text: `1676.0`, `-9223372036854775807`, `"a\rb"`, `true`.
   * This is the authoritative form; `value` is a convenience decoding that may
   * be lossy for large integers.
   */
  readonly raw: string
  readonly value: string | number | boolean | null
}

/**
 * How a particular document is laid out.
 *
 * Prism uses two styles in the same archive: tabs with no trailing newline
 * nearly everywhere, and four spaces with a trailing newline for
 * `data/tables/<uid>/content.json`. That subtree is also the one whose ZIP entries
 * carry extractVersion 45 rather than 20 - two independent signs that it is
 * written by a different code path.
 */
export interface JsonFormat {
  /** The literal indent unit: '\t' or a run of spaces. */
  readonly indent: string
  readonly trailingNewline: boolean
  readonly eol: '\n' | '\r\n'
}

export const JSON_FORMAT_TAB: JsonFormat = Object.freeze({
  indent: '\t',
  trailingNewline: false,
  eol: '\n',
})

export const JSON_FORMAT_SPACES4: JsonFormat = Object.freeze({
  indent: '    ',
  trailingNewline: true,
  eol: '\n',
})

/**
 * Picks the layout for an entry we are creating from scratch.
 *
 * Derived from the corpus rather than guessed: every `content.json` under
 * `data/tables/` uses four spaces and ends with a newline; all 881 other JSON
 * entries use tabs and do not.
 */
export function formatForEntry(entryName: string): JsonFormat {
  return /^data\/tables\/[^/]+\/content\.json$/.test(entryName)
    ? JSON_FORMAT_SPACES4
    : JSON_FORMAT_TAB
}
