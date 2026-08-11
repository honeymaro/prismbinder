import { encodeUtf8 } from '@prismbinder/core'
import { describe, expect, it } from 'vitest'
import { readProject } from './adapt.js'
import { marksFor } from './types.js'

/**
 * What the neutral view says about numbers it did not store itself.
 *
 * Two things used to get lost between the codecs and this layer. Exclusion was
 * read from the XML and then thrown away, so a value Prism keeps out of every
 * analysis reached the exporter indistinguishable from one it uses. And the
 * `.pzfx` half reported `storage: 'direct'` unconditionally, which is the one
 * answer that is wrong for the two layouts the field exists to warn about.
 */

function doc(tableAttrs: string, columns: string): Uint8Array {
  return encodeUtf8(
    '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
      '<GraphPadPrismFile PrismXMLVersion="5.00">\r\n' +
      `<Table ID="T0" ${tableAttrs}>\r\n<Title>T</Title>\r\n${columns}</Table>\r\n` +
      '</GraphPadPrismFile>\r\n',
  )
}

const threeWide = (a: string, b: string, c: string) =>
  '<YColumn Width="81" Decimals="0" Subcolumns="3"><Title>A</Title>' +
  `<Subcolumn><d>${a}</d></Subcolumn>` +
  `<Subcolumn><d>${b}</d></Subcolumn>` +
  `<Subcolumn><d>${c}</d></Subcolumn></YColumn>\r\n`

describe('the neutral view of a .pzfx table', () => {
  it('carries exclusion through to the model', () => {
    const bytes = doc(
      'XFormat="none" TableType="OneWay" EVFormat="AsteriskAfterNumber"',
      '<YColumn Width="81" Decimals="0" Subcolumns="1"><Title>A</Title>' +
        '<Subcolumn><d>10</d><d Excluded="1">999</d><d>12</d></Subcolumn></YColumn>\r\n',
    )
    const { value } = readProject(bytes, 'x.pzfx')
    const sheet = value?.sheets[0]
    expect(sheet?.kind).toBe('data')
    if (sheet?.kind !== 'data') return
    const column = sheet.table.columns[0]
    expect(column).toBeDefined()
    if (column === undefined) return
    // The value stays on the table - Prism keeps it visible - but a consumer
    // has to be able to tell that Prism does not use it.
    expect(column.subcolumns[0]).toEqual(['10', '999', '12'])
    expect([...marksFor(column, 0).excluded]).toEqual([1])
  })

  it('tells offsets and absolute bounds apart', () => {
    // `low-high` stores a value and two deltas; `upper-lower-limits` stores a
    // value and the limits that bracket it. Both are three subcolumns wide and
    // both map to `y_high_low`, which is why `storage` has to do the work.
    const offsets = readProject(
      doc(
        'XFormat="none" YFormat="low-high" TableType="TwoWay" EVFormat="AsteriskAfterNumber"',
        threeWide('100', '10', '30'),
      ),
      'a.pzfx',
    ).value?.sheets[0]
    const bounds = readProject(
      doc(
        'XFormat="none" YFormat="upper-lower-limits" TableType="TwoWay" EVFormat="AsteriskAfterNumber"',
        threeWide('100', '110', '70'),
      ),
      'b.pzfx',
    ).value?.sheets[0]

    if (offsets?.kind !== 'data' || bounds?.kind !== 'data') throw new Error('expected data sheets')
    expect(offsets.table.storage).toBe('offsets')
    expect(bounds.table.storage).toBe('bounds')
    // Both report the bundle's spelling, so a caller can switch on one vocabulary.
    expect(offsets.table.dataFormat).toBe('y_high_low')
    expect(bounds.table.dataFormat).toBe('y_high_low')
  })

  it('reports %CV as derived, because the stored number is an SD', () => {
    // Every dataset inside a `y_cv` bundle table declares its own format as
    // `y_sd`. Reading the stored value under the %CV heading is off by a factor
    // of the mean.
    const sheet = readProject(
      doc(
        'XFormat="none" YFormat="CV" TableType="TwoWay" EVFormat="AsteriskAfterNumber"',
        '<YColumn Width="81" Decimals="0" Subcolumns="2"><Title>A</Title>' +
          '<Subcolumn><d>100</d></Subcolumn><Subcolumn><d>10</d></Subcolumn></YColumn>\r\n',
      ),
      'c.pzfx',
    ).value?.sheets[0]
    if (sheet?.kind !== 'data') throw new Error('expected a data sheet')
    expect(sheet.table.dataFormat).toBe('y_cv')
    expect(sheet.table.storage).toBe('derived')
  })

  it('survives a round trip back to .pzfx with its layout intact', async () => {
    // The point of naming the layout in the neutral view is that the writer can
    // put it back. Reading `SD` and writing `replicates` would not lose a
    // label, it would change the numbers: Prism averages replicates, so a mean
    // of 100 with an SD of 10 comes back as 55.
    const { toPzfx } = await import('./convert.js')
    const source = readProject(
      doc(
        'XFormat="none" YFormat="SD" TableType="TwoWay" EVFormat="AsteriskAfterNumber"',
        '<YColumn Width="81" Decimals="0" Subcolumns="2"><Title>A</Title>' +
          '<Subcolumn><d>100</d></Subcolumn><Subcolumn><d>10</d></Subcolumn></YColumn>\r\n',
      ),
      'e.pzfx',
    ).value
    if (source === undefined) throw new Error('expected a document')

    const { bytes } = toPzfx(source)
    if (bytes === undefined) throw new Error('expected output')
    const round = readProject(bytes, 'f.pzfx').value?.sheets[0]
    if (round?.kind !== 'data') throw new Error('expected a data sheet')
    expect(round.table.dataFormat).toBe('y_sd')
    expect(round.table.storage).toBe('direct')
  })

  it('names table kinds in one vocabulary across both formats', () => {
    const kinds: [string, string, string][] = [
      ['TableType="OneWay"', '', 'column'],
      ['TableType="TwoWay"', '', 'grouped'],
      ['TableType="Survival"', '', 'survival'],
      ['TableType="OneWay" ExtTableType="MultipleVariables"', '', 'multivariable'],
      ['TableType="TwoWay" ExtTableType="Nested"', '', 'nested'],
    ]
    for (const [attrs, _, expected] of kinds) {
      const sheet = readProject(
        doc(
          `XFormat="none" ${attrs} EVFormat="AsteriskAfterNumber"`,
          '<YColumn Width="81" Decimals="0" Subcolumns="1"><Title>A</Title>' +
            '<Subcolumn><d>1</d></Subcolumn></YColumn>\r\n',
        ),
        'd.pzfx',
      ).value?.sheets[0]
      if (sheet?.kind !== 'data') throw new Error('expected a data sheet')
      expect(sheet.table.tableFormat, attrs).toBe(expected)
    }
  })
})
