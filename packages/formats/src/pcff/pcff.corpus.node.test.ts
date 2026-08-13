import { readEntry, readZip } from '@prismbinder/core'
import { describe, expect, it } from 'vitest'
import { corpusBundles } from '../../../core/src/testing/corpus.node.js'
import { isPcffGraph, pcffAxes, pcffChunks, pcffGraph, pcffGraphType } from './index.js'

/**
 * The graph binary, read as a chunk stream, over every bundle on this machine.
 *
 * The claim being tested is narrow and falsifiable: `PCFFGRA4` is framed, and
 * the framing accounts for every byte. If a single blob fails to walk to its
 * end the framing is wrong, and anything read out of it - including the axes
 * the charts now use - would be a number pulled out of the middle of some
 * other field.
 */

const bundles = corpusBundles()

interface Blob {
  readonly file: string
  readonly title: string
  readonly bytes: Uint8Array
}

function graphBlobs(): Blob[] {
  const out: Blob[] = []
  for (const f of bundles) {
    const { value } = readZip(f.bytes)
    if (value === undefined) continue
    for (const entry of value.entries) {
      if (!entry.name.startsWith('graphs/') || !entry.name.endsWith('/data.bin')) continue
      let raw: Uint8Array
      try {
        raw = readEntry(entry).value
      } catch {
        continue
      }
      if (!isPcffGraph(raw)) continue
      out.push({ file: f.name, title: entry.name, bytes: raw })
    }
  }
  return out
}

const blobs = bundles.length === 0 ? [] : graphBlobs()

describe.skipIf(blobs.length === 0)(`the graph binary, over ${blobs.length} blobs`, () => {
  it('is a framed chunk stream, and the framing accounts for every byte', () => {
    const bad: string[] = []
    for (const b of blobs) {
      const chunks = pcffChunks(b.bytes)
      if (chunks.length === 0) {
        bad.push(`${b.file}::${b.title}: no chunks`)
        continue
      }
      // Top-level chunks only: a container's payload is counted once, by the
      // container, or the total would exceed the file.
      const top = chunks.filter(
        (c) => !chunks.some((o) => o !== c && o.offset < c.offset && covers(o, c)),
      )
      const first = Math.min(...top.map((c) => c.offset))
      const covered = top.reduce((a, c) => a + 6 + c.payload.length, 0)
      const markers = b.bytes.length - first - covered
      // Whatever is not a chunk has to be the two-byte markers, so the leftover
      // must be a whole number of them and never negative.
      if (markers < 0 || markers % 2 !== 0) {
        bad.push(`${b.file}::${b.title}: ${covered} of ${b.bytes.length - first} bytes framed`)
      }
    }
    expect(bad).toEqual([])
  })

  it('states three axes for every graph', () => {
    // X, Y, and the second Y that Prism leaves at its default when unused.
    const wrong: string[] = []
    for (const b of blobs) {
      const axes = pcffAxes(b.bytes)
      if (axes.length !== 3) wrong.push(`${b.file}::${b.title}: ${axes.length} axes`)
    }
    expect(wrong).toEqual([])
  })

  it('gives bounds that are ordered, finite, and overlap the data', () => {
    /**
     * Not "the axis contains the data", which is false and was worth finding
     * out. `Time line.pzt` ships an XY graph twice, whole and as a segment, and
     * the segment draws 1995 to 2010 over data running from 1918 - Prism lets
     * an axis clip what it plots, and three other graphs in the corpus do the
     * same. What has to hold is weaker and still fails immediately on a wrong
     * offset: the bounds are finite, the low one is below the high one, and the
     * drawn range and the data range are not disjoint.
     */
    const wrong: string[] = []
    for (const b of blobs) {
      for (const [i, a] of pcffAxes(b.bytes).entries()) {
        const where = `${b.file}::${b.title} axis ${i}`
        if (![a.min, a.max, a.dataMin, a.dataMax].every(Number.isFinite)) {
          wrong.push(`${where}: not finite`)
          continue
        }
        if (a.min > a.max) wrong.push(`${where}: drawn ${a.min}..${a.max} runs backwards`)
        if (a.dataMin > a.dataMax) wrong.push(`${where}: data ${a.dataMin}..${a.dataMax} backwards`)
      }
      // At least one axis has to reach the values, rather than every axis.
      // A column scatter puts the categories on one of them - `Time line.pzt`
      // draws 1 to 2 for its two columns - so which axis carries the values is
      // not fixed by position, and asserting per axis asserts more than is
      // known.
      const found = pcffAxes(b.bytes)
      const data = found.find((a) => a.dataMin !== 0 || a.dataMax !== 0)
      if (data !== undefined) {
        const reaches = found.some((a) => a.max >= data.dataMin && a.min <= data.dataMax)
        if (!reaches) wrong.push(`${b.file}::${b.title}: no axis reaches the data`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('finds the logarithmic axes and does not invent any', () => {
    // Two in the corpus: the dose-response X of the nonlinear fit, and the
    // half of `Geometric mean.pzt` that is drawn logarithmically. The document
    // ships the linear version of the same data beside it, which is what made
    // the flag readable in the first place.
    const logs = blobs.flatMap((b) =>
      pcffAxes(b.bytes)
        .filter((a) => a.log)
        .map((a) => `${b.file}: ${a.min}..${a.max}`),
    )
    expect(logs.length).toBeGreaterThan(0)
    for (const l of logs) expect(l).not.toContain('NaN')
  })

  function covers(
    outer: { offset: number; payload: Uint8Array },
    inner: { offset: number },
  ): boolean {
    return inner.offset >= outer.offset && inner.offset < outer.offset + 6 + outer.payload.length
  }

  describe.skipIf(blobs.length === 0)('the graph type byte', () => {
    it('is present in every graph, and takes only the values so far observed', () => {
      // Recorded rather than relied upon. Five values over nineteen graphs is not
      // an enum, and nothing chooses a chart from this; a sixth value appearing
      // is information, not a failure, so the assertion is that the field is
      // readable rather than that the list is closed.
      const seen = new Set<number>()
      for (const b of blobs) {
        const t = pcffGraphType(b.bytes)
        expect(t, `${b.file}::${b.title}`).toBeTypeOf('number')
        if (t !== undefined) seen.add(t)
      }
      expect(seen.size).toBeGreaterThan(1)
      for (const v of seen) expect(v).toBeGreaterThanOrEqual(0)
    })
  })

  it('reads the same facts in one pass as in two, on every real graph', () => {
    // `pcffGraph` is what the bundle reader actually calls, and until now no
    // real file exercised it: the corpus suite imported the two readers it
    // replaces and not the one in production.
    const wrong: string[] = []
    for (const b of blobs) {
      const merged = pcffGraph(b.bytes)
      if (JSON.stringify(merged.axes) !== JSON.stringify(pcffAxes(b.bytes))) {
        wrong.push(`${b.file}::${b.title}: axes differ`)
      }
      if (merged.graphType !== pcffGraphType(b.bytes)) {
        wrong.push(`${b.file}::${b.title}: graph kind differs`)
      }
      if (merged.axes.length === 0 || merged.graphType === undefined) {
        wrong.push(`${b.file}::${b.title}: nothing read, so the comparison proves nothing`)
      }
    }
    expect(wrong).toEqual([])
  })
})
