import { describe, expect, it } from 'vitest'
import { deflateRaw, inflateRaw, PRISM_DEFLATE } from './deflate.js'

/**
 * Golden canary.
 *
 * This test exists to catch silent drift in the deflate encoder. pako has
 * already flipped a default once (3.0.0 changed `legacyHash` to false), and a
 * bundler, a transitive upgrade or a dropped option would all corrupt every
 * file we write while every other test still passed.
 *
 * The hash below was produced by pako 3.0.1 with PRISM_DEFLATE. If it changes,
 * do NOT update the constant - find out what changed about the encoder first.
 * See docs/measurements.md M1.
 */
const CANARY_SHA256 = '6f425e848ff96e7c788e4425e49be1105c867a60d9bd2696c8535812ef5bb54b'

/** Fixed input shaped like Prism's JSON: repetitive, with `X.0` float literals. */
function canaryInput(): Uint8Array {
  let s = ''
  for (let i = 0; i < 128; i++) {
    s += `{"@class":"DataSet","uid":"${i.toString(16).padStart(8, '0')}","n":${i}.0}\n`
  }
  return new TextEncoder().encode(s)
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  // Web Crypto: available in browsers and in Node >= 20, so this test runs
  // unchanged in both Vitest projects.
  const buf = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBufferView<ArrayBuffer>)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('PRISM_DEFLATE', () => {
  it('pins every load-bearing parameter', () => {
    expect(PRISM_DEFLATE).toEqual({
      level: 2,
      memLevel: 9,
      strategy: 0,
      legacyHash: true,
    })
  })

  it('produces the golden canary output', async () => {
    const out = deflateRaw(canaryInput())
    expect(out.length).toBe(631)
    await expect(sha256Hex(out)).resolves.toBe(CANARY_SHA256)
  })

  it('round-trips through inflate', () => {
    const input = canaryInput()
    expect(inflateRaw(deflateRaw(input))).toEqual(input)
  })

  it('differs from the encoder default, proving legacyHash is applied', async () => {
    // Guards against someone "simplifying" deflateRaw by dropping the options.
    const { deflateRaw: raw } = await import('pako')
    const withDefault = raw(canaryInput(), { level: 2, memLevel: 9, strategy: 0 })
    expect(withDefault).not.toEqual(deflateRaw(canaryInput()))
  })
})
