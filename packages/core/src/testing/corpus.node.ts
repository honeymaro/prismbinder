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
  // Fetched by `tools/fetch-external-fixtures.mjs`, and for a long time read by
  // nothing. They were downloaded, listed in a manifest, and then invisible to
  // every suite, which is how a `HugeTable` document sat on disk while the
  // reader returned it as empty. A corpus that does not include a file it has
  // is not a corpus.
  'fixtures/external',
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
 * A ZIP is not necessarily a Prism document.
 *
 * Being a ZIP is what the magic bytes tell you; being a *bundle* additionally
 * requires a `document.json`. Widening the corpus turned up an archive holding
 * one empty directory and nothing else, and every suite that assumed otherwise
 * failed on it - correctly refusing to parse it, then being marked wrong for
 * having refused.
 *
 * The whole buffer, not a tail window. A first attempt scanned the last 64 KB,
 * on the theory that the central directory lives at the end. 64 KB bounds the
 * *end-of-central-directory record*, not the directory itself, and
 * `document.json` is written before the `data/tables` block, so its record sits
 * near the directory's start. Two hundred tables was enough to push it out of
 * the window, and the document was then dropped from the corpus in silence -
 * the one failure mode a test helper must not have.
 *
 * Deliberately not `readZip`: a helper that picks the corpus by running the
 * reader under test would shrink that corpus exactly when the reader breaks.
 * A false positive here costs nothing, because the suites then report a real
 * diagnostic; a false negative costs coverage that nobody can see is missing.
 */
function looksLikeBundle(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes('document.json')
}

/**
 * Every Prism bundle we can find.
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
      // Cheapest, most certain test first: this walks every file in the sample
      // directories, most of which are not archives at all.
      if (bytes.length < 4) continue
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) continue
      if (!looksLikeBundle(bytes)) continue
      out.push({ name: path.split(/[\\/]/).pop() ?? path, path, bytes })
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
