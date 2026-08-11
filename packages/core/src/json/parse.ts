import { type Node, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser'
import { DiagnosticBag, type ParseResult } from '../diagnostics.js'
import {
  JSON_FORMAT_TAB,
  type JsonFormat,
  type JsonMember,
  type JsonNode,
  type JsonObject,
} from './types.js'

export interface JsonDocument {
  readonly root: JsonNode
  readonly format: JsonFormat
}

/**
 * Detects a document's layout from its own text.
 *
 * We could key this off the entry name, and `formatForEntry` does exactly that
 * when creating a file. But for a document we are reading, believing the file
 * over our table means an unfamiliar layout survives the round trip instead of
 * being silently normalised into the one we expected.
 */
export function detectJsonFormat(text: string): JsonFormat {
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n'
  const trailingNewline = text.endsWith('\n')

  // The first indented line reveals the unit.
  const m = /\n([ \t]+)\S/.exec(text)
  const indent = m?.[1] ?? '\t'
  return { indent, trailingNewline, eol }
}

/**
 * Parses JSON into a model that keeps member order and scalar source text.
 *
 * jsonc-parser does the scanning. It accepts a superset of JSON, so we reject
 * the extras explicitly rather than silently accepting a file Prism would not.
 */
export function parseJson(text: string, path = ''): ParseResult<JsonDocument> {
  const bag = new DiagnosticBag()
  const errors: ParseError[] = []
  const tree = parseTree(text, errors, {
    disallowComments: true,
    allowTrailingComma: false,
    allowEmptyContent: false,
  })

  for (const e of errors) {
    bag.error('json/syntax', path, `${printParseErrorCode(e.error)} at offset ${e.offset}`, {
      offset: e.offset,
      length: e.length,
    })
  }

  const format = detectJsonFormat(text)

  if (tree === undefined) {
    return bag.result({ root: { kind: 'scalar', raw: 'null', value: null }, format })
  }

  const convert = (node: Node, pointer: string): JsonNode => {
    switch (node.type) {
      case 'object': {
        const members: JsonMember[] = []
        const localKeys = new Set<string>()
        for (const child of node.children ?? []) {
          // A property node's children are [key, value]; a missing value means
          // truncated input, which the error list above already reported.
          const keyNode = child.children?.[0]
          const valueNode = child.children?.[1]
          if (keyNode === undefined || valueNode === undefined) continue
          const key = String(keyNode.value)
          if (localKeys.has(key)) {
            bag.warn('json/duplicate-key', `${pointer}/${key}`, 'object has a repeated key')
          }
          localKeys.add(key)
          members.push({
            keyRaw: text.slice(keyNode.offset, keyNode.offset + keyNode.length),
            key,
            value: convert(valueNode, `${pointer}/${key}`),
          })
        }
        return { kind: 'object', members }
      }
      case 'array': {
        const items = (node.children ?? []).map((c, i) => convert(c, `${pointer}/${i}`))
        return { kind: 'array', items }
      }
      default:
        return {
          kind: 'scalar',
          raw: text.slice(node.offset, node.offset + node.length),
          value: node.value as string | number | boolean | null,
        }
    }
  }

  return bag.result({ root: convert(tree, ''), format })
}

/** Reads a member's value, or undefined when the node is not an object or the key is absent. */
export function getMember(node: JsonNode, key: string): JsonNode | undefined {
  if (node.kind !== 'object') return undefined
  return node.members.find((m) => m.key === key)?.value
}

export function asObject(node: JsonNode | undefined): JsonObject | undefined {
  return node?.kind === 'object' ? node : undefined
}

export function asString(node: JsonNode | undefined): string | undefined {
  return node?.kind === 'scalar' && typeof node.value === 'string' ? node.value : undefined
}

export function asNumber(node: JsonNode | undefined): number | undefined {
  return node?.kind === 'scalar' && typeof node.value === 'number' ? node.value : undefined
}

export function asBoolean(node: JsonNode | undefined): boolean | undefined {
  return node?.kind === 'scalar' && typeof node.value === 'boolean' ? node.value : undefined
}

export function asArray(node: JsonNode | undefined): readonly JsonNode[] | undefined {
  return node?.kind === 'array' ? node.items : undefined
}

export function stringArray(node: JsonNode | undefined): string[] {
  if (node?.kind !== 'array') return []
  const out: string[] = []
  for (const item of node.items) {
    const s = asString(item)
    if (s !== undefined) out.push(s)
  }
  return out
}

export { JSON_FORMAT_TAB }
