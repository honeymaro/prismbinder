/**
 * Diagnostics.
 *
 * Parsing never throws because of file content. A truncated archive, an
 * unknown class name, a format version from the future - all of these produce
 * a diagnostic and a best-effort value, because the alternative is a tool that
 * refuses to open the one file you needed to rescue.
 *
 * Exceptions are reserved for programmer error.
 */

export type Severity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  /** Stable identifier, documented in docs/diagnostics.md */
  readonly code: string
  readonly severity: Severity
  /** Where in the document: a ZIP entry name, a JSON pointer, a cell reference */
  readonly path: string
  readonly message: string
  readonly detail?: unknown
}

export interface ParseResult<T> {
  readonly value: T
  readonly diagnostics: readonly Diagnostic[]
}

/** Collects diagnostics while a parser runs. */
export class DiagnosticBag {
  readonly #items: Diagnostic[] = []

  add(d: Diagnostic): void {
    this.#items.push(d)
  }

  error(code: string, path: string, message: string, detail?: unknown): void {
    this.add(
      detail === undefined
        ? { code, severity: 'error', path, message }
        : { code, severity: 'error', path, message, detail },
    )
  }

  warn(code: string, path: string, message: string, detail?: unknown): void {
    this.add(
      detail === undefined
        ? { code, severity: 'warning', path, message }
        : { code, severity: 'warning', path, message, detail },
    )
  }

  info(code: string, path: string, message: string, detail?: unknown): void {
    this.add(
      detail === undefined
        ? { code, severity: 'info', path, message }
        : { code, severity: 'info', path, message, detail },
    )
  }

  get items(): readonly Diagnostic[] {
    return this.#items
  }

  get hasErrors(): boolean {
    return this.#items.some((d) => d.severity === 'error')
  }

  result<T>(value: T): ParseResult<T> {
    return { value, diagnostics: this.#items }
  }
}

/** Thrown only for programmer error - never for file content. */
export class PrismbinderError extends Error {
  override readonly name = 'PrismbinderError'
}
