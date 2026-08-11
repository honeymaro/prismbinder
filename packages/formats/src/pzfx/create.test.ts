import { decodeUtf8 } from '@prismbinder/core'
import { describe, expect, it } from 'vitest'
import { createPzfx } from './create.js'
import { PZFX_TABLE_TYPES, PZFX_X_FORMATS, PZFX_Y_FORMATS } from './grammar.js'
import { readPzfx } from './read.js'

/**
 * The written document has to be legal, not merely readable by us.
 *
 * GraphPad publishes `PrismXMLSchema.xml` with Prism so that other programs can
 * write this format, and the enumerations in `grammar.ts` are copied from it.
 * This suite is the guard: our own reader is permissive enough that three
 * invented attribute values - `XFormat="number"`, `YFormat="none"`, and an
 * `XColumn` announcing one subcolumn while writing three - round-tripped
 * cleanly through it for as long as they existed.
 */

const tableAttrs = (bytes: Uint8Array): Record<string, string>[] =>
  [...decodeUtf8(bytes).matchAll(/<Table ([^>]*)>/g)].map((m) => {
    const out: Record<string, string> = {}
    for (const a of (m[1] as string).matchAll(/(\w+)="([^"]*)"/g)) {
      out[a[1] as string] = a[2] as string
    }
    return out
  })

const opts = { dateTime: '2026-01-01T00:00:00Z' }

describe('createPzfx writes only what the schema allows', () => {
  it('uses enumerated values for XFormat, YFormat and TableType', () => {
    const bytes = createPzfx({
      tables: [
        { title: 'plain', yColumns: [{ title: 'A', subcolumns: [['1', '2']] }] },
        {
          title: 'with x',
          xColumn: { title: 'X', subcolumns: [['1', '2']] },
          yColumns: [{ title: 'A', subcolumns: [['3', '4']] }],
        },
        {
          title: 'replicates',
          yColumns: [{ title: 'A', subcolumns: [['1'], ['2'], ['3']] }],
        },
        {
          title: 'x with error',
          xColumn: { title: 'X', subcolumns: [['1'], ['0.1']] },
          yColumns: [{ title: 'A', subcolumns: [['3']] }],
        },
      ],
      ...opts,
    })

    for (const t of tableAttrs(bytes)) {
      expect(PZFX_X_FORMATS as readonly string[], JSON.stringify(t)).toContain(t.XFormat)
      expect(PZFX_TABLE_TYPES as readonly string[], JSON.stringify(t)).toContain(t.TableType)
      if (t.YFormat !== undefined) {
        expect(PZFX_Y_FORMATS as readonly string[], JSON.stringify(t)).toContain(t.YFormat)
      }
    }
  })

  it('omits YFormat for the one table kind that never carries it', () => {
    // The enumeration has no member meaning "no subcolumn structure", and
    // `OneWay` tables omit the attribute - 41 of 41 in the corpus.
    const [plain, wide] = tableAttrs(
      createPzfx({
        tables: [
          { title: 'plain', yColumns: [{ title: 'A', subcolumns: [['1']] }] },
          { title: 'wide', yColumns: [{ title: 'A', subcolumns: [['1'], ['2']] }] },
        ],
        ...opts,
      }),
    )
    expect(plain?.TableType).toBe('OneWay')
    expect(plain?.YFormat).toBeUndefined()
    expect(plain?.Replicates, 'Replicates is the count YFormat refers to').toBeUndefined()
    expect(wide?.YFormat).toBe('replicates')
    expect(wide?.Replicates).toBe('2')
  })

  it('keeps YFormat on an XY table even with a single subcolumn', () => {
    // Not a function of width. No `XY` table in the corpus omits the
    // attribute, including all 36 whose columns hold one subcolumn - those
    // write `replicates` with a count of one. An earlier version of this
    // writer omitted it here, trading a value outside the enumeration for a
    // combination outside the corpus.
    const [t] = tableAttrs(
      createPzfx({
        tables: [
          {
            title: 'xy',
            xColumn: { title: 'X', subcolumns: [['1']] },
            yColumns: [{ title: 'A', subcolumns: [['2']] }],
          },
        ],
        ...opts,
      }),
    )
    expect(t?.TableType).toBe('XY')
    expect(t?.YFormat).toBe('replicates')
    expect(t?.Replicates).toBe('1')
  })

  it('writes an error-bar layout as itself, not as replicates', () => {
    // The difference is not cosmetic. Prism averages replicates, so a mean and
    // an SD declared as two of them read as one number halfway between.
    const [t] = tableAttrs(
      createPzfx({
        tables: [
          {
            title: 'mean and sd',
            yFormat: 'SD',
            xColumn: { title: 'X', subcolumns: [['1']] },
            yColumns: [{ title: 'A', subcolumns: [['100'], ['10']] }],
          },
        ],
        ...opts,
      }),
    )
    expect(t?.YFormat).toBe('SD')
    // The corpus writes `Replicates` only alongside `YFormat="replicates"`.
    expect(t?.Replicates).toBeUndefined()
  })

  it('names the table kind the columns actually describe', () => {
    const [noX, withX, wideNoX] = tableAttrs(
      createPzfx({
        tables: [
          { title: 'a', yColumns: [{ title: 'A', subcolumns: [['1']] }] },
          {
            title: 'b',
            xColumn: { title: 'X', subcolumns: [['1']] },
            yColumns: [{ title: 'A', subcolumns: [['1']] }],
          },
          { title: 'c', yColumns: [{ title: 'A', subcolumns: [['1'], ['2']] }] },
        ],
        ...opts,
      }),
    )
    // An XY table with no X column is a description of a table we did not write.
    expect(noX?.TableType).toBe('OneWay')
    expect(noX?.XFormat).toBe('none')
    expect(withX?.TableType).toBe('XY')
    expect(withX?.XFormat).toBe('numbers')
    expect(wideNoX?.TableType).toBe('TwoWay')
  })

  it('declares the number of X subcolumns it goes on to write', () => {
    const bytes = createPzfx({
      tables: [
        {
          title: 'x with error',
          xColumn: {
            title: 'X',
            subcolumns: [
              ['1', '2'],
              ['0.1', '0.2'],
            ],
          },
          yColumns: [{ title: 'A', subcolumns: [['3', '4']] }],
        },
      ],
      ...opts,
    })
    const xml = decodeUtf8(bytes)
    const declared = /<XColumn[^>]*Subcolumns="(\d+)"/.exec(xml)?.[1]
    const written = (/<XColumn[\s\S]*?<\/XColumn>/.exec(xml)?.[0].match(/<Subcolumn>/g) ?? [])
      .length
    expect(declared).toBe(String(written))
    expect(written).toBe(2)
    // A wider X is `error` in the corpus, not `numbers`.
    expect(tableAttrs(bytes)[0]?.XFormat).toBe('error')
  })

  it('still round-trips through our own reader', () => {
    const bytes = createPzfx({
      tables: [
        {
          title: 'Demo',
          rowTitles: ['one', 'two'],
          xColumn: { title: 'Dose', subcolumns: [['1', '2']] },
          yColumns: [{ title: 'A', subcolumns: [['3', '4']] }],
        },
      ],
      ...opts,
    })
    const { value, diagnostics } = readPzfx(bytes)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(value?.tables[0]?.title).toBe('Demo')
    expect(value?.tables[0]?.x?.subcolumns[0]?.cells.map((c) => c.text)).toEqual(['1', '2'])
  })
})
