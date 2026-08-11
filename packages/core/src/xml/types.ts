/**
 * An XML model that round-trips byte-for-byte.
 *
 * Prism's XML cannot survive re-serialisation by a conventional builder. Across
 * the corpus it is CRLF throughout, has no indentation at all, carries trailing
 * whitespace on some lines, appears with and without a BOM, writes empty
 * elements as both `<X/>` and `<X></X>` in the same file, and escapes
 * inconsistently - `&gt;` 337 times in text where it is not required, `&apos;`
 * where `'` would do, and numeric references like `&#xA;` and `&#38;`.
 *
 * No serialiser reproduces that mix, so we do not try. Nodes keep the exact
 * source text of their markup, and printing is concatenation. Only a node
 * somebody actually edits needs to be regenerated.
 */

export type XmlNode = XmlElement | XmlText | XmlComment | XmlCData | XmlProcessingInstruction

export interface XmlElement {
  readonly kind: 'element'
  readonly name: string
  /** Decoded attribute values, for reading. Order follows the source. */
  readonly attributes: ReadonlyMap<string, string>
  /** Exact source of the opening tag, including attributes and any `/>`. */
  readonly startTagRaw: string
  /** Exact source of the closing tag, or '' when the element is self-closing. */
  readonly endTagRaw: string
  readonly selfClosing: boolean
  readonly children: readonly XmlNode[]
}

export interface XmlText {
  readonly kind: 'text'
  /** Source text with entities exactly as written. */
  readonly raw: string
  /** Entities resolved. */
  readonly value: string
}

export interface XmlComment {
  readonly kind: 'comment'
  readonly raw: string
}

export interface XmlCData {
  readonly kind: 'cdata'
  readonly raw: string
}

export interface XmlProcessingInstruction {
  readonly kind: 'pi'
  readonly raw: string
}

export interface XmlDocument {
  /**
   * Everything before the root element: the BOM if present, the XML
   * declaration, any stylesheet processing instruction, and the whitespace
   * between them. parse-xml does not surface these as nodes, so we keep the
   * span verbatim.
   */
  readonly prolog: string
  readonly root: XmlElement
  /** Anything after the root element's closing tag, usually a line ending. */
  readonly epilog: string
}
