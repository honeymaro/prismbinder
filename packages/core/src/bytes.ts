/** Byte-level helpers shared by the codecs. Web APIs only - no Node built-ins. */

const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

/** CRC-32 (IEEE 802.3), as used by ZIP. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ (data[i] as number)) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

const utf8Encoder = /* @__PURE__ */ new TextEncoder()

/**
 * `ignoreBOM: true` is load-bearing, despite reading like the opposite.
 *
 * It means "do not treat a leading BOM as a signature to strip", so U+FEFF is
 * decoded as an ordinary character and survives back through TextEncoder. With
 * the default, two XML documents in the corpus lose their BOM on the way in and
 * come out three bytes shorter than they went.
 */
const utf8Decoder = /* @__PURE__ */ new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })

export function encodeUtf8(s: string): Uint8Array {
  return utf8Encoder.encode(s)
}

export function decodeUtf8(b: Uint8Array): string {
  return utf8Decoder.decode(b)
}

/**
 * Sequential little-endian writer that grows as needed.
 *
 * ZIP is little-endian throughout, and every structure is written in one
 * forward pass, so a growable cursor is a better fit than pre-sizing buffers.
 */
export class ByteWriter {
  #buf: Uint8Array
  #view: DataView
  #len = 0

  constructor(initialCapacity = 1024) {
    this.#buf = new Uint8Array(initialCapacity)
    this.#view = new DataView(this.#buf.buffer)
  }

  get length(): number {
    return this.#len
  }

  #ensure(extra: number): void {
    const need = this.#len + extra
    if (need <= this.#buf.length) return
    // Doubling from zero never reaches anything, so the growth base has a
    // floor. `new ByteWriter(0)` is a reasonable thing for a caller to write.
    let cap = Math.max(this.#buf.length, 1) * 2
    while (cap < need) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.#buf.subarray(0, this.#len))
    this.#buf = next
    this.#view = new DataView(next.buffer)
  }

  u16(v: number): void {
    this.#ensure(2)
    this.#view.setUint16(this.#len, v & 0xffff, true)
    this.#len += 2
  }

  u32(v: number): void {
    this.#ensure(4)
    this.#view.setUint32(this.#len, v >>> 0, true)
    this.#len += 4
  }

  bytes(b: Uint8Array): void {
    this.#ensure(b.length)
    this.#buf.set(b, this.#len)
    this.#len += b.length
  }

  finish(): Uint8Array {
    return this.#buf.slice(0, this.#len)
  }
}
