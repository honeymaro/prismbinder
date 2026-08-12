import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ColumnView, TableView } from '@prismbinder/model'
import { describe, expect, it } from 'vitest'
import { planChart } from './plan.js'
import { renderChart } from './render.js'
import { toSvg } from './svg.js'

/**
 * The structural extractor, checked against charts whose structure we know.
 *
 * `tools/prism-reference/features.mjs` exists to make "does this match Prism"
 * a question a machine can answer, by reading structure out of an SVG rather
 * than comparing pixels. It is only worth anything if it actually sees the
 * things that were wrong: every defect found by eye so far - a line through the
 * replicates, a sloped survival curve, uncapped error bars - has to show up as
 * a difference in what it reports.
 *
 * Run against our own output on both sides here. The Prism side needs a
 * licensed Prism to export references, which this machine does not have; what
 * is proved here is that the extractor is not blind.
 */

const tools = join(process.cwd(), 'tools', 'prism-reference', 'features.mjs')
// Loaded by URL rather than by specifier: the tool is a plain script outside
// any package, so there is nothing for the resolver to look up.
const { features, compare } = (await import(pathToFileURL(tools).href)) as {
  features: (svg: string) => {
    symbols: number
    verticalStrokes: number
    cappedEnds: number
    steppedPaths: number
    numericLabels: number[]
    textLabels: string[]
  }
  compare: (
    a: ReturnType<typeof features>,
    b: ReturnType<typeof features>,
  ) => { what: string; ours: unknown; prism: unknown }[]
}

function column(title: string, subcolumns: string[][], role: 'x' | 'y' = 'y'): ColumnView {
  return {
    id: title,
    title,
    role,
    subcolumns,
    marks: subcolumns.map(() => ({ excluded: new Set<number>(), censored: new Set<number>() })),
    generated: false,
  }
}

function table(over: Partial<TableView>): TableView {
  return {
    rowCount: 1,
    rowTitles: [],
    columns: [],
    tableFormat: 'xy',
    dataFormat: 'y_single',
    storage: 'direct',
    ...over,
  }
}

const svgOf = (t: TableView, kind?: string) =>
  toSvg(renderChart(planChart(t, 'T', kind === undefined ? {} : { kind: kind as never })))

const replicates = table({
  dataFormat: 'y_replicates',
  rowCount: 3,
  columns: [
    column('Hours', [['0', '6', '12']], 'x'),
    column('A', [
      ['45', '56', '76'],
      ['34', '61', '72'],
      ['40', '58', '77'],
    ]),
  ],
})

describe('reading structure back out of a chart', () => {
  it('finds the caps on error bars, and none where there are no bars', () => {
    // The defect this exists to catch is bars drawn as bare vertical strokes,
    // so the extractor is worthless unless a chart with no bars at all reports
    // zero. It did not at first: an axis tick mark is a short vertical stroke
    // too, and the corner one was being read as a capped bar.
    const withBars = features(svgOf(replicates))
    const withoutBars = features(
      svgOf(
        table({
          rowCount: 3,
          columns: [column('Hours', [['0', '6', '12']], 'x'), column('A', [['45', '56', '76']])],
        }),
      ),
    )
    // Three X positions, each bar capped top and bottom.
    expect(withBars.cappedEnds).toBe(6)
    expect(withoutBars.cappedEnds).toBe(0)
    expect(compare(withoutBars, withBars).map((f) => f.what)).toContain('error bar caps')
  })

  it('sees the difference between summarising and plotting every repeat', () => {
    // Nine values, three X positions. The number of symbols is exactly how
    // "Prism plots the mean, we plot every replicate" shows up as a number.
    const summarised = features(svgOf(replicates))
    const raw = features(svgOf(replicates, 'xy'))
    expect(raw.symbols).toBeGreaterThan(summarised.symbols)
    expect(compare(raw, summarised).map((f) => f.what)).toContain('symbols drawn')
    expect(compare(summarised, summarised)).toEqual([])
  })

  it('tells a staircase from a sloped line', () => {
    const stepped = features(
      svgOf(
        table({
          tableFormat: 'survival',
          rowCount: 4,
          columns: [
            column('Time', [['1', '2', '3', '4']], 'x'),
            column('A', [['1', '1', '1', '1']]),
          ],
        }),
      ),
    )
    const sloped = features(
      svgOf(
        table({
          rowCount: 4,
          columns: [column('X', [['1', '2', '3', '4']], 'x'), column('A', [['9', '7', '4', '2']])],
        }),
      ),
    )
    expect(stepped.steppedPaths).toBeGreaterThan(0)
    expect(sloped.steppedPaths).toBe(0)
    expect(compare(sloped, stepped).map((f) => f.what)).toContain('stepped line')
  })

  it('recovers the axis range from the tick labels', () => {
    const f = features(
      svgOf(
        table({
          rowCount: 2,
          columns: [column('X', [['0', '80']], 'x'), column('A', [['20', '120']])],
        }),
      ),
    )
    expect(Math.min(...f.numericLabels)).toBe(0)
    expect(Math.max(...f.numericLabels)).toBe(120)
  })

  it('reads an SVG it did not write', () => {
    // Prism groups, nests and draws symbols as paths. The extractor works off
    // geometry rather than off anything either renderer promises to call
    // things, so a hand-written document with none of our class names still
    // yields the same features.
    const foreign = `<svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(4,4)">
        <path d="M10,10 L10,40"/>
        <path d="M6,10 L14,10"/>
        <path d="M6,40 L14,40"/>
        <text><tspan>0</tspan></text><text>50</text>
      </g></svg>`
    const f = features(foreign)
    expect(f.verticalStrokes).toBe(1)
    expect(f.cappedEnds).toBe(2)
    expect(f.numericLabels.sort((a, b) => a - b)).toEqual([0, 50])
  })

  it('the tool it reads is present in the repository', () => {
    expect(readFileSync(tools, 'utf8')).toContain('export function features')
  })
})
