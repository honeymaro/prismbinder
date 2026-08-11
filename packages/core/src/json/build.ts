import { PrismbinderError } from '../diagnostics.js'
import type { JsonArray, JsonMember, JsonNode, JsonObject, JsonScalar } from './types.js'

/**
 * Constructors for building nodes, used by `create()` and by edits.
 *
 * Numbers are the delicate part. Prism writes integral doubles as `1676.0`, and
 * a value that came from a JS number cannot tell us whether it was meant to be
 * a float or an int. So the caller says which, rather than us guessing and
 * changing how a file looks every time it is saved.
 */

export function jsonNull(): JsonScalar {
  return { kind: 'scalar', raw: 'null', value: null }
}

export function jsonBool(v: boolean): JsonScalar {
  return { kind: 'scalar', raw: v ? 'true' : 'false', value: v }
}

export function jsonString(v: string): JsonScalar {
  return { kind: 'scalar', raw: JSON.stringify(v), value: v }
}

/** An integer, written without a decimal point. */
export function jsonInt(v: number): JsonScalar {
  if (!Number.isInteger(v)) throw new PrismbinderError(`jsonInt called with non-integer ${v}`)
  return { kind: 'scalar', raw: String(v), value: v }
}

/**
 * A floating-point value, written the way Prism writes them.
 *
 * Whole numbers keep a `.0` suffix, because that is what the format uses and
 * round-tripping a document should not rewrite `95.0` into `95`.
 */
export function jsonFloat(v: number): JsonScalar {
  if (!Number.isFinite(v)) throw new PrismbinderError(`jsonFloat called with non-finite ${v}`)
  const raw = Number.isInteger(v) ? `${v}.0` : String(v)
  return { kind: 'scalar', raw, value: v }
}

/** A number whose exact spelling matters more than its JS value, e.g. beyond 2^53. */
export function jsonRawNumber(raw: string): JsonScalar {
  return { kind: 'scalar', raw, value: Number(raw) }
}

export function jsonArray(items: readonly JsonNode[]): JsonArray {
  return { kind: 'array', items }
}

export function jsonObject(entries: readonly (readonly [string, JsonNode])[]): JsonObject {
  return {
    kind: 'object',
    members: entries.map(
      ([key, value]): JsonMember => ({ keyRaw: JSON.stringify(key), key, value }),
    ),
  }
}

/** Returns a copy of `obj` with `key` set, preserving position when it already exists. */
export function setMember(obj: JsonObject, key: string, value: JsonNode): JsonObject {
  const idx = obj.members.findIndex((m) => m.key === key)
  const member: JsonMember = { keyRaw: JSON.stringify(key), key, value }
  if (idx < 0) return { kind: 'object', members: [...obj.members, member] }
  const members = obj.members.slice()
  members[idx] = { ...members[idx]!, value }
  return { kind: 'object', members }
}

export function removeMember(obj: JsonObject, key: string): JsonObject {
  return { kind: 'object', members: obj.members.filter((m) => m.key !== key) }
}
