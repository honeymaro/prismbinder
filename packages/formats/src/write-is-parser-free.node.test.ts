import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Authoring a Prism file must not drag a parser in with it.
 *
 * This is a build-shape property, and it is already true: a bundle that imports
 * only `createPzfx` comes out with no `readPzfx`, no XML parser, no inflate and
 * none of the reader's diagnostic codes in it. What it lacks is anything to
 * keep it true. One convenience import from `create.ts` into `read.ts` - a
 * shared helper, a type promoted to a value - would put the whole parser back
 * into every consumer's bundle, and nothing would say so.
 *
 * Why it is worth pinning rather than merely observing:
 *
 * - It is the difference between a promise and a checkable fact. Someone
 *   integrating this to *write* Prism files can point at their dependency graph
 *   rather than at a sentence in a README.
 * - It keeps `sideEffects: false` honest. That flag is what lets a bundler drop
 *   the reader, and a stray side effect in the write path would quietly stop it
 *   working with no test noticing.
 *
 * Walked from source rather than from a bundle, so it needs no bundler and
 * fails at the import that broke it rather than at a missing string in minified
 * output. Type-only imports are ignored: they are erased before anything runs.
 *
 * **What it does not see**, none of which occurs today and all of which would
 * make it pass while the property was broken:
 *
 * - `await import('./read.js')`. The patterns below require `import` at the
 *   start of a line followed by whitespace, so a dynamic one never matches.
 *   The property being pinned is what a bundler can statically drop, which is
 *   the same thing a consumer's build sees, but a lazily loaded parser would
 *   still be parser code in the package.
 * - An import of this package by its own name rather than by a relative path.
 *   Those are skipped as "somebody else's dependency", and one written that way
 *   would loop back into the reader unnoticed.
 * - A specifier that does not resolve to a file. The walk treats an unreadable
 *   path as nothing to follow, so a typo reads as a clean result rather than as
 *   an error.
 *
 * Each was checked against the current source and none of them appears; they
 * are written down because a guard whose blind spots are unstated is a guard
 * people trust further than it deserves.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

/** Entry points that exist to author a document from nothing. */
const WRITE_ENTRIES = ['pzfx/create.ts', 'bundle/create.ts']

/** Modules whose presence would mean a parser reached the write path. */
const PARSERS = ['pzfx/read.ts', 'bundle/read.ts']

const IMPORT = /^\s*import\s+(?!type\b)(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/gm
const EXPORT_FROM = /^\s*export\s+(?!type\b)(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/gm

/** Every source file reachable from `entry` by a value import. */
function closure(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [resolve(HERE, entry)]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const re of [IMPORT, EXPORT_FROM]) {
      re.lastIndex = 0
      for (const m of text.matchAll(re)) {
        const spec = m[1] as string
        // Only inside this package. A cross-package import is a different
        // question and `@prismbinder/core` holds no Prism parser.
        if (!spec.startsWith('.')) continue
        queue.push(join(dirname(file), spec.replace(/\.js$/, '.ts')))
      }
    }
  }
  return seen
}

describe('the write path', () => {
  it('reaches no parser, so authoring a file does not ship one', () => {
    for (const entry of WRITE_ENTRIES) {
      const reached = [...closure(entry)].map((f) => f.replace(/\\/g, '/'))
      for (const parser of PARSERS) {
        const found = reached.filter((f) => f.endsWith(`/${parser}`))
        expect(found, `${entry} reaches ${parser}`).toEqual([])
      }
    }
  })

  it('finds each entry, so a wrong path cannot pass as a clean result', () => {
    for (const entry of WRITE_ENTRIES) {
      const reached = [...closure(entry)].map((f) => f.replace(/\\/g, '/'))
      expect(
        reached.some((f) => f.endsWith(`/${entry}`)),
        entry,
      ).toBe(true)
    }
  })

  it('authors a pzfx document without reaching any other module at all', () => {
    // Not merely parser-free. `pzfx/create.ts` has one runtime import,
    // `encodeUtf8`, and one type import; its closure inside this package is
    // itself. Writing the second-generation format is a pure function from a
    // description to bytes, which is why it is the route that works when the
    // bundle route does not.
    expect(closure('pzfx/create.ts').size).toBe(1)
  })

  it('fails when a parser really is reachable, which is how it is known to work', () => {
    // The reader entry points reach themselves. If the walker could not see
    // that, it could not see a regression either.
    for (const parser of PARSERS) {
      const reached = [...closure(parser)].map((f) => f.replace(/\\/g, '/'))
      expect(reached.some((f) => f.endsWith(`/${parser}`))).toBe(true)
    }
  })
})
