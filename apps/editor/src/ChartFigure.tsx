import { type ChartSpec, DEFAULT_STYLE, type El, renderChart } from '@prismbinder/charts'
import { createElement, type ReactNode, useMemo } from 'react'

/**
 * The element tree a chart spec produced, as React nodes.
 *
 * Shared by the reconstructed preview and by the Multiple Variables graphs that
 * are read from the file, so both go through exactly the same renderer and any
 * difference between them is a difference in the spec rather than in the
 * drawing.
 *
 * The stylesheet comes from the chart package rather than from this app, and
 * travels inside the SVG. Leaving it out is not a cosmetic omission: with no
 * rules the axis and grid lines have no stroke and vanish, and the tick text
 * falls back to the browser default of 16px, which is half again the size the
 * label layout measured against. The chart then decides its labels fit when
 * they do not.
 */
export function ChartFigure({ spec }: { spec: ChartSpec }) {
  const tree = useMemo(() => renderChart(spec, { width: 680, height: 340 }), [spec])
  const styled = useMemo<El>(
    () => ({
      ...tree,
      children: [{ tag: 'style', attrs: {}, children: [DEFAULT_STYLE] }, ...tree.children],
    }),
    [tree],
  )
  return <div className="preview__svg-wrap">{toReact(styled, 'root')}</div>
}

function toReact(node: El | string, key: string): ReactNode {
  if (typeof node === 'string') return node
  const props: Record<string, unknown> = { key }
  for (const [name, value] of Object.entries(node.attrs)) {
    // The tree speaks SVG; React wants one attribute spelled its own way.
    props[name === 'class' ? 'className' : name] = value
  }
  const children = node.children.map((c, i) => toReact(c, `${key}.${i}`))
  return children.length === 0
    ? createElement(node.tag, props)
    : createElement(node.tag, props, ...children)
}
