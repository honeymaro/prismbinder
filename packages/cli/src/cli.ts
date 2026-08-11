#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { argv, exit, stderr, stdout } from 'node:process'
import { parseArgs } from 'node:util'
import {
  bytesEqual,
  decodeUtf8,
  isSafeEntryName,
  parseCsv,
  readEntry,
  readZip,
} from '@prismbinder/core'
import {
  anonymizeBundle,
  createBundle,
  readBundle,
  writeBundle,
  writeBundleWith,
} from '@prismbinder/formats'
import { readProject, toBundle, toPzfx } from '@prismbinder/model'
import { buildDiff, formatDiff } from './diff.js'
import { type ExportFormat, exportTables } from './export.js'
import { formatReport, inspectBytes } from './inspect.js'

/**
 * Exit codes are part of the contract:
 *   0  success
 *   1  the file produced error diagnostics
 *   2  usage error
 */
const EXIT_OK = 0
const EXIT_DIAGNOSTICS = 1
const EXIT_USAGE = 2

const USAGE = `prismbinder - tools for GraphPad Prism files

Usage
  prismbinder inspect <file> [--json]     summarise a document
  prismbinder validate <file> [--json]    report diagnostics; exit 1 if any are errors
  prismbinder extract <file> <dir>        write every entry to a directory
  prismbinder verify <file>               check that we can round-trip it byte-for-byte
  prismbinder export <file> <dir> [--json]
                                    write every data table out as CSV (or JSON)
  prismbinder anonymize <in> <out>        clear the saving user's account name
  prismbinder new <out.prism> [csv...]    build a bundle from CSV files (provisional)
  prismbinder convert <in> <out>          move the data to the other format (lossy)
  prismbinder diff <a> <b> [--cells]      what changed: entries, values, and cells

Notes
  .prism and .prismt are the same format; either works.
  Nothing is uploaded anywhere - all processing is local.
`

function fail(message: string, code = EXIT_USAGE): never {
  stderr.write(`prismbinder: ${message}\n`)
  exit(code)
}

function readInput(path: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(path))
  } catch {
    return fail(`cannot read ${path}`)
  }
}

function cmdInspect(file: string, asJson: boolean, quiet: boolean): number {
  const bytes = readInput(file)

  // Extension does not determine format - `.pzt` alone is XML, PCFF or a ZIP
  // bundle depending on the file - so dispatch on what is actually there. The
  // detailed report is bundle-shaped; XML documents get the neutral view.
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  if (!isZip) return inspectDocument(file, bytes, asJson, quiet)

  const { report, diagnostics } = inspectBytes(file, bytes)

  if (report === undefined) {
    if (asJson) stdout.write(`${JSON.stringify({ file, error: true, diagnostics }, null, 2)}\n`)
    else stderr.write(`prismbinder: ${file} could not be read as a Prism bundle\n`)
    for (const d of diagnostics) stderr.write(`  ${d.severity} ${d.code} ${d.path} ${d.message}\n`)
    return EXIT_DIAGNOSTICS
  }

  if (asJson) stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else if (!quiet) stdout.write(`${formatReport(report)}\n`)

  return diagnostics.some((d) => d.severity === 'error') ? EXIT_DIAGNOSTICS : EXIT_OK
}

/** Inspect for anything that is not a ZIP bundle, via the format-neutral view. */
function inspectDocument(file: string, bytes: Uint8Array, asJson: boolean, quiet: boolean): number {
  const { value, diagnostics } = readProject(bytes, file)
  if (value === undefined) {
    if (asJson)
      stdout.write(`${JSON.stringify({ file, error: true, diagnostics }, null, 2)}
`)
    else
      stderr.write(`prismbinder: ${file} could not be read
`)
    for (const d of diagnostics)
      stderr.write(`  ${d.severity} ${d.code} ${d.path} ${d.message}
`)
    return EXIT_DIAGNOSTICS
  }

  if (asJson) {
    // Deliberately not the whole project: `Project.sheets[].table.columns[]`
    // carries every cell of every table, and `--json` output ends up in files,
    // bug reports and CI logs. The bundle branch of this command reports shape
    // and never contents; this branch has to match it.
    const summary = {
      file,
      bytes: bytes.length,
      source: value.source,
      formatVersion: value.formatVersion,
      minPrismVersion: value.minPrismVersion,
      notes: value.notes,
      sheets: value.sheets.map((s) => ({
        kind: s.kind,
        title: s.title,
        ...(s.kind === 'data'
          ? {
              rows: s.table.rowCount,
              columns: s.table.columns.reduce((a, c) => a + c.subcolumns.length, 0),
              tableFormat: s.table.tableFormat,
              dataFormat: s.table.dataFormat,
              storage: s.table.storage,
            }
          : {}),
      })),
      diagnostics,
    }
    stdout.write(`${JSON.stringify(summary, null, 2)}
`)
  } else if (!quiet) {
    const kb = (bytes.length / 1024).toFixed(1)
    stdout.write(`${file}  (${kb} KB, ${value.source})
`)
    if (value.formatVersion !== undefined)
      stdout.write(`  format ${value.formatVersion}
`)
    for (const n of value.notes)
      stdout.write(`  ${n}
`)

    const data = value.sheets.filter((s) => s.kind === 'data')
    if (data.length > 0) {
      stdout.write(`
  Data sheets (${data.length})
`)
      for (const s of data) {
        if (s.kind !== 'data') continue
        const cols = s.table.columns.reduce((a, c) => a + c.subcolumns.length, 0)
        const shape = `${s.table.rowCount}x${cols}`.padStart(9)
        stdout.write(`    ${s.title.slice(0, 42).padEnd(44)}${shape}  ${s.table.dataFormat}
`)
      }
    }
  }

  return diagnostics.some((d) => d.severity === 'error') ? EXIT_DIAGNOSTICS : EXIT_OK
}

/**
 * Reports what differs between two documents.
 *
 * Exit code 1 when anything differs, so it works as a check in a script - the
 * same convention `git diff --exit-code` uses.
 */
function cmdDiff(left: string, right: string, withCells: boolean, asJson: boolean): number {
  const report = buildDiff(left, readInput(left), right, readInput(right), withCells)
  if (asJson)
    stdout.write(`${JSON.stringify(report, null, 2)}
`)
  else
    stdout.write(`${formatDiff(report)}
`)

  // Three outcomes, not two: identical, different, and could-not-tell. The
  // last one must never share an exit code with the first.
  const failed = report.diagnostics.some((d) => d.severity === 'error')
  const uncomparable = report.cells === undefined && !report.comparable
  const differs =
    report.entries.length > 0 || (report.cells !== undefined && report.cells.length > 0)
  return differs || failed || uncomparable ? EXIT_DIAGNOSTICS : EXIT_OK
}

function cmdValidate(file: string, asJson: boolean): number {
  const bytes = readInput(file)
  const { diagnostics } = readBundle(bytes)
  const errors = diagnostics.filter((d) => d.severity === 'error')
  const warnings = diagnostics.filter((d) => d.severity === 'warning')

  if (asJson) {
    stdout.write(`${JSON.stringify({ file, diagnostics }, null, 2)}\n`)
  } else if (diagnostics.length === 0) {
    stdout.write(`${file}: ok\n`)
  } else {
    for (const d of diagnostics) {
      stdout.write(`${d.severity} ${d.code}  ${d.path || '<archive>'}  ${d.message}\n`)
    }
    stdout.write(`${errors.length} error(s), ${warnings.length} warning(s)\n`)
  }
  return errors.length > 0 ? EXIT_DIAGNOSTICS : EXIT_OK
}

function cmdExtract(file: string, outDir: string): number {
  const bytes = readInput(file)
  const { value, diagnostics } = readZip(bytes)
  if (value.entries.length === 0) {
    stderr.write(`prismbinder: ${file} contains no readable entries\n`)
    return EXIT_DIAGNOSTICS
  }

  const root = resolve(outDir)
  let written = 0
  for (const entry of value.entries) {
    if (entry.isDirectory) continue
    // An archive from an untrusted source can name anything it likes; refuse to
    // let an entry escape the output directory.
    if (!isSafeEntryName(entry.name)) {
      stderr.write(`prismbinder: skipping unsafe entry name ${JSON.stringify(entry.name)}\n`)
      continue
    }
    const target = join(root, entry.name)
    if (target !== root && !target.startsWith(root + sep)) {
      stderr.write(`prismbinder: skipping entry that escapes the output directory: ${entry.name}\n`)
      continue
    }
    const content = readEntry(entry)
    const failed = content.diagnostics.filter((d) => d.severity === 'error')
    if (failed.length > 0) {
      for (const d of failed)
        stderr.write(`prismbinder: skipping ${d.path}: ${d.message}
`)
      continue
    }

    // One unwritable name must not abort the other entries: a crafted archive
    // would otherwise be able to stop an extraction at an entry of its choosing.
    try {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, content.value)
      written++
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      stderr.write(`prismbinder: could not write ${entry.name}: ${why}
`)
    }
  }
  stdout.write(`extracted ${written} entries to ${root}\n`)
  return diagnostics.some((d) => d.severity === 'error') ? EXIT_DIAGNOSTICS : EXIT_OK
}

/**
 * Round-trips a file through the parser and compares bytes.
 *
 * This is the same check CI runs against the corpus, exposed so a user can run
 * it on their own documents before trusting the tool with them.
 */
function cmdVerify(file: string): number {
  const bytes = readInput(file)
  const { value, diagnostics } = readBundle(bytes)
  if (value === undefined) {
    stderr.write(`prismbinder: ${file} could not be parsed\n`)
    return EXIT_DIAGNOSTICS
  }
  const out = writeBundle(value)
  const identical = bytesEqual(out, bytes)
  stdout.write(
    identical
      ? `${file}: byte-identical round trip (${bytes.length} bytes, ${value.archive.entries.length} entries)\n`
      : `${file}: MISMATCH - re-written file is ${out.length} bytes, original is ${bytes.length}\n`,
  )
  if (value.opaqueEntries.length > 0) {
    stdout.write(`  ${value.opaqueEntries.length} entries carried through uninterpreted\n`)
  }
  const errors = diagnostics.filter((d) => d.severity === 'error')
  for (const d of errors) stderr.write(`  error ${d.code} ${d.path} ${d.message}\n`)
  return identical && errors.length === 0 ? EXIT_OK : EXIT_DIAGNOSTICS
}

/**
 * Clears the OS account name Prism records in every document it writes.
 *
 * `createdBy.user` and `modifiedBy.user` are populated in every file examined,
 * and one shipped sample carries a full personal name. Anyone attaching a Prism
 * file to a paper probably does not mean to attach that as well.
 */
function cmdAnonymize(input: string, output: string): number {
  const bytes = readInput(input)
  const { value, diagnostics } = readBundle(bytes)
  if (value === undefined) {
    stderr.write(`prismbinder: ${input} could not be parsed
`)
    for (const d of diagnostics)
      stderr.write(`  ${d.severity} ${d.code} ${d.message}
`)
    return EXIT_DIAGNOSTICS
  }
  const before = {
    created: value.document.createdBy?.user ?? '',
    modified: value.document.modifiedBy?.user ?? '',
  }
  writeFileSync(output, writeBundleWith(value, anonymizeBundle(value)))
  const cleared = [before.created, before.modified].filter((u) => u !== '').length
  stdout.write(
    cleared === 0
      ? `${output}: written (no account names were present)
`
      : `${output}: written, ${cleared} account name(s) cleared
`,
  )
  // Anonymising a document we only partly understood is worth saying out loud.
  for (const d of diagnostics)
    stderr.write(`  ${d.severity} ${d.code} ${d.path} ${d.message}
`)
  return diagnostics.some((d) => d.severity === 'error') ? EXIT_DIAGNOSTICS : EXIT_OK
}

/** Writes every data table to a directory. The commonest reason to reach for this tool. */
function cmdExport(file: string, outDir: string, format: ExportFormat): number {
  const bytes = readInput(file)
  const { value, diagnostics } = readProject(bytes, file)
  if (value === undefined) {
    stderr.write(`prismbinder: ${file} could not be read
`)
    for (const d of diagnostics)
      stderr.write(`  ${d.severity} ${d.code} ${d.message}
`)
    return EXIT_DIAGNOSTICS
  }

  const root = resolve(outDir)
  mkdirSync(root, { recursive: true })
  const tables = exportTables(value, format)
  for (const t of tables) writeFileSync(join(root, t.filename), t.content, 'utf8')

  stdout.write(`wrote ${tables.length} table(s) to ${root}
`)
  for (const note of value.notes)
    stdout.write(`  note: ${note}
`)
  // The document parsed well enough to export, which is not the same as having
  // parsed cleanly. Staying silent here turns a questionable export into an
  // apparently successful one.
  for (const d of diagnostics)
    stderr.write(`  ${d.severity} ${d.code} ${d.path} ${d.message}
`)
  return diagnostics.some((d) => d.severity === 'error') ? EXIT_DIAGNOSTICS : EXIT_OK
}

/**
 * Builds a bundle from one or more CSV files.
 *
 * Provisional. Every field comes from the documented format, but the corpus
 * could only tell us what a Prism-written file looks like - not which parts
 * Prism requires. Open the result in Prism before relying on it.
 */
function cmdNew(output: string, csvFiles: readonly string[]): number {
  if (csvFiles.length === 0) {
    stderr.write('prismbinder: new needs at least one CSV file\n')
    return EXIT_USAGE
  }

  const tables = csvFiles.map((path) => {
    const rows = parseCsv(decodeUtf8(readInput(path))).rows
    const header = rows[0] ?? []
    const body = rows.slice(1)
    const base = path.split(/[\\/]/).pop() ?? 'Data'
    return {
      title: base.replace(/\.csv$/i, ''),
      columns: header.map((title, i) => ({
        title,
        cells: body.map((r) => r[i] ?? ''),
      })),
    }
  })

  writeFileSync(output, createBundle({ tables }))

  // Read our own output back before claiming it worked.
  const { value, diagnostics } = readBundle(new Uint8Array(readFileSync(output)))
  const errors = diagnostics.filter((d) => d.severity === 'error')
  const count = value?.archive.entries.length ?? 0
  stdout.write(`${output}: wrote ${tables.length} table(s), ${count} entries\n`)
  stdout.write('  provisional: open it in Prism to confirm it is accepted\n')
  for (const d of errors) stderr.write(`  error ${d.code} ${d.message}\n`)
  return errors.length > 0 ? EXIT_DIAGNOSTICS : EXIT_OK
}

/**
 * Converts a document to the other format.
 *
 * The loss list is printed to stdout, always, even when the conversion is as
 * clean as it can be. This command's whole hazard is that it looks like it
 * preserved a document when it preserved the data and threw away the rest, and
 * a report nobody reads is better than a report nobody is given.
 */
function cmdConvert(input: string, output: string): number {
  const bytes = readInput(input)
  const { value, diagnostics } = readProject(bytes, input)
  if (value === undefined) {
    for (const d of diagnostics) stderr.write(`  ${d.severity} ${d.code} ${d.message}\n`)
    return EXIT_DIAGNOSTICS
  }

  const target = /\.(pzfx|xml)$/i.test(output) ? 'pzfx' : 'bundle'
  const result = target === 'pzfx' ? toPzfx(value) : toBundle(value)

  if (result.bytes === undefined) {
    for (const d of result.diagnostics) stderr.write(`  ${d.severity} ${d.code} ${d.message}\n`)
    return EXIT_DIAGNOSTICS
  }

  writeFileSync(output, result.bytes)
  stdout.write(`${output}: written as ${target === 'pzfx' ? 'a .pzfx document' : 'a bundle'}\n`)

  stdout.write('\n  Not carried over:\n')
  for (const l of result.losses) stdout.write(`    - ${l}\n`)
  for (const d of result.diagnostics) {
    stderr.write(`  ${d.severity} ${d.code} ${d.path} - ${d.message}\n`)
  }

  return result.diagnostics.some((d) => d.severity === 'error') ? EXIT_DIAGNOSTICS : EXIT_OK
}

function parse(args: string[]): {
  values: {
    json?: boolean | undefined
    quiet?: boolean | undefined
    help?: boolean | undefined
    cells?: boolean | undefined
  }
  positionals: string[]
} {
  try {
    return parseArgs({
      args,
      options: {
        json: { type: 'boolean', default: false },
        cells: { type: 'boolean', default: false },
        quiet: { type: 'boolean', short: 'q', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    })
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'bad arguments')
  }
}

function main(): number {
  const { values, positionals } = parse(argv.slice(2))
  if (positionals.length === 0 && values.help !== true) {
    // A usage error is not output. Scripts separate the two streams for a
    // reason, and help text on stdout looks like a successful result.
    stderr.write(USAGE)
    return EXIT_USAGE
  }
  if (values.help === true) {
    stdout.write(USAGE)
    return EXIT_OK
  }

  const [command, ...rest] = positionals
  const asJson = values.json === true
  const quiet = values.quiet === true

  switch (command) {
    case 'inspect':
      if (rest[0] === undefined) return fail('inspect needs a file')
      return cmdInspect(rest[0], asJson, quiet)
    case 'validate':
      if (rest[0] === undefined) return fail('validate needs a file')
      return cmdValidate(rest[0], asJson)
    case 'extract':
      if (rest[0] === undefined || rest[1] === undefined)
        return fail('extract needs a file and an output directory')
      return cmdExtract(rest[0], rest[1])
    case 'verify':
      if (rest[0] === undefined) return fail('verify needs a file')
      return cmdVerify(rest[0])
    case 'export':
      if (rest[0] === undefined || rest[1] === undefined)
        return fail('export needs a file and an output directory')
      return cmdExport(rest[0], rest[1], asJson ? 'json' : 'csv')
    case 'diff':
      if (rest[0] === undefined || rest[1] === undefined) return fail('diff needs two files')
      return cmdDiff(rest[0], rest[1], values.cells === true, asJson)
    case 'convert':
      if (rest[0] === undefined || rest[1] === undefined)
        return fail('convert needs an input file and an output file')
      return cmdConvert(rest[0], rest[1])
    case 'new':
      if (rest[0] === undefined) return fail('new needs an output file')
      return cmdNew(rest[0], rest.slice(1))
    case 'anonymize':
      if (rest[0] === undefined || rest[1] === undefined)
        return fail('anonymize needs an input and an output file')
      return cmdAnonymize(rest[0], rest[1])
    default:
      return fail(`unknown command "${command}"`)
  }
}

exit(main())
