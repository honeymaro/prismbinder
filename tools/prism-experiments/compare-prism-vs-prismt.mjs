/**
 * Structural comparison: real `.prism` documents vs the `.prismt` templates
 * that ship with Prism.
 *
 * Context: the reverse-engineering corpus contained ZERO `.prism` files - every
 * modern-format sample GraphPad ships is a `.prismt` template. Since `create()`
 * is committed scope, we were about to write a format we had never observed.
 * This script closes that gap.
 *
 * PRIVACY: the .prism inputs are real research data. This script deliberately
 * reports STRUCTURE ONLY - entry layout, JSON key names, enum values, counts.
 * It never prints cell values, sheet titles, notes or user identity.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inflateRaw } from 'pako'

const SIG_EOCD = 0x06054b50
const SIG_CD = 0x02014b50

function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
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
    if (dv.getUint32(off, true) !== SIG_CD) throw new Error('bad CD signature')
    const flag = dv.getUint16(off + 8, true)
    const method = dv.getUint16(off + 10, true)
    const compSize = dv.getUint32(off + 20, true)
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    const createVer = dv.getUint16(off + 4, true)
    const extractVer = dv.getUint16(off + 6, true)
    const externalAttr = dv.getUint32(off + 38, true)
    const localOff = dv.getUint32(off + 42, true)
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen))
    const lNameLen = dv.getUint16(localOff + 26, true)
    const lExtraLen = dv.getUint16(localOff + 28, true)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    entries.push({
      name,
      method,
      flag,
      createVer,
      extractVer,
      externalAttr,
      extraLen,
      compressed: buf.subarray(dataStart, dataStart + compSize),
    })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

const read = (e) => (e.method === 8 ? inflateRaw(e.compressed) : e.compressed)
const text = (e) => new TextDecoder().decode(read(e))

/** Replace every leaf value with its type, so we compare shape not content. */
function shape(v) {
  if (Array.isArray(v)) return v.length === 0 ? '[]' : [shape(v[0])]
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v)) o[k] = shape(v[k])
    return o
  }
  return typeof v
}

function keyPaths(v, prefix = '', out = new Set()) {
  if (Array.isArray(v)) {
    if (v.length) keyPaths(v[0], `${prefix}[]`, out)
    return out
  }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      // Normalise UUID-shaped keys so we compare structure, not identifiers
      const nk = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f-]{27}$/.test(k) ? '<uuid>' : k
      const p = prefix ? `${prefix}.${nk}` : nk
      out.add(p)
      keyPaths(v[k], p, out)
    }
  }
  return out
}

function collect(dir, ext) {
  const out = []
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const n of names) {
    const p = join(dir, n)
    if (!statSync(p).isFile() || !n.toLowerCase().endsWith(ext)) continue
    const buf = readFileSync(p)
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) continue
    out.push({ path: p, name: n, buf })
  }
  return out
}

/**
 * Where to look, from the environment rather than from a literal.
 *
 * The documents this was written against are somebody's unpublished research
 * data, and a hardcoded path both names a private directory and makes the
 * script useless on any other machine. PRISMBINDER_CORPUS_DIRS is the same
 * variable the corpus tests read.
 *
 *   PRISMBINDER_CORPUS_DIRS="D:/my-prism-files" node compare-prism-vs-prismt.mjs
 */
const EXTRA = (process.env.PRISMBINDER_CORPUS_DIRS ?? '')
  .split(';')
  .map((d) => d.trim())
  .filter(Boolean)

const TEMPLATE_DIRS = [
  'C:/Program Files/GraphPad/Prism/SampleData/MultipleVariables',
  'C:/Program Files/GraphPad/Prism/Portfolio/Graphs to explore',
]

const DOCS = EXTRA.flatMap((d) => collect(d, '.prism'))
const TMPLS = [...EXTRA, ...TEMPLATE_DIRS].flatMap((d) => collect(d, '.prismt'))

if (DOCS.length === 0) {
  console.error('No .prism documents found. Set PRISMBINDER_CORPUS_DIRS to a directory holding some.')
  process.exit(2)
}

console.log(`.prism  documents: ${DOCS.length}`)
console.log(`.prismt templates: ${TMPLS.length}\n`)

function analyse(group, label) {
  const topDirs = new Map()
  const entryShapes = new Map()
  const docKeys = new Set()
  const zipMeta = new Map()
  const versions = new Map()
  let totalEntries = 0

  for (const f of group) {
    const entries = readZip(f.buf)
    totalEntries += entries.length
    for (const e of entries) {
      const top = e.name.split('/')[0]
      topDirs.set(top, (topDirs.get(top) ?? 0) + 1)
      const norm = e.name.replace(/[0-9A-Fa-f]{8}-[0-9A-Fa-f-]{27}/g, '<uuid>')
      entryShapes.set(norm, (entryShapes.get(norm) ?? 0) + 1)
      if (!e.name.endsWith('/')) {
        const k = `cv=${e.createVer} ev=${e.extractVer} flag=0x${e.flag.toString(16)} m=${e.method} attr=0x${e.externalAttr.toString(16)} extra=${e.extraLen}`
        zipMeta.set(k, (zipMeta.get(k) ?? 0) + 1)
      }
    }
    const docEntry = entries.find((e) => e.name === 'document.json')
    if (docEntry) {
      const doc = JSON.parse(text(docEntry))
      for (const p of keyPaths(doc)) docKeys.add(p)
      const v = `${doc.formatVersion} / min ${doc.minFormatVersion} / prism ${doc.minPrismVersion}`
      versions.set(v, (versions.get(v) ?? 0) + 1)
    }
  }

  console.log(`== ${label} ==`)
  console.log(`entries total: ${totalEntries}`)
  console.log('top-level sections:', [...topDirs.entries()].map(([k, v]) => `${k}(${v})`).join(' '))
  console.log('versions:')
  for (const [k, v] of versions) console.log(`   ${k}  x${v}`)
  console.log('ZIP entry metadata variants:')
  for (const [k, v] of [...zipMeta].sort((a, b) => b[1] - a[1])) console.log(`   ${k}  x${v}`)
  return { entryShapes, docKeys, topDirs }
}

const D = analyse(DOCS, '.prism documents')
console.log()
const T = analyse(TMPLS, '.prismt templates')

console.log('\n== DIFFERENCES ==')
const onlyDoc = [...D.docKeys].filter((k) => !T.docKeys.has(k)).sort()
const onlyTmpl = [...T.docKeys].filter((k) => !D.docKeys.has(k)).sort()
console.log(`document.json keys only in .prism  (${onlyDoc.length}):`)
for (const k of onlyDoc) console.log(`   + ${k}`)
console.log(`document.json keys only in .prismt (${onlyTmpl.length}):`)
for (const k of onlyTmpl) console.log(`   - ${k}`)

const shapesOnlyDoc = [...D.entryShapes.keys()].filter((k) => !T.entryShapes.has(k)).sort()
const shapesOnlyTmpl = [...T.entryShapes.keys()].filter((k) => !D.entryShapes.has(k)).sort()
console.log(`\nentry shapes only in .prism  (${shapesOnlyDoc.length}):`)
for (const k of shapesOnlyDoc) console.log(`   + ${k}`)
console.log(`entry shapes only in .prismt (${shapesOnlyTmpl.length}):`)
for (const k of shapesOnlyTmpl) console.log(`   - ${k}`)

// Smallest document: what is the minimum entry set actually observed?
const smallest = DOCS.reduce((a, b) => (a.buf.length <= b.buf.length ? a : b))
console.log(`\n== SMALLEST .prism - entry inventory (${smallest.buf.length} bytes) ==`)
const inv = new Map()
for (const e of readZip(smallest.buf)) {
  const norm = e.name.replace(/[0-9A-Fa-f]{8}-[0-9A-Fa-f-]{27}/g, '<uuid>')
  inv.set(norm, (inv.get(norm) ?? 0) + 1)
}
for (const [k, v] of [...inv].sort()) console.log(`   ${String(v).padStart(3)} x ${k}`)

// document.json shape of one real document, values replaced by types
console.log('\n== .prism document.json SHAPE (types only, no values) ==')
{
  const doc = JSON.parse(text(readZip(smallest.buf).find((e) => e.name === 'document.json')))
  const s = shape(doc)
  // uiSettings.printer is a Win32 DEVMODE dump; collapse it
  if (s.uiSettings?.printer) s.uiSettings.printer = '{...DEVMODE fields...}'
  if (s.sheetAttributesMap) s.sheetAttributesMap = '{<uuid>: {title, highlightColor}}'
  console.log(JSON.stringify(s, null, 1))
}
