import type { El } from './types.js'

/**
 * The element tree as an SVG document.
 *
 * Used by the CLI, and by the tests: a chart that serialises to a string is one
 * a snapshot can hold and a property can search, without a DOM anywhere.
 */

const VOID_TAGS = new Set(['line', 'rect', 'circle', 'ellipse', 'path', 'use'])

export function toSvg(root: El, opts: { readonly style?: string } = {}): string {
  const style = opts.style ?? DEFAULT_STYLE
  const inner = style === '' ? render(root) : withStyle(root, style)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${inner}\n`
}

function withStyle(root: El, style: string): string {
  const styled: El = {
    ...root,
    attrs: { xmlns: 'http://www.w3.org/2000/svg', ...root.attrs },
    children: [{ tag: 'style', attrs: {}, children: [style] }, ...root.children],
  }
  return render(styled)
}

export function render(node: El | string): string {
  if (typeof node === 'string') return escapeText(node)
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join('')
  if (node.children.length === 0 && VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}/>`
  const inner = node.children.map(render).join('')
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`
}

/**
 * `>` is escaped although it is legal bare: `]]>` is not, and one rule is
 * easier to be sure about than one rule with an exception. Same choice the
 * `.pzfx` writer makes.
 */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;')
}

export const DEFAULT_STYLE = `
.pbchart { font-family: system-ui, sans-serif; }
.pbchart-grid { stroke: #e3e6ea; stroke-width: 1; }
.pbchart-axis { stroke: #9aa3ad; stroke-width: 1; }
.pbchart-tick { font-size: 11px; fill: #5a636d; }
.pbchart-axis-title { font-size: 12px; fill: #3d454d; }
.pbchart-legend { font-size: 11px; fill: #3d454d; }
.pbchart-line { stroke-width: 1.6; fill: none; }
.pbchart-error { stroke-width: 1.2; }
.pbchart-error-cap { stroke-width: 1.2; }
.pbchart-tickmark { stroke: #9aa3ad; stroke-width: 1; }
.pbchart-whisker { stroke-width: 1.2; }
.pbchart-median { stroke-width: 2; }
.pbchart-quartile { stroke-width: 1; stroke-dasharray: 3 2; }
.pbchart-censor { stroke-width: 1.4; }
.pbchart-box { stroke-width: 1.2; }
.pbchart-violin { stroke-width: 1.2; }
.pbchart-hull { stroke-width: 1.2; }
.pbchart-ellipse { stroke-width: 1.2; stroke-dasharray: 4 3; }
.pbchart-link { stroke: #4a5560; stroke-width: 1.2; }
.pbchart-mean { font-size: 12px; fill: #2c333a; }
`.trim()
