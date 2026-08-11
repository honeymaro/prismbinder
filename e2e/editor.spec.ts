import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { readBundle } from '@prismbinder/formats'

const DIST = resolve('apps/editor/dist')
const ORIGIN = 'https://prismbinder.test'

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
}

/** A real Prism file to drive the UI with, if one is installed. */
function sampleBundle(): string | undefined {
  const dirs = [
    'C:/Program Files/GraphPad/Prism/SampleData/MultipleVariables',
    'C:/Program Files/GraphPad/Prism/Portfolio/Graphs to explore',
  ]
  for (const d of dirs) {
    if (!existsSync(d)) continue
    for (const n of readdirSync(d)) {
      if (n.endsWith('.prismt') || n.endsWith('.pzt')) return join(d, n)
    }
  }
  return undefined
}

/** Every numeric literal stored in the sample's analysis results. */
function resultLiterals(file: string): Set<string> {
  const { value } = readBundle(new Uint8Array(readFileSync(file)))
  const out = new Set<string>()
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== 'object') return
    const node = n as {
      kind?: string
      raw?: string
      members?: unknown[]
      items?: unknown[]
      value?: unknown
    }
    if (node.kind === 'scalar' && typeof node.raw === 'string') out.add(node.raw)
    for (const m of node.members ?? []) walk((m as { value?: unknown }).value)
    for (const i of node.items ?? []) walk(i)
  }
  for (const a of value?.analyses ?? []) walk(a.results?.root)
  return out
}

/**
 * Serves the production bundle from disk by intercepting requests.
 *
 * The built app is what gets tested, and no server process is involved.
 * `file://` is not an option because Chromium refuses to load ES modules from
 * an opaque origin.
 */
test.beforeEach(async ({ page }) => {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url())
    const rel = url.pathname === '/' ? '/index.html' : url.pathname
    const file = join(DIST, rel)
    if (!file.startsWith(DIST) || !existsSync(file)) {
      await route.fulfill({ status: 404, body: 'not found' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: MIME[extname(file)] ?? 'application/octet-stream',
      body: readFileSync(file),
    })
  })

  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${ORIGIN}/`)
  expect(errors, 'the page loaded without throwing').toEqual([])
})

test('loads and states its limits up front', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Drop a Prism file' })).toBeVisible()
  await expect(page.getByText('No file is uploaded anywhere')).toBeVisible()
  await expect(page.getByText(/Graphs - their geometry is a legacy binary/)).toBeVisible()
})

test('opens a real Prism file entirely in the browser', async ({ page }) => {
  const file = sampleBundle()
  test.skip(file === undefined, 'no Prism installation found')

  await page.locator('input[type=file]').setInputFiles(file as string)

  // Sheets are listed...
  await expect(page.getByRole('heading', { name: /^Data/ })).toBeVisible()
  // ...and a table is rendered with real cells.
  await expect(page.locator('table.grid')).toBeVisible()
  expect(await page.locator('table.grid tbody td').count()).toBeGreaterThan(4)
  // The format version came out of the document itself.
  await expect(page.getByText(/format \d+-\d+-\d+/)).toBeVisible()
})

test('marks graphs it cannot render rather than drawing something wrong', async ({ page }) => {
  const file = sampleBundle()
  test.skip(file === undefined, 'no Prism installation found')

  await page.locator('input[type=file]').setInputFiles(file as string)
  // `count()` does not auto-wait, so settle on rendered output first.
  await expect(page.getByRole('heading', { name: /^Data/ })).toBeVisible()

  const graphs = page.getByRole('heading', { name: /^Graphs/ })
  test.skip((await graphs.count()) === 0, 'sample has no graphs')

  // Pick a graph the sidebar has flagged as carrying an opaque binary; not
  // every graph sheet has one, and the two cases say different things.
  const opaque = page
    .locator('.sheetgroup', { has: graphs })
    .locator('button', { has: page.locator('.badge', { hasText: 'binary' }) })
  test.skip((await opaque.count()) === 0, 'sample has no graph with stored geometry')

  await opaque.first().click()
  await expect(page.getByText('Not rendered.')).toBeVisible()
  await expect(page.getByText(/carries through untouched but does not decode/)).toBeVisible()
})

test('refuses the legacy binary with an actionable message', async ({ page }) => {
  // PCFFGRA4 magic: the pre-ZIP format we deliberately do not read.
  await page.locator('input[type=file]').setInputFiles({
    name: 'legacy.pzf',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('PCFFGRA4\u0001\u0080\u000c\u0000', 'latin1'),
  })
  await expect(page.getByText(/Could not read legacy\.pzf/)).toBeVisible()
  await expect(page.getByText(/Open it in Prism once and save it again/)).toBeVisible()
})

test('edits a cell, saves, and the change survives a reload', async ({ page }, testInfo) => {
  const file = sampleBundle()
  test.skip(file === undefined, 'no Prism installation found')

  await page.locator('input[type=file]').setInputFiles(file as string)
  await expect(page.locator('table.grid')).toBeVisible()

  // Type into the first editable cell.
  const firstCell = page.locator('table.grid tbody input').first()
  await firstCell.fill('987.654')
  await expect(page.getByText(/unsaved cell/)).toBeVisible()

  // Save produces a download rather than touching the original.
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save a copy' }).click(),
  ]).then(([d]) => d)

  const saved = testInfo.outputPath('edited.prism')
  await download.saveAs(saved)
  await expect(page.getByText(/entr(y|ies) rewritten/)).toBeVisible()

  // Reopen the saved file in the same app: the edit is there.
  await page.locator('input[type=file]').setInputFiles(saved)
  await expect(page.locator('table.grid')).toBeVisible()
  await expect(page.locator('table.grid tbody input').first()).toHaveValue('987.654')
})

test('does not offer editing for XML documents it cannot write back', async ({ page }) => {
  const pzfx = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<GraphPadPrismFile PrismXMLVersion="5.00">',
    '<Table ID="Table0" XFormat="none" TableType="OneWay">',
    '<Title>Demo</Title>',
    '<YColumn Width="89" Decimals="2" Subcolumns="1"><Title>A</Title>',
    '<Subcolumn><d>1</d><d>2</d></Subcolumn></YColumn>',
    '</Table></GraphPadPrismFile>',
  ].join('\r\n')

  await page.locator('input[type=file]').setInputFiles({
    name: 'demo.pzfx',
    mimeType: 'text/xml',
    buffer: Buffer.from(pzfx, 'utf8'),
  })

  await expect(page.locator('table.grid')).toBeVisible()
  // The sheet header says so, and the sidebar explains why.
  await expect(page.locator('.panel .muted.small')).toContainText('read-only')
  await expect(page.locator('.savebar')).toContainText('XML documents open read-only')
  // No inputs: the cells are rendered as plain text.
  expect(await page.locator('table.grid tbody input').count()).toBe(0)
})

test('shows stored analysis results at the precision the file holds', async ({ page }) => {
  const file = sampleBundle()
  test.skip(file === undefined, 'no Prism installation found')

  await page.locator('input[type=file]').setInputFiles(file as string)
  const analyses = page.getByRole('heading', { name: /^Analyses/ })
  await expect(page.getByRole('heading', { name: /^Data/ })).toBeVisible()
  test.skip((await analyses.count()) === 0, 'sample has no analyses')

  await page.locator('.sheetgroup', { has: analyses }).locator('button').first().click()
  await expect(page.locator('.results')).toBeVisible()
  await expect(page.getByText(/Nothing here is recalculated/)).toBeVisible()

  // Numbers are printed from their source text rather than re-formatted, so
  // every number on screen must appear verbatim in the file. Anything that had
  // been through a JS number would have been shortened and would fail here.
  const stored = resultLiterals(file as string)
  const shown = await page.locator('.results__num').allInnerTexts()
  expect(shown.length).toBeGreaterThan(0)
  expect(shown.filter((n) => !stored.has(n))).toEqual([])

  // And at least one of them is long enough that reformatting would show.
  expect([...stored].some((n) => /\.\d{10,}/.test(n))).toBe(true)
})

test('undoes an edit back to the value the file holds', async ({ page }) => {
  const file = sampleBundle()
  test.skip(file === undefined, 'no Prism installation found')

  await page.locator('input[type=file]').setInputFiles(file as string)
  await expect(page.locator('table.grid')).toBeVisible()

  const cell = page.locator('table.grid tbody input').first()
  const original = await cell.inputValue()
  await cell.fill('111.222')
  await expect(page.getByText(/unsaved cell/)).toBeVisible()

  await page.getByRole('button', { name: 'Undo' }).click()
  // Back to the file's own value, not to an empty cell: undoing an edit
  // removes the pending change rather than blanking what was underneath.
  await expect(cell).toHaveValue(original)

  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(cell).toHaveValue('111.222')
})

test('renders only a window of a long table', async ({ page }) => {
  const file = sampleBundle()
  test.skip(file === undefined, 'no Prism installation found')

  await page.locator('input[type=file]').setInputFiles(file as string)
  await expect(page.locator('table.grid')).toBeVisible()

  // The real row count is announced even though only a window exists in the
  // DOM - this is what a screen reader reads, and what virtualization would
  // otherwise quietly break.
  const declared = Number(await page.locator('table.grid').getAttribute('aria-rowcount'))
  expect(declared).toBeGreaterThan(1)

  const rendered = await page.locator('table.grid tbody tr:not(.spacer)').count()
  expect(rendered).toBeGreaterThan(0)
  expect(rendered).toBeLessThanOrEqual(declared)
})

test('labels the plot as reconstructed rather than as Prism output', async ({ page }) => {
  const file = sampleBundle()
  test.skip(file === undefined, 'no Prism installation found')

  await page.locator('input[type=file]').setInputFiles(file as string)
  await expect(page.locator('table.grid')).toBeVisible()

  await page.getByRole('button', { name: 'Plot the data' }).click()
  await expect(page.getByText(/This is not Prism's graph/)).toBeVisible()
  await expect(page.locator('.preview .badge', { hasText: 'reconstructed' })).toBeVisible()
})

/** Resolves once the debounced autosave has actually landed on disk. */
async function autosaveSettled(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          try {
            const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('session')
            await dir.getFileHandle('state.json')
            const bin = await (await dir.getFileHandle('document.bin')).getFile()
            return bin.size
          } catch {
            return 0
          }
        }),
      { timeout: 15_000, message: 'autosave should reach the origin private file system' },
    )
    .toBeGreaterThan(0)
}

test('autosaves and offers the work back, for the second file as well as the first', async ({
  page,
}) => {
  const file = sampleBundle()
  test.skip(file === undefined, 'no Prism installation found')

  // Opening a second document in one session used to leave autosave writing the
  // edits without the bytes they belong to, so recovery quietly stopped working
  // from the second file onwards. Nothing about that is visible at runtime,
  // which is exactly why it is worth a test.
  for (const round of [1, 2]) {
    await page.locator('input[type=file]').setInputFiles(file as string)
    // The file name appears only once the incoming document has been parsed,
    // so this cannot pass against the grid of the document being replaced.
    await expect(page.locator('.filesummary__name')).toHaveText(/\.(prismt|pzt)$/)
    await expect(page.locator('table.grid')).toBeVisible()

    await page.locator('table.grid tbody input').first().fill(`3${round}.5`)
    await expect(page.getByText(/unsaved cell/)).toBeVisible()

    // Wait for the write itself, not for a duration: the debounce is 2s and
    // the document is large enough that a fixed sleep races the file system.
    await autosaveSettled(page)

    await page.reload()
    const banner = page.getByText(/was open with .* unsaved cell/)
    await expect(banner, `round ${round}: recovery should be offered`).toBeVisible()
    await page.getByRole('button', { name: 'Restore' }).click()

    await expect(page.locator('table.grid')).toBeVisible()
    await expect(page.locator('table.grid tbody input').first()).toHaveValue(`3${round}.5`)

    // The undo stack came back with the edits, not just the values.
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()
  }
})

test('does not offer to restore work that was undone', async ({ page }) => {
  const file = sampleBundle()
  test.skip(file === undefined, 'no Prism installation found')

  await page.locator('input[type=file]').setInputFiles(file as string)
  await expect(page.locator('.filesummary__name')).toHaveText(/\.(prismt|pzt)$/)
  await expect(page.locator('table.grid')).toBeVisible()

  const cell = page.locator('table.grid tbody input').first()
  const original = await cell.inputValue()
  await cell.fill('55.5')
  await autosaveSettled(page)

  // Undo back to a clean document. The saved copy has to follow: otherwise a
  // crash later offers to restore an edit the user deliberately reverted, and
  // nothing on screen marks it as stale.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(cell).toHaveValue(original)

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          try {
            const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('session')
            await dir.getFileHandle('state.json')
            return 'present'
          } catch {
            return 'cleared'
          }
        }),
      { timeout: 10_000, message: 'the autosaved session should be cleared' },
    )
    .toBe('cleared')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Drop a Prism file' })).toBeVisible()
  await expect(page.getByText(/was open with .* unsaved cell/)).toHaveCount(0)
})
