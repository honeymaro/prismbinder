import { describe, expect, it } from 'vitest'
import { isPcffGraph, pcffAxes, pcffChunks, pcffGraph, pcffGraphType } from './index.js'

/**
 * The graph reader against files built to break it.
 *
 * The corpus suite beside this one reads the graphs GraphPad ships, which are
 * well formed by construction and absent on any machine without Prism
 * installed. This one needs nothing installed and is the reason to believe the
 * reader is safe to point at a file a stranger sent, which is what the editor
 * does with every document it opens.
 *
 * Two of the three limits here exist because the first version had neither,
 * and both were measured rather than imagined.
 */

const MAGIC = new Uint8Array([0x50, 0x43, 0x46, 0x46, 0x47, 0x52, 0x41, 0x34])

function blob(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(MAGIC.length + body.length)
  out.set(MAGIC, 0)
  out.set(body, MAGIC.length)
  return out
}

/**
 * `depth` containers, each wrapping the next, costing six bytes a level.
 *
 * Built in one pass. Wrapping one array in another repeatedly is quadratic and
 * a hundred thousand levels of it takes longer than the thing being tested.
 */
function nested(depth: number): Uint8Array {
  const body = new Uint8Array(depth * 6)
  const v = new DataView(body.buffer)
  for (let i = 0; i < depth; i++) {
    v.setUint16(i * 6, 0x8001, true)
    // Everything after this header, which is every container still to come.
    v.setUint32(i * 6 + 2, (depth - i - 1) * 6, true)
  }
  return blob(body)
}

/** `count` chunks with a header and nothing else, the cheapest chunk there is. */
function empties(count: number, tag = 0x0013): Uint8Array {
  const body = new Uint8Array(count * 6)
  const v = new DataView(body.buffer)
  for (let i = 0; i < count; i++) {
    v.setUint16(i * 6, tag, true)
    v.setUint32(i * 6 + 2, 0, true)
  }
  return blob(body)
}

describe('a graph binary built to break the reader', () => {
  it('does not overflow the stack however deeply it nests', () => {
    // Ten thousand levels is 60 KB and used to throw RangeError, which the
    // editor turned into a document that never loaded and no message at all:
    // the worker error falls back to the main thread, which throws again into
    // a promise nobody catches. The deepest real graph nests two.
    for (const depth of [1_000, 10_000, 100_000]) {
      const bytes = nested(depth)
      expect(() => pcffChunks(bytes), `depth ${depth}`).not.toThrow()
      expect(() => pcffAxes(bytes), `depth ${depth}`).not.toThrow()
      expect(() => pcffGraphType(bytes), `depth ${depth}`).not.toThrow()
    }
  })

  it('reads only as deep as any real graph goes', () => {
    // Past the cap a container is left unread rather than followed, so the
    // count stops climbing with the nesting however far it is pushed.
    const deep = pcffChunks(nested(100_000)).length
    const deeper = pcffChunks(nested(400_000)).length
    expect(deep).toBe(deeper)
    // One chunk per level down to the cap, plus the one the cap refuses to
    // descend from.
    // Exactly, not at most. A bound from above alone would still pass if the
    // cap were cut to the two levels a real graph uses, and a legitimate file
    // would then be truncated with nothing to notice: the corpus suite that
    // would catch that is skipped on any machine without Prism installed.
    expect(deep).toBe(65)
  })

  it('does not collect chunks without limit', () => {
    // 32 MB of these produced 5.6 million chunks and 888 MB of heap before the
    // cap existed, and the ZIP layer admits entries up to 256 MB.
    const many = pcffChunks(empties(400_000))
    // Exactly the cap, for the same reason: this pins where the limit is, not
    // merely that one exists.
    expect(many.length).toBe(100_000)
  })

  it('costs a bounded amount of time on a large hostile blob', () => {
    const started = Date.now()
    pcffGraph(empties(2_000_000))
    // Generous: the point is that it returns at all rather than growing with
    // the file.
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('refuses anything that is not a graph binary', () => {
    for (const bytes of [new Uint8Array(0), new Uint8Array(4), new Uint8Array(64)]) {
      expect(isPcffGraph(bytes)).toBe(false)
      expect(pcffChunks(bytes)).toEqual([])
      expect(pcffAxes(bytes)).toEqual([])
      expect(pcffGraphType(bytes)).toBeUndefined()
    }
  })

  it('stops rather than wandering when a length runs past the end', () => {
    const body = new Uint8Array(10)
    const v = new DataView(body.buffer)
    v.setUint16(0, 0x0017, true)
    v.setUint32(2, 0xffffffff, true)
    const chunks = pcffChunks(blob(body))
    expect(chunks).toEqual([])
  })

  it('survives being cut at every length', () => {
    // A real-shaped prefix truncated one byte at a time. Nothing may throw and
    // nothing may report a chunk reaching past what is left.
    const body = new Uint8Array(6 + 60 + 6)
    const v = new DataView(body.buffer)
    v.setUint16(0, 0x0017, true)
    v.setUint32(2, 60, true)
    v.setUint16(66, 0x0013, true)
    const whole = blob(body)
    for (let cut = whole.length; cut >= 0; cut--) {
      const part = whole.subarray(0, cut)
      expect(() => pcffGraph(part), `cut at ${cut}`).not.toThrow()
      for (const c of pcffChunks(part)) {
        expect(c.offset + 6 + c.payload.length, `cut at ${cut}`).toBeLessThanOrEqual(part.length)
      }
    }
  })

  it('does not throw on arbitrary bytes behind the magic', () => {
    let seed = 0x9e3779b9
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % 256
    }
    for (let i = 0; i < 2_000; i++) {
      const body = new Uint8Array(8 + (i % 400))
      for (let k = 0; k < body.length; k++) body[k] = next()
      const bytes = blob(body)
      expect(() => pcffGraph(bytes), `sample ${i}`).not.toThrow()
    }
  })

  it('reads the same facts whether taken together or separately', () => {
    // `pcffGraph` exists so a bundle walks each blob once. It has to agree with
    // the two readers it replaces, or the saving comes out of correctness.
    // The blob carries **both** an axis chunk and a type chunk, which is the
    // shape of every real graph. An earlier version of this test had only an
    // axis chunk, so the graph-kind half compared undefined against undefined
    // and would have passed however wrong the merged reader was.
    const body = new Uint8Array(6 + 60 + 6 + 20)
    const v = new DataView(body.buffer)
    v.setUint16(0, 0x0017, true)
    v.setUint32(2, 60, true)
    v.setFloat64(6 + 0, 1, true)
    v.setFloat64(6 + 8, 42, true)
    v.setFloat64(6 + 16, 0, true)
    v.setFloat64(6 + 24, 50, true)
    const typeAt = 6 + 60
    v.setUint16(typeAt, 0x0013, true)
    v.setUint32(typeAt + 2, 20, true)
    v.setUint8(typeAt + 6 + 14, 4)
    const bytes = blob(body)
    const merged = pcffGraph(bytes)
    expect(merged.axes).toEqual(pcffAxes(bytes))
    expect(merged.graphType).toBe(pcffGraphType(bytes))
    // Both halves carry something, or the agreement above is vacuous.
    expect(merged.axes).toHaveLength(1)
    expect(merged.graphType).toBe(4)
    expect(pcffAxes(bytes)[0]).toMatchObject({
      dataMin: 1,
      dataMax: 42,
      min: 0,
      max: 50,
      log: false,
    })
  })

  it('takes the same graph kind as the separate reader when a blob states several', () => {
    // The merged reader keeps the first and the separate one stops at the
    // first. They have to pick the same one.
    const body = new Uint8Array((6 + 20) * 2)
    const v = new DataView(body.buffer)
    for (const [i, kind] of [3, 8].entries()) {
      const at = i * (6 + 20)
      v.setUint16(at, 0x0013, true)
      v.setUint32(at + 2, 20, true)
      v.setUint8(at + 6 + 14, kind)
    }
    const bytes = blob(body)
    expect(pcffGraphType(bytes)).toBe(3)
    expect(pcffGraph(bytes).graphType).toBe(3)
  })
})
