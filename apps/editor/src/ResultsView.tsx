import type { JsonNode } from '@prismbinder/core'
import { useState } from 'react'

/**
 * Renders the results Prism computed.
 *
 * The rendered result sheet in the file shows these rounded for display; this
 * is the stored copy, at full double precision. Numbers are printed from their
 * source text rather than re-formatted, so what you see is exactly what is in
 * the file - `1676.0` stays `1676.0`, and an 18-significant-digit value keeps
 * all eighteen.
 *
 * The shape varies by analysis, and there are fifty of them. Rather than write
 * fifty bespoke renderers and silently mishandle the forty-ninth, this walks
 * whatever it is given, with a little extra care for the one structure they all
 * share: a `samples` map keyed by a derived id, where the useful label lives at
 * `id.col.title`.
 */
export function ResultsView({ node }: { node: JsonNode }) {
  return (
    <div className="results">
      <Node node={node} name={null} depth={0} />
    </div>
  )
}

/**
 * How deep to open by default.
 *
 * Someone opening this panel came to see numbers, and the interesting ones sit
 * four or five levels down (`content > samples > <sample> > value > stats`).
 * Showing a stack of collapsed headers would technically be a results viewer
 * and practically be useless.
 */
const OPEN_TO_DEPTH = 4

function Node({ node, name, depth }: { node: JsonNode; name: string | null; depth: number }) {
  const allScalars =
    node.kind === 'object'
      ? node.members.every((m) => m.value.kind === 'scalar')
      : node.kind === 'array' && node.items.every((n) => n.kind === 'scalar')

  // A block of plain values is the payload, so open it wherever it appears. It
  // only renders at all if its ancestors are open, so this cannot explode.
  const [open, setOpen] = useState(depth < OPEN_TO_DEPTH || allScalars)

  if (node.kind === 'scalar') {
    return (
      <div className="results__leaf">
        {name !== null ? <span className="results__key">{name}</span> : null}
        <span className={typeof node.value === 'number' ? 'results__num' : 'results__val'}>
          {node.raw}
        </span>
      </div>
    )
  }

  const children: { key: string; node: JsonNode }[] =
    node.kind === 'object'
      ? node.members.map((m) => ({ key: m.key, node: m.value }))
      : node.items.map((n, i) => ({ key: String(i), node: n }))

  if (children.length === 0) {
    return (
      <div className="results__leaf">
        {name !== null ? <span className="results__key">{name}</span> : null}
        <span className="muted">{node.kind === 'object' ? '{}' : '[]'}</span>
      </div>
    )
  }

  // A table of scalars reads far better as an actual table than as a list.
  if (children.every((c) => c.node.kind === 'scalar') && children.length > 2) {
    return (
      <section className="results__group">
        <Header
          name={name}
          count={children.length}
          open={open}
          onToggle={() => setOpen(!open)}
          kind={node.kind}
        />
        {open ? (
          <table className="results__table">
            <tbody>
              {children.map((c) => (
                <tr key={c.key}>
                  <th>{prettify(c.key)}</th>
                  <td className={scalarClass(c.node)}>
                    {c.node.kind === 'scalar' ? c.node.raw : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    )
  }

  return (
    <section className="results__group">
      <Header
        name={name}
        count={children.length}
        open={open}
        onToggle={() => setOpen(!open)}
        kind={node.kind}
      />
      {open ? (
        <div className="results__children">
          {children.map((c) => (
            <Node key={c.key} node={c.node} name={label(c.key, c.node)} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function Header({
  name,
  count,
  open,
  onToggle,
  kind,
}: {
  name: string | null
  count: number
  open: boolean
  onToggle: () => void
  kind: 'object' | 'array'
}) {
  return (
    <button type="button" className="results__toggle" onClick={onToggle} aria-expanded={open}>
      <span className="results__caret">{open ? 'v' : '>'}</span>
      <span className="results__key">{name === null ? 'results' : prettify(name)}</span>
      <span className="muted small">{kind === 'array' ? `${count} items` : `${count} fields`}</span>
    </button>
  )
}

/**
 * Samples are keyed by a derived UUID, which tells a reader nothing. The
 * column title inside is what they are actually looking for.
 */
function label(key: string, node: JsonNode): string {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(key)) return key
  if (node.kind !== 'object') return key
  const id = node.members.find((m) => m.key === 'id')?.value
  if (id?.kind !== 'object') return key
  const col = id.members.find((m) => m.key === 'col')?.value
  if (col?.kind !== 'object') return key
  const title = col.members.find((m) => m.key === 'title')?.value
  return title?.kind === 'scalar' && typeof title.value === 'string' ? title.value : key
}

function scalarClass(node: JsonNode): string {
  return node.kind === 'scalar' && typeof node.value === 'number' ? 'results__num' : ''
}

/** `meanMinus3SD` reads better as `mean minus 3 SD`. */
function prettify(key: string): string {
  if (/^\d+$/.test(key)) return `[${key}]`
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bC I\b/g, 'CI')
    .replace(/\bS D\b/g, 'SD')
    .replace(/\bS E\b/g, 'SE')
}
