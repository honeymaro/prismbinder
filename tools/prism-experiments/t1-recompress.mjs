/**
 * T1' - the recompression oracle (plan section 5 D1, section 10-3)
 *
 * Question: if we re-compress a deflate stream that Prism wrote, do we get the
 * same bytes back?
 *
 * Why it matters. If this holds:
 *   1. T1 (no-edit fidelity) stops being the identity function. It round-trips
 *      through a completely independent encoder, which answers the "the oracle
 *      only grades the copy path" criticism.
 *   2. create() can emit bytes indistinguishable from Prism's own output.
 *   3. Passthrough of original compressed bytes becomes an optimisation rather
 *      than a requirement.
 *
 * What was weak before: the 1171/1171 result was measured with CPython's zlib,
 * and pako's agreement with CPython had only been checked on 10 samples. This
 * script closes that gap by running the actual shipping encoder over everything.
 *
 * Careful: pako 3.0.0 flipped `legacyHash` to default false, which produces
 * Chromium/node-family output. Prism is in the stock-zlib family, so
 * `legacyHash: true` must be passed explicitly on every call.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
// pako 3 ships ESM named exports only (no default export, unlike 2.x)
import { deflateRaw, inflateRaw } from 'pako'

/** The deflate parameters Prism uses. Keep as one constant - plan F6b/F6e. */
export const PRISM_DEFLATE = Object.freeze({
  level: 2,
  memLevel: 9,
  strategy: 0, // Z_DEFAULT_STRATEGY
  legacyHash: true, // stock zlib family (F6c)
})

const SIG_EOCD = 0x06054b50
const SIG_CD = 0x02014b50

/** Minimal ZIP central-directory reader, just enough to lift raw compressed bytes. */
function readZipEntries(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  // Scan backwards for the end-of-central-directory record
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('EOCD not found')

  const count = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)
  const entries = []

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== SIG_CD) throw new Error(`bad CD signature at ${off}`)
    const method = dv.getUint16(off + 10, true)
    const compSize = dv.getUint32(off + 20, true)
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    const localOff = dv.getUint32(off + 42, true)
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen))

    // Re-read the lengths from the local header: its extra field can differ
    // in size from the central directory's.
    const lNameLen = dv.getUint16(localOff + 26, true)
    const lExtraLen = dv.getUint16(localOff + 28, true)
    const dataStart = localOff + 30 + lNameLen + lExtraLen

    entries.push({ name, method, compressed: buf.subarray(dataStart, dataStart + compSize) })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function eq(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// -- Collect the corpus --------------------------------------------
const ROOTS = [
  'C:/Program Files/GraphPad/Prism/SampleData/MultipleVariables',
  'C:/Program Files/GraphPad/Prism/Portfolio/Graphs to explore',
  'C:/Program Files/GraphPad/Prism/Portfolio/Graphs with tutorials',
]

const files = []
for (const root of ROOTS) {
  let names
  try {
    names = readdirSync(root)
  } catch {
    continue
  }
  for (const n of names) {
    const p = join(root, n)
    if (!statSync(p).isFile()) continue
    // Dispatch on magic bytes, not extension: .pzt is XML, PCFF or ZIP (plan N2)
    const head = readFileSync(p).subarray(0, 2)
    if (head[0] === 0x50 && head[1] === 0x4b) files.push(p)
  }
}

console.log(`bundles: ${files.length}`)
console.log(`pako params: ${JSON.stringify(PRISM_DEFLATE)}\n`)

let total = 0
let match = 0
const failures = []
const t0 = performance.now()

for (const f of files) {
  const buf = readFileSync(f)
  for (const e of readZipEntries(buf)) {
    if (e.method !== 8) continue
    total++
    const raw = inflateRaw(e.compressed)
    const re = deflateRaw(raw, PRISM_DEFLATE)
    if (eq(re, e.compressed)) match++
    else
      failures.push({
        file: f.split('/').pop(),
        entry: e.name,
        orig: e.compressed.length,
        got: re.length,
      })
  }
}

const ms = performance.now() - t0

console.log(`deflate entries : ${total}`)
console.log(`byte-identical  : ${match}  (${((match / total) * 100).toFixed(2)}%)`)
console.log(`mismatched      : ${failures.length}`)
console.log(`elapsed         : ${ms.toFixed(0)} ms`)

if (failures.length) {
  console.log('\nfirst 15 mismatches:')
  for (const x of failures.slice(0, 15)) {
    console.log(`  ${x.file} :: ${x.entry}  orig=${x.orig} got=${x.got}`)
  }
}

// Control group: how much breaks if legacyHash is omitted (= pako 3 default)
{
  const buf = readFileSync(files[0])
  const es = readZipEntries(buf).filter((e) => e.method === 8)
  let defaultMatch = 0
  for (const e of es) {
    const raw = inflateRaw(e.compressed)
    const re = deflateRaw(raw, { level: 2, memLevel: 9, strategy: 0 })
    if (eq(re, e.compressed)) defaultMatch++
  }
  console.log(
    `\ncontrol (legacyHash omitted, ${files[0].split('/').pop()}): ${defaultMatch}/${es.length} match`,
  )
}

process.exit(failures.length === 0 ? 0 : 1)
