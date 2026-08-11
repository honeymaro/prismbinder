#!/usr/bin/env node
/**
 * Fetches Prism documents from other open-source projects into
 * fixtures/external/, so the corpus tests have inputs beyond whatever Prism
 * installation happens to be on this machine.
 *
 * The files are not committed - they belong to their projects - but the commits
 * they come from are, so the corpus a contributor gets is the corpus the
 * measurements were taken against.
 *
 *   node tools/fetch-external-fixtures.mjs
 *   PRISMBINDER_CORPUS_DIRS="$PWD/fixtures/external" pnpm test:node
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEST = join(ROOT, 'fixtures', 'external')

// Pinned to a commit, not a branch. `docs/measurements.md` cites counts taken
// against these exact files; a moving ref would let the corpus change under
// those numbers with nothing in the repository recording that it had.
const SOURCES = [
  {
    repo: 'Yue-Jiang/pzfx',
    ref: '0c1632c36a342d0e3084d3f24eb343711484cb12',
    licence: 'MIT (c) Yue Jiang',
  },
  {
    repo: 'Biomiha/prism2R',
    ref: '4dc0b4be8395ac7d43e95c50b9e9ba38d8a7538a',
    licence: 'MIT (c) pRism authors',
  },
]

const WANTED = /\.(pzfx|prism|prismt|pzt)$/i

async function json(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'prismbinder-fixtures' } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

async function main() {
  mkdirSync(DEST, { recursive: true })
  const manifest = []

  for (const { repo, ref, licence } of SOURCES) {
    const { tree } = await json(`https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`)
    for (const node of tree) {
      if (node.type !== 'blob' || !WANTED.test(node.path)) continue
      const raw = `https://raw.githubusercontent.com/${repo}/${ref}/${node.path}`
      const res = await fetch(raw)
      if (!res.ok) {
        console.error(`  skipped ${node.path}: ${res.status}`)
        continue
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      // Both separators, then a containment check. `split('/')` alone leaves
      // backslashes in place, and on Windows `join` reads those as separators:
      // a tree entry named `x\..\..\evil.pzfx` would land outside DEST. No
      // current upstream path does that, which is exactly why it is worth
      // closing before some future upstream commit does.
      const base = (node.path.split(/[\\/]/).pop() ?? '').replace(/[^A-Za-z0-9._-]/g, '_')
      const name = `${repo.split('/')[1]}__${base}`
      const dest = join(DEST, name)
      if (!resolve(dest).startsWith(resolve(DEST) + sep)) {
        console.error(`  refused unsafe path: ${node.path}`)
        continue
      }
      writeFileSync(dest, bytes)
      manifest.push({
        file: name,
        source: `${repo}/${node.path}`,
        ref,
        licence,
        bytes: bytes.length,
      })
    }
  }

  writeFileSync(join(DEST, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 1)}\n`)
  const total = manifest.reduce((a, m) => a + m.bytes, 0)
  console.log(`${manifest.length} files, ${total.toLocaleString()} bytes -> fixtures/external`)
  console.log('run the corpus tests with:')
  console.log('  PRISMBINDER_CORPUS_DIRS="$PWD/fixtures/external" pnpm test:node')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
