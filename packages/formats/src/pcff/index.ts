/**
 * Reading what can be read out of Prism's graph binary.
 *
 * Most Prism graphs keep their geometry in `PCFFGRA4`, a format GraphPad has
 * never published and nothing outside Prism decodes. This project carries that
 * blob through byte for byte and does not pretend to draw it. What follows is
 * narrower and checkable: the blob is a stream of tagged, length-prefixed
 * chunks, and two of those chunks say something worth using.
 *
 *     <u16 tag> <u32 length> <length bytes>
 *
 * Tags with bit 0x4000 set and 0x8000 clear are markers: two bytes, no length,
 * no payload. They sit between chunks, and a reader that treats one as an
 * ordinary header reads its neighbour's bytes as a length and lands nowhere.
 * With that rule the walk covers **every byte of all 70 PCFF blobs on this
 * machine** - the 19 in bundles and the 51 stored as `<Template>` inside the
 * older XML documents - which is the evidence that the framing is right rather
 * than merely plausible.
 *
 * Everything else is stepped over, which is the point of a framed format and
 * the same contract the rest of this project keeps for entries it cannot
 * parse: carry it, do not guess at it.
 *
 * **Nothing here trusts the file's arithmetic.** The bytes come from a
 * stranger. A length is checked against what is left, the nesting is bounded,
 * and the number of chunks is bounded, because each is a lever an attacker
 * holds and none of the limits costs a real document anything. `hostile.test.ts`
 * says what each one is worth.
 *
 * Browser-safe. `Uint8Array` and `DataView`, nothing else.
 */

const MAGIC = [0x50, 0x43, 0x46, 0x46, 0x47, 0x52, 0x41, 0x34] // PCFFGRA4
const MARKER = 0x4000
const PAYLOAD = 0x8000
const HEADER = 6

/**
 * The stream begins immediately after the magic.
 *
 * Found by trying every offset and keeping the ones that consume the blob
 * exactly: offset 8 is the only one that works, and it works for all 70 PCFF
 * blobs on this machine.
 */
const STREAM_START = 8

/**
 * How deep containers may nest before the walk stops descending.
 *
 * **The deepest real graph on this machine nests two levels.** A container
 * costs six bytes, so depth is as cheap as an attacker cares to make it: a
 * 60 KB file of containers wrapping containers recursed ten thousand deep and
 * threw `RangeError: Maximum call stack size exceeded`. In the editor that
 * became a document that never loaded, with no message, because the worker
 * error falls back to the main thread and throws there too. The walk is
 * iterative now, and this is the second line of defence at thirty times the
 * deepest nesting Prism has ever written here.
 */
const MAX_DEPTH = 64

/**
 * How many chunks may be visited before the walk gives up.
 *
 * The smallest chunk is a six-byte header with no payload, so a blob of those
 * yields one per six bytes. Measured: 32 MB of empty chunks produced 5.6
 * million of them and 888 MB of heap, and the ZIP layer admits entries up to
 * 256 MB. The largest real graph holds 569 chunks.
 */
const MAX_CHUNKS = 100_000

const AXIS_TAG = 0x0017
const AXIS_LEN = 60
const TYPE_TAG = 0x0013
const TYPE_OFFSET = 14

export interface PcffChunk {
  readonly tag: number
  readonly offset: number
  readonly payload: Uint8Array
}

export function isPcffGraph(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false
  return MAGIC.every((b, i) => bytes[i] === b)
}

/**
 * Visits every chunk, depth first, and stops when the visitor says so.
 *
 * Iterative rather than recursive, and it is the only walk in this module:
 * everything below is written in terms of it, so no reader can reintroduce an
 * unbounded descent. A visitor returning `false` ends the walk, which is what
 * lets a reader wanting one chunk avoid touching the rest of the blob.
 */
function scan(bytes: Uint8Array, visit: (chunk: PcffChunk) => boolean | void): void {
  if (!isPcffGraph(bytes)) return
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // Ranges still to walk, innermost last, so a container's children are read
  // before whatever follows it.
  const pending: { off: number; end: number; depth: number }[] = [
    { off: STREAM_START, end: bytes.length, depth: 0 },
  ]
  let seen = 0

  while (pending.length > 0) {
    const frame = pending[pending.length - 1] as { off: number; end: number; depth: number }
    if (frame.off + 2 > frame.end) {
      pending.pop()
      continue
    }

    const off = frame.off
    const tag = view.getUint16(off, true)
    if ((tag & MARKER) !== 0 && (tag & PAYLOAD) === 0) {
      frame.off = off + 2
      continue
    }
    if (off + HEADER > frame.end) {
      pending.pop()
      continue
    }
    const length = view.getUint32(off + 2, true)
    // A length past the end means the framing was misread. Stop rather than
    // wander, since anything read after that point would be invented.
    if (length > frame.end - off - HEADER) {
      pending.pop()
      continue
    }

    const from = off + HEADER
    frame.off = from + length
    if (++seen > MAX_CHUNKS) return
    if (visit({ tag, offset: off, payload: bytes.subarray(from, from + length) }) === false) return

    // A container's payload is more chunks. Deeper than any real graph goes is
    // a file built to be deep, and its payload is left unread rather than
    // followed.
    if ((tag & PAYLOAD) !== 0 && frame.depth < MAX_DEPTH) {
      pending.push({ off: from, end: from + length, depth: frame.depth + 1 })
    }
  }
}

/**
 * Every chunk, depth first.
 *
 * Collects, so it costs memory in proportion to the blob, bounded by
 * `MAX_CHUNKS`. Readers in this module use `scan` instead; this is for the
 * corpus test and for tooling, both of which want the whole tree.
 */
export function pcffChunks(bytes: Uint8Array): PcffChunk[] {
  const out: PcffChunk[] = []
  scan(bytes, (c) => {
    out.push(c)
  })
  return out
}

export interface PcffAxis {
  /** Lowest and highest value actually plotted. */
  readonly dataMin: number
  readonly dataMax: number
  /** Where the drawn axis begins and ends, in data units. */
  readonly min: number
  readonly max: number
  readonly log: boolean
}

/**
 * The axes of a graph, in the order the file writes them. Every graph in the
 * corpus states exactly three.
 *
 * **Which axis is which is not settled.** For most graphs the order reads as
 * X, Y, then the second Y left at its default; but the column scatter in
 * `Time line.pzt` draws 0 to 8 on the first and 1 to 2 on the second, and its
 * values run 2.6 to 7.1 - so there the first carries the values and the second
 * counts the two columns. Position alone does not say, and this function does
 * not claim otherwise. A caller that needs to know should match the bounds
 * against the data it is about to plot.
 *
 * The layout of the 60-byte chunk:
 *
 *     +0   double  lowest value plotted
 *     +8   double  highest value plotted
 *     +16  double  where the drawn axis starts
 *     +24  double  where it ends
 *     +32  double  where it crosses the other axis
 *     +46  u16     0 linear, 1 logarithmic
 *
 * A logarithmic axis stores its bounds as powers of ten, so `-1` and `3` mean
 * 0.1 and 1000. That reading is not a guess: `Geometric mean.pzt` ships the
 * same data drawn twice, titled "Linear axis" and "Logarithmic axis", and
 * inside this chunk the two differ in exactly the bounds and this flag. The
 * data pair is checkable against the source table, and matches to the last
 * digit for every graph in the corpus whose table can be found.
 */
export function pcffAxes(bytes: Uint8Array): PcffAxis[] {
  const out: PcffAxis[] = []
  scan(bytes, (chunk) => {
    if (chunk.tag !== AXIS_TAG || chunk.payload.length < AXIS_LEN) return
    const p = chunk.payload
    const view = new DataView(p.buffer, p.byteOffset, p.byteLength)
    const dataMin = view.getFloat64(0, true)
    const dataMax = view.getFloat64(8, true)
    const rawMin = view.getFloat64(16, true)
    const rawMax = view.getFloat64(24, true)
    const log = view.getUint16(46, true) === 1
    if (![dataMin, dataMax, rawMin, rawMax].every(Number.isFinite)) return
    out.push({
      dataMin,
      dataMax,
      min: log ? 10 ** rawMin : rawMin,
      max: log ? 10 ** rawMax : rawMax,
      log,
    })
  })
  return out
}

/**
 * The kind of graph, as Prism numbers them.
 *
 * There is no graph-type field in the header - bytes 8 to 32 are identical
 * across all 70 PCFF blobs on this machine, from both file generations - but
 * there is one inside a chunk: the byte at +14 of a 0x0013 chunk varies with
 * what the graph is.
 *
 * **A blob does not always hold exactly one.** Each of the 19 bundle blobs
 * does, which is why this returns the first and why that is right for them.
 * The 51 blobs stored as `<Template>` cover a whole document at once: 36 hold
 * one, 12 hold between two and thirteen, and 3 hold none. So this answers for
 * the first graph in a blob, which is the only graph in every bundle.
 *
 * **It is the graph's kind, not the table's.** That is the reading worth
 * establishing, and the shipped documents establish it: a `OneWay` column table
 * produces six different values depending only on how it was drawn.
 *
 * | Value | Documents drawn that way |
 * |---|---|
 * | 0 | 21 XY documents, plus Bland-Altman, Spaghetti plot, Insert a picture |
 * | 1 | Pie chart, Donut plot, Percentage dot plot, Bubble Plot, Rainbow scatter, Points and grouped bars, Cox Sample Data |
 * | 2 | Bars extending left and right, Population pyramid, Odds ratio (Forest plot) |
 * | 3 | Column scatter, Line between groups, QC graph, Scatter plot with bars |
 * | 4 | Box and whiskers graph, Box and whiskers with asterisks |
 * | 5 | Adjust spacing between bars, Grouped graph spacing |
 * | 8 | Before-after, Before-after with error, a paired t test estimation plot |
 *
 * The names are GraphPad's own, from the file names of the Portfolio samples,
 * which is what makes this readable at all: those documents are one graph each
 * and titled after the graph they demonstrate. Every value except 1 is drawn by
 * documents that agree with each other, and all three of value 2 are horizontal
 * bar charts.
 *
 * **Value 1 is a family, not a type**, and is deliberately left unmapped by
 * callers. It covers pie, donut, percentage dot plot, bubble plot, rainbow
 * scatter, grouped bars and Cox. A second field narrows it: byte +29 of the
 * same chunk is a flags byte, and its bit 0x08 is set on exactly the three
 * parts-of-whole documents in the corpus and nowhere else among the 97 chunks
 * that carry one.
 * Two more bytes are copies: +38 repeats this one in all 97 chunks without
 * exception, and +40 does too apart from six chunks that read 12 while +14
 * reads 1 - two in `Bubble Plot.pzt` and four in `Cox Sample Data.pzfx`. What
 * those two have in common is not known.
 *
 * None of that is mapped, because none of it would change a chart. The
 * parts-of-whole tables already declare themselves as such and already get a
 * pie; the bit cannot tell a pie from the percentage dot plot that shares it;
 * and 12 for a bubble plot would select a chart kind this project has no
 * builder for, so it would draw nothing where it now draws a scatter. What
 * separates a pie from a percentage dot plot, or a rainbow scatter from
 * grouped bars, needs more documents than the one apiece the corpus holds.
 *
 * Values above 8 have never been seen, so nothing is known about survival,
 * contingency or nested graphs.
 */
export function pcffGraphType(bytes: Uint8Array): number | undefined {
  let found: number | undefined
  scan(bytes, (chunk) => {
    if (chunk.tag !== TYPE_TAG || chunk.payload.length <= TYPE_OFFSET) return
    found = chunk.payload[TYPE_OFFSET]
    return false
  })
  return found
}

/**
 * Both facts, from one pass.
 *
 * The reader above walks the blob once for the axes and the one below walks it
 * again for the kind. A caller that wants both should take them together, so a
 * bundle inflates and walks each graph binary once rather than twice.
 */
export function pcffGraph(bytes: Uint8Array): {
  readonly axes: readonly PcffAxis[]
  readonly graphType: number | undefined
} {
  const axes: PcffAxis[] = []
  let graphType: number | undefined
  scan(bytes, (chunk) => {
    if (chunk.tag === TYPE_TAG && graphType === undefined && chunk.payload.length > TYPE_OFFSET) {
      graphType = chunk.payload[TYPE_OFFSET]
      return
    }
    if (chunk.tag !== AXIS_TAG || chunk.payload.length < AXIS_LEN) return
    const p = chunk.payload
    const view = new DataView(p.buffer, p.byteOffset, p.byteLength)
    const dataMin = view.getFloat64(0, true)
    const dataMax = view.getFloat64(8, true)
    const rawMin = view.getFloat64(16, true)
    const rawMax = view.getFloat64(24, true)
    const log = view.getUint16(46, true) === 1
    if (![dataMin, dataMax, rawMin, rawMax].every(Number.isFinite)) return
    axes.push({
      dataMin,
      dataMax,
      min: log ? 10 ** rawMin : rawMin,
      max: log ? 10 ** rawMax : rawMax,
      log,
    })
  })
  return { axes, graphType }
}
