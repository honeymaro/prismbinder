/**
 * Locates real Prism files for the corpus tests.
 *
 * Node-only, and never shipped: the `.node.ts` suffix keeps it out of the
 * package build and out of the browser-safety lint rule.
 *
 * Nothing here is committed as a fixture. Files that ship with Prism are
 * GraphPad's content, and anything a user points us at with PRISMBINDER_CORPUS_DIRS
 * is their own data. We read them locally to verify byte fidelity and that is
 * all.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'

export interface CorpusFile {
  readonly name: string
  readonly path: string
  readonly bytes: Uint8Array
}

const DEFAULT_DIRS = [
  'C:/Program Files/GraphPad/Prism/SampleData/MultipleVariables',
  'C:/Program Files/GraphPad/Prism/Portfolio/Graphs to explore',
  'C:/Program Files/GraphPad/Prism/Portfolio/Graphs with tutorials',
  'C:/Program Files/GraphPad/Prism/SampleData/Column',
  'C:/Program Files/GraphPad/Prism/SampleData/Grouped',
  'C:/Program Files/GraphPad/Prism/SampleData/XY',
  'C:/Program Files/GraphPad/Prism/SampleData/Contingency',
  'C:/Program Files/GraphPad/Prism/SampleData/Survival',
  'C:/Program Files/GraphPad/Prism/SampleData/Nested',
  'C:/Program Files/GraphPad/Prism/SampleData/PartsOfWhole',
  'fixtures/authored',
  'fixtures/vendor',
]

/** Extra directories, e.g. PRISMBINDER_CORPUS_DIRS="D:/my-prism-files;E:/more". */
function corpusDirs(): string[] {
  const extra = (env.PRISMBINDER_CORPUS_DIRS ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...DEFAULT_DIRS, ...extra]
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map((n) => join(dir, n))
      .filter((p) => {
        try {
          return statSync(p).isFile()
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

/**
 * Every ZIP-container document we can find.
 *
 * Dispatch is on magic bytes rather than extension, because `.pzt` is three
 * different formats depending on the file: XML, PCFF binary, or a ZIP bundle.
 */
export function corpusBundles(): CorpusFile[] {
  const out: CorpusFile[] = []
  for (const dir of corpusDirs()) {
    for (const path of listFiles(dir)) {
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(readFileSync(path))
      } catch {
        continue
      }
      if (bytes.length < 4) continue
      if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
        out.push({ name: path.split(/[\\/]/).pop() ?? path, path, bytes })
      }
    }
  }
  return out
}

/** Every XML-shaped Prism document (`.pzfx`, and the `.pzt` files that are XML). */
export function corpusXmlDocuments(): CorpusFile[] {
  const out: CorpusFile[] = []
  for (const dir of corpusDirs()) {
    for (const path of listFiles(dir)) {
      if (!/\.(pzfx|pzt|xml)$/i.test(path)) continue
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(readFileSync(path))
      } catch {
        continue
      }
      const head = new TextDecoder().decode(bytes.subarray(0, 64))
      if (!head.replace(/^\uFEFF/, '').startsWith('<?xml')) continue
      out.push({ name: path.split(/[\\/]/).pop() ?? path, path, bytes })
    }
  }
  return out
}

export function describeCorpus(): string {
  const n = corpusBundles().length
  return n === 0 ? 'no corpus found' : `${n} bundles`
}
