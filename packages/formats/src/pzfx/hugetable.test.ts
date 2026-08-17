import { encodeUtf8 } from '@prismbinder/core'
import { describe, expect, it } from 'vitest'
import { readPzfx } from './read.js'
import { writePzfx } from './write.js'

/**
 * `HugeTable` is a data table, and a document made of them is not empty.
 *
 * GraphPad's schema declares `HugeTable` beside `Table` with the same content
 * model and the same attributes, and Prism writes it for wide documents. This
 * reader collected only `Table`, so `pzfx__column_hugetable.pzfx` - a real
 * 53-replicate document written by Prism 6.0f - came back with no tables at
 * all: `inspect` printed nothing and exited 0, `convert` refused it, and the
 * editor drew an empty grid. Reading a file as empty is the worst way to be
 * wrong about it, because nothing about the output says anything went missing.
 *
 * **Written inline rather than as a fixture file.** The corpus helper is
 * `.node.ts` and the documents it finds are either a local Prism installation
 * or `fixtures/external`, which is gitignored and which CI does not fetch - so
 * a test that depended on either would be skipped in the one place it most
 * needs to run. These strings run in the Chromium project too.
 */

function doc(body: string): Uint8Array {
  return encodeUtf8(
    '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
      '<GraphPadPrismFile PrismXMLVersion="5.00">\r\n' +
      `${body}</GraphPadPrismFile>\r\n`,
  )
}

const HUGE =
  '<HugeTable ID="Table0" XFormat="none" YFormat="replicates" Replicates="2" TableType="TwoWay">\r\n' +
  '<Title>Wide</Title>\r\n' +
  '<YColumn Width="81" Decimals="0" Subcolumns="2"><Title>A</Title>' +
  '<Subcolumn><d>1</d><d>2</d></Subcolumn>' +
  '<Subcolumn><d>3</d><d>4</d></Subcolumn></YColumn>\r\n' +
  '</HugeTable>\r\n'

const PLAIN =
  '<Table ID="Table1" XFormat="none" YFormat="replicates" Replicates="1" TableType="OneWay">\r\n' +
  '<Title>Narrow</Title>\r\n' +
  '<YColumn Width="81" Decimals="0" Subcolumns="1"><Title>B</Title>' +
  '<Subcolumn><d>9</d></Subcolumn></YColumn>\r\n' +
  '</Table>\r\n'

describe('a document whose tables are HugeTable', () => {
  it('reads them, rather than reporting an empty document', () => {
    const { value, diagnostics } = readPzfx(doc(HUGE), 'huge.pzfx')
    expect(value?.tables).toHaveLength(1)
    expect(diagnostics.map((d) => d.code)).not.toContain('pzfx/no-tables')

    const t = value?.tables[0]
    expect(t?.tableType).toBe('TwoWay')
    expect(t?.replicates).toBe(2)
    expect(t?.yColumns[0]?.subcolumns.map((s) => s.cells.map((c) => c.text))).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('remembers which element each table came from', () => {
    // Reading the two is identical; writing them is not. A document that
    // arrived as one has to leave as one, and this is the only place that
    // still knows which.
    const { value } = readPzfx(doc(HUGE + PLAIN), 'mixed.pzfx')
    expect(value?.tables.map((t) => t.element)).toEqual(['HugeTable', 'Table'])
  })

  it('keeps them in document order when a file mixes the two', () => {
    // Collected in one pass rather than as two lists joined end to end, which
    // would order every `Table` before every `HugeTable` and match neither the
    // file nor its own `TableSequence`.
    const { value } = readPzfx(doc(PLAIN + HUGE), 'mixed.pzfx')
    expect(value?.tables.map((t) => t.title)).toEqual(['Narrow', 'Wide'])
  })

  it('still round-trips to the same bytes', () => {
    // The table list is a view; the writer prints the parsed XML. Widening what
    // is collected must not touch what is written.
    for (const body of [HUGE, PLAIN, HUGE + PLAIN]) {
      const bytes = doc(body)
      const { value } = readPzfx(bytes, 'x.pzfx')
      expect(value).toBeDefined()
      if (value !== undefined) expect(writePzfx(value)).toEqual(bytes)
    }
  })
})

describe('a table element this reader does not model', () => {
  it('is reported rather than passed off as an empty document', () => {
    // `Table1024` is declared in Prism's own schema and has never been seen in
    // any document on this machine. If one arrives, the reader has to say it
    // could not read it: "no data tables" would be a claim about the file.
    const { value, diagnostics } = readPzfx(
      doc('<Table1024 ID="T"><Title>Wide</Title></Table1024>\r\n'),
      'future.pzfx',
    )
    expect(value?.tables).toHaveLength(0)
    const codes = diagnostics.map((d) => d.code)
    expect(codes).toContain('pzfx/unread-table-element')
    const found = diagnostics.find((d) => d.code === 'pzfx/unread-table-element')
    expect(found?.severity).toBe('warning')
  })

  it('does not fire on the elements every document has', () => {
    // `TableSequence` is named like one and is not one. Firing on it would make
    // the warning meaningless on every file in the corpus.
    const { diagnostics } = readPzfx(
      doc('<TableSequence><Ref ID="Table0"/></TableSequence>\r\n' + PLAIN),
      'ordinary.pzfx',
    )
    expect(diagnostics.map((d) => d.code)).not.toContain('pzfx/unread-table-element')
  })

  it('says nothing about unread elements when the document is simply empty', () => {
    const { diagnostics } = readPzfx(doc(''), 'empty.pzfx')
    const codes = diagnostics.map((d) => d.code)
    expect(codes).toContain('pzfx/no-tables')
    expect(codes).not.toContain('pzfx/unread-table-element')
  })
})
