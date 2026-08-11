import {
  type XmlCdata as PxCdata,
  type XmlComment as PxComment,
  type XmlDocument as PxDocument,
  type XmlElement as PxElement,
  type XmlNode as PxNode,
  type XmlProcessingInstruction as PxPi,
  type XmlText as PxText,
  parseXml,
} from '@rgrove/parse-xml'
import { DiagnosticBag, type ParseResult } from '../diagnostics.js'
import type { XmlDocument, XmlElement, XmlNode } from './types.js'

const EMPTY_ROOT: XmlElement = {
  kind: 'element',
  name: '',
  attributes: new Map(),
  startTagRaw: '',
  endTagRaw: '',
  selfClosing: true,
  children: [],
}

/**
 * Parses XML, keeping the exact source text of all markup.
 *
 * parse-xml supplies byte offsets for elements, text, comments, CDATA and
 * processing instructions, and those spans tile their parent's content with no
 * gaps - verified against the corpus. Everything the model needs is therefore a
 * slice of the source, which is why the printer can be a concatenation.
 */
export function parseXmlDocument(text: string, path = ''): ParseResult<XmlDocument> {
  const bag = new DiagnosticBag()

  let doc: PxDocument
  try {
    doc = parseXml(text, {
      includeOffsets: true,
      preserveCdata: true,
      preserveComments: true,
      // Prism's files have no DTD, and resolving external entities would be a
      // way to make opening someone's document read our filesystem.
      resolveUndefinedEntity: () => undefined,
    })
  } catch (err) {
    bag.error('xml/syntax', path, err instanceof Error ? err.message : 'XML could not be parsed')
    return bag.result({ prolog: text, root: EMPTY_ROOT, epilog: '' })
  }

  const rootPx = doc.children.find((c): c is PxElement => c.type === 'element')
  if (rootPx === undefined) {
    bag.error('xml/no-root', path, 'document has no root element')
    return bag.result({ prolog: text, root: EMPTY_ROOT, epilog: '' })
  }

  return bag.result({
    prolog: text.slice(0, rootPx.start),
    root: convertElement(rootPx, text),
    epilog: text.slice(rootPx.end),
  })
}

function convertElement(el: PxElement, source: string): XmlElement {
  const children = el.children ?? []
  const first = children[0]
  const last = children[children.length - 1]

  // The opening tag runs from the element's start to its first child; with no
  // children we fall back to the whole span, which is the self-closing case.
  const contentStart = first !== undefined ? first.start : el.end
  const contentEnd = last !== undefined ? last.end : el.end
  const startTagRaw = source.slice(el.start, contentStart)
  const endTagRaw = last !== undefined ? source.slice(contentEnd, el.end) : ''

  // `<X/>` and `<X></X>` both occur, sometimes in the same file, so the
  // distinction has to be carried rather than normalised.
  const selfClosing = children.length === 0 && startTagRaw.endsWith('/>')
  const closing = selfClosing
    ? ''
    : children.length === 0
      ? source.slice(source.indexOf('>', el.start) + 1, el.end)
      : endTagRaw

  const attributes = new Map<string, string>()
  for (const [k, v] of Object.entries(el.attributes ?? {})) attributes.set(k, v)

  return {
    kind: 'element',
    name: el.name,
    attributes,
    startTagRaw:
      selfClosing || children.length > 0
        ? startTagRaw
        : startTagRaw.slice(0, startTagRaw.indexOf('>') + 1),
    endTagRaw: closing,
    selfClosing,
    children: children.map((c) => convertNode(c, source)),
  }
}

function convertNode(node: PxNode, source: string): XmlNode {
  switch (node.type) {
    case 'element':
      return convertElement(node as PxElement, source)
    case 'text': {
      const t = node as PxText
      return { kind: 'text', raw: source.slice(t.start, t.end), value: t.text }
    }
    case 'comment': {
      const c = node as PxComment
      return { kind: 'comment', raw: source.slice(c.start, c.end) }
    }
    case 'cdata': {
      const c = node as PxCdata
      return { kind: 'cdata', raw: source.slice(c.start, c.end) }
    }
    default: {
      const p = node as PxPi
      return { kind: 'pi', raw: source.slice(p.start, p.end) }
    }
  }
}

/** Depth-first search for the first element with the given local name. */
export function findElement(root: XmlElement, name: string): XmlElement | undefined {
  if (localName(root.name) === name) return root
  for (const c of root.children) {
    if (c.kind !== 'element') continue
    const found = findElement(c, name)
    if (found !== undefined) return found
  }
  return undefined
}

/** Direct element children with the given local name. */
export function childElements(el: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = []
  for (const c of el.children) {
    if (c.kind !== 'element') continue
    if (name === undefined || localName(c.name) === name) out.push(c)
  }
  return out
}

/**
 * Strips a namespace prefix.
 *
 * The default namespace is present on only 42 of 53 pzfx-shaped documents, so
 * matching on a qualified name would fail on a fifth of real files.
 */
export function localName(name: string): string {
  const i = name.indexOf(':')
  return i < 0 ? name : name.slice(i + 1)
}

/** Concatenated text of an element's direct and nested text nodes. */
export function textContent(el: XmlElement): string {
  let out = ''
  for (const c of el.children) {
    if (c.kind === 'text') out += c.value
    else if (c.kind === 'cdata') out += c.raw.slice(9, -3)
    else if (c.kind === 'element') out += textContent(c)
  }
  return out
}
