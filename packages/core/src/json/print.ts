import type { JsonDocument } from './parse.js'
import type { JsonFormat, JsonNode } from './types.js'

/**
 * Serialises the model back to text.
 *
 * `printJson(parseJson(x)) === x` for every JSON entry in the corpus, which is
 * what makes the model trustworthy: a field we failed to capture would show up
 * as a byte difference rather than as silent data loss months later.
 *
 * This is also the path `create()` needs. Editing an existing document could
 * get away with splicing the original text, but building one from nothing has
 * to produce Prism's layout from the model alone.
 */
export function printJson(doc: JsonDocument): string {
  const out: string[] = []
  writeNode(out, doc.root, doc.format, 0)
  if (doc.format.trailingNewline) out.push(doc.format.eol)
  return out.join('')
}

/** Prints a bare node, for tests and for embedding. */
export function printJsonNode(node: JsonNode, format: JsonFormat): string {
  const out: string[] = []
  writeNode(out, node, format, 0)
  return out.join('')
}

function writeNode(out: string[], node: JsonNode, fmt: JsonFormat, depth: number): void {
  switch (node.kind) {
    case 'scalar':
      out.push(node.raw)
      return

    case 'array': {
      if (node.items.length === 0) {
        out.push('[]')
        return
      }
      const inner = fmt.indent.repeat(depth + 1)
      out.push('[', fmt.eol)
      for (let i = 0; i < node.items.length; i++) {
        out.push(inner)
        writeNode(out, node.items[i] as JsonNode, fmt, depth + 1)
        if (i < node.items.length - 1) out.push(',')
        out.push(fmt.eol)
      }
      out.push(fmt.indent.repeat(depth), ']')
      return
    }

    case 'object': {
      if (node.members.length === 0) {
        out.push('{}')
        return
      }
      const inner = fmt.indent.repeat(depth + 1)
      out.push('{', fmt.eol)
      for (let i = 0; i < node.members.length; i++) {
        const m = node.members[i]!
        out.push(inner, m.keyRaw, ': ')
        writeNode(out, m.value, fmt, depth + 1)
        if (i < node.members.length - 1) out.push(',')
        out.push(fmt.eol)
      }
      out.push(fmt.indent.repeat(depth), '}')
      return
    }
  }
}
