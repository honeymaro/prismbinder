import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { crc32, deflateRaw, writeZip, type ZipArchive, type ZipEntry } from '@prismbinder/core'
import { createBundle } from '@prismbinder/formats'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The CLI, driven as a process.
 *
 * Exit codes and stdout/stderr separation are the contract scripts depend on,
 * and neither is observable from a unit test of the functions underneath.
 * `extract` in particular writes attacker-named files to disk, which is the
 * most security-sensitive thing this project does.
 */

const CLI = resolve('packages/cli/dist/cli.js')
let dir = ''

/**
 * A minimal but real `.pzfx`: CRLF endings, one table, one column, one cell.
 *
 * `SECRETVALUE` is there so a test can assert it never reaches stdout, and the
 * whole document is reused by `verify` so both commands are exercised against
 * the same bytes.
 */
const PZFX =
  '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
  '<GraphPadPrismFile PrismXMLVersion="5.00">\r\n' +
  '<Table ID="T0" XFormat="none" YFormat="none" Replicates="1" TableType="XY">\r\n' +
  '<Title>T</Title>\r\n' +
  '<YColumn Width="81" Decimals="6" Subcolumns="1"><Title>A</Title>' +
  '<Subcolumn><d>SECRETVALUE</d></Subcolumn></YColumn>\r\n' +
  '</Table>\r\n</GraphPadPrismFile>\r\n'

interface Run {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * `spawnSync`, not `execFileSync`: the latter returns stdout and throws away
 * stderr whenever the command succeeds, which is exactly the case where this
 * suite needs to read warnings.
 */
function run(...args: string[]): Run {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'prismbinder-cli-'))
  writeFileSync(
    join(dir, 'sample.prism'),
    createBundle({
      tables: [{ title: 'Sheet', columns: [{ title: 'A', cells: ['1', '2'] }] }],
      creationDate: '2026-01-01T00:00:00Z',
    }),
  )
})

describe.skipIf(!existsSync(CLI))('exit codes', () => {
  it('reports usage on stderr, not stdout, when given nothing', () => {
    const r = run()
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('prismbinder')
    // Help text on stdout reads as a successful result to anything piping it.
    expect(r.stdout).toBe('')
  })

  it('puts --help on stdout and succeeds', () => {
    const r = run('--help')
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('prismbinder')
  })

  it('rejects an unknown command', () => {
    expect(run('frobnicate').code).toBe(2)
  })

  it('reports a missing file rather than crashing', () => {
    const r = run('inspect', join(dir, 'nope.prism'))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('cannot read')
  })

  it('reports a missing CSV for `new` the same way', () => {
    // This path used to bypass the shared reader and die with a stack trace.
    const r = run('new', join(dir, 'out.prism'), join(dir, 'nope.csv'))
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('cannot read')
  })
})

describe.skipIf(!existsSync(CLI))('inspect --json', () => {
  it('does not print cell values for a bundle', () => {
    const r = run('inspect', join(dir, 'sample.prism'), '--json')
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain('subcolumns')
  })

  it('does not print cell values for an XML document either', () => {
    // The two branches of this command must agree: `--json` output lands in
    // files, bug reports and CI logs, and part of the corpus is unpublished
    // research data.
    const xml = join(dir, 'doc.pzfx')
    writeFileSync(xml, PZFX)
    const r = run('inspect', xml, '--json')
    expect(r.stdout).not.toContain('SECRETVALUE')
    expect(r.stdout).toContain('"sheets"')
  })
})

describe.skipIf(!existsSync(CLI))('export', () => {
  /** One excluded cell, which Prism keeps visible but uses nowhere. */
  const EXCLUDED =
    '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
    '<GraphPadPrismFile PrismXMLVersion="5.00">\r\n' +
    '<Table ID="T0" XFormat="none" TableType="OneWay" Replicates="1">\r\n' +
    '<Title>T</Title>\r\n' +
    '<YColumn Width="81" Decimals="1" Subcolumns="1"><Title>A</Title>' +
    '<Subcolumn><d>10</d><d Excluded="1">999</d></Subcolumn></YColumn>\r\n' +
    '</Table>\r\n</GraphPadPrismFile>\r\n'

  function exportWith(...extra: string[]): { result: Run; csv: string } {
    const src = join(dir, 'excluded.pzfx')
    writeFileSync(src, EXCLUDED)
    const out = mkdtempSync(join(tmpdir(), 'prismbinder-export-'))
    const result = run('export', src, out, ...extra)
    const file = readdirSync(out).find((f) => f.endsWith('.csv')) as string
    return { result, csv: readFileSync(join(out, file), 'utf8') }
  }

  it('says how many values Prism excludes, whatever the policy', () => {
    // Emitting them unmarked is a legitimate choice - Prism offers it too - but
    // making it silently turns "the data" into "the data plus values Prism
    // throws away", with nothing in the output to say so.
    const { result, csv } = exportWith()
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/1 cell\(s\) are excluded/)
    expect(csv).toContain('999')
  })

  it('can blank or mark them instead', () => {
    expect(exportWith('--excluded', 'blank').csv).not.toContain('999')
    expect(exportWith('--excluded', 'asterisk').csv).toContain('999*')
  })

  it('reports the marked rows in --json, where a cell can hold structure', () => {
    // A CSV cell can only be blanked or starred. JSON can say which rows they
    // were, so it does, whatever the policy.
    const src = join(dir, 'excluded.pzfx')
    writeFileSync(src, EXCLUDED)
    const out = mkdtempSync(join(tmpdir(), 'prismbinder-export-'))
    expect(run('export', src, out, '--json').code).toBe(0)
    const file = readdirSync(out).find((f) => f.endsWith('.json')) as string
    const table = JSON.parse(readFileSync(join(out, file), 'utf8'))
    expect(table.columns[0].excludedRows).toEqual([[1]])
    expect(table.columns[0].censoredRows).toEqual([[]])
  })

  it('rejects a policy it does not have', () => {
    const r = run('export', join(dir, 'sample.prism'), dir, '--excluded', 'maybe')
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('--excluded must be one of')
  })
})

describe.skipIf(!existsSync(CLI))('diff', () => {
  it('exits 0 when a file is compared with itself', () => {
    expect(run('diff', join(dir, 'sample.prism'), join(dir, 'sample.prism')).code).toBe(0)
  })

  it('does not report equality when an input cannot be read', () => {
    // "No differences" and "I could not tell" must not share an exit code:
    // this command is documented as a scriptable equality check.
    const junk = join(dir, 'junk.pzfx')
    writeFileSync(junk, 'not a prism file')
    const r = run('diff', join(dir, 'sample.prism'), junk)
    expect(r.code).not.toBe(0)
  })
})

describe.skipIf(!existsSync(CLI))('verify', () => {
  it('round-trips a bundle byte-for-byte', () => {
    const r = run('verify', join(dir, 'sample.prism'))
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('byte-identical round trip')
  })

  it('round-trips an XML document too', () => {
    // The command exists to prove byte fidelity, and for a while it only knew
    // how to do that for ZIP bundles - so the format where fidelity is the
    // harder problem was the one it could not check.
    const xml = join(dir, 'doc.pzfx')
    writeFileSync(xml, PZFX)
    const r = run('verify', xml)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('byte-identical round trip')
  })

  it('reports a file it cannot parse, and says why', () => {
    const junk = join(dir, 'broken.pzfx')
    writeFileSync(junk, 'not xml at all')
    const r = run('verify', junk)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('could not be parsed')
    expect(r.stderr, 'a bare refusal tells the user nothing').toMatch(/xml\//)
  })
})

describe.skipIf(!existsSync(CLI))('extract', () => {
  it('refuses entries that would escape or hide, and keeps going', () => {
    // Hand-built archive: only the last entry is a legitimate name.
    const zip = join(dir, 'hostile.zip')
    writeFileSync(zip, hostileArchive())

    const out = join(dir, 'out')
    mkdirSync(out, { recursive: true })
    const r = run('extract', zip, out)

    expect(r.stderr).toContain('skipping unsafe entry name')
    const written = readdirSync(out)
    expect(written).toEqual(['ok.txt'])
    // Nothing beside the output directory.
    expect(existsSync(join(dir, 'PWNED.txt'))).toBe(false)
  })
})

/**
 * An archive naming things no extractor should write to disk.
 *
 * Built with our own writer rather than by hand: the point of the test is what
 * `extract` does with the names, and hand-assembled headers only add a second
 * thing that can be wrong.
 */
function hostileArchive(): Uint8Array {
  const names = ['../../PWNED.txt', '/abs.txt', 'readme.txt:ads', 'CON.txt', 'ok.txt']
  const body = new TextEncoder().encode('x')
  const stored = deflateRaw(body)

  const entries: ZipEntry[] = names.map((name) => ({
    name,
    isDirectory: false,
    stored,
    meta: {
      createVersion: 0x033f,
      extractVersion: 20,
      localExtractVersion: 20,
      flag: 4,
      method: 8,
      dosTime: 0,
      dosDate: 0,
      crc32: crc32(body),
      compressedSize: stored.length,
      uncompressedSize: body.length,
      internalAttrs: 0,
      externalAttrs: 0,
      diskStart: 0,
      extraCentral: new Uint8Array(0),
      extraLocal: new Uint8Array(0),
      comment: new Uint8Array(0),
    },
  }))

  const archive: ZipArchive = { entries, comment: new Uint8Array(0) }
  return writeZip(archive)
}
