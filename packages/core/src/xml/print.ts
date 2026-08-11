import type { XmlDocument, XmlElement, XmlNode } from './types.js'

/**
 * Serialises the model.
 *
 * Concatenation, by design: every node carries the exact source of its own
 * markup, so `printXml(parseXmlDocument(x)) === x` without any escaping,
 * indentation or line-ending decisions being re-made. Those decisions are
 * exactly where a conventional serialiser would silently rewrite the file.
 */
export function printXml(doc: XmlDocument): string {
  return doc.prolog + printElement(doc.root) + doc.epilog
}

export function printElement(el: XmlElement): string {
  if (el.children.length === 0) return el.startTagRaw + el.endTagRaw
  let out = el.startTagRaw
  for (const c of el.children) out += printNode(c)
  return out + el.endTagRaw
}

function printNode(node: XmlNode): string {
  switch (node.kind) {
    case 'element':
      return printElement(node)
    case 'text':
      return node.raw
    default:
      return node.raw
  }
}
