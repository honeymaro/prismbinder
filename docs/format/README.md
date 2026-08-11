# The GraphPad Prism file formats

Written from inspection of Prism 11.0.2 and the documents it produces. Every claim here is checked by a test in this repository; where the corpus cannot settle a question, that is said explicitly rather than guessed at.

GraphPad describes the format as intentionally open - the user guide says it "operates much like a zip file", that "data are stored in CSV format and all analysis parameters and results are stored in standard JSON schemas", and that "nothing gets locked away inside a file that can only be accessed if you're using Prism". There is, however, no published specification. This document is an attempt at one.

---

## 1. Telling the formats apart

**Dispatch on magic bytes, not the extension.** `.pzt` is three different formats depending on the file: of the 67 shipped `.pzt` samples, 46 are XML, 18 are the legacy `PCFFGRA4` binary, and 3 are ZIP bundles.

| First bytes | Format | Extensions |
|---|---|---|
| `50 4B 03 04` | ZIP bundle | `.prism`, `.prismt`, some `.pzt` |
| `<?xml` (optionally after a UTF-8 BOM) | XML document | `.pzfx`, most `.pzt`, sample `.xml` |
| `PCFFGRA4` | Legacy binary | `.pzf`, older `.pzt` |
| `PCFF` + `20 00 00 00` | Legacy binary, table-of-offsets variant | `misc/used_fonts.bin` |

`.prism` and `.prismt` are **the same format**. Comparing eight real documents against eleven shipped templates found zero differences in `document.json` key paths, zero in ZIP entry shapes, and an identical entry-metadata profile. Only the extension differs.

---

## 2. The ZIP container

Prism's archives are not uniform, and a writer has to reproduce the variation rather than normalise it.

| Field | Value |
|---|---|
| `versionMadeBy` | `0x033F` (831) - Unix host, spec version 6.3 |
| `versionNeededToExtract` | **20** for most entries, **45** for everything under `data/tables/` |
| General purpose flag | `0x0` on directories, `0x4` on files |
| Compression method | `0` (stored) on directories, `8` (deflate) on files |
| External attributes | `0x41FF0000` directories, `0x81B60000` files |
| Extra fields | none, on either header |
| Data descriptors | none |

**`extractVersion = 45` does not mean ZIP64 here.** Those entries carry no ZIP64 extra field. A library that infers ZIP64 from the version stamp will add one and change the bytes.

The `data/tables/` subtree is written by a different code path from the rest of the archive. Its JSON uses a different layout (section 4), and its entries carry `extractVersion 45` paired with Unix permissions `0666`; the rest of the archive carries `extractVersion 20`, with permissions that vary by writing machine.

Do not turn that into a rule about paths. A corpus of fourteen shipped templates suggested `data/tables/` was exactly the `ev=45` subtree; nine further documents have both versions inside it. What holds across everything examined is narrower: `extractVersion` is 20 or 45 and nothing else, `45` always appears together with `0666`, and `content.json` has been `45` in all 126 tables seen. The permission bits outside that subtree vary with the machine that wrote the file - 0644 on some, 0666 on others - so a reader must carry them per entry rather than derive them.

Directory entries are present and stored. Central-directory order matches physical order in every archive examined, and the top-level section order varies between documents, so neither should be assumed.

### Deflate parameters

```
level 2, memLevel 9, windowBits -15, Z_DEFAULT_STRATEGY
```

With these, all 1,539 deflate streams across two independent corpora re-compress **byte-for-byte**. Two caveats:

- The encoder must be in the **stock zlib family**. pako with `legacyHash: true` qualifies; pako 3's *default* and Node's built-in `zlib` do not - Node bundles Chromium's fork, whose match-finder uses a different hash. Mixing them produces different bytes for the same input.
- `memLevel: 9` matters. The default of 8 diverges on larger payloads.

Independent corroboration: general-purpose flag bit 2 declares "fast" compression per APPNOTE 4.4.4, which agrees with level 2 from an entirely different field.

---

## 3. Bundle layout

```
document.json                                  manifest
data/sheets/<uuid>/sheet.json                  sheet + its table's structure
data/sheets/<uuid>/floating_notes/<uuid>.json
data/tables/<uuid>/content.json                row and column counts
data/tables/<uuid>/data.csv                    the cells
data/tables/<uuid>/data.dt                     32 hex chars, revision token
data/sets/<uuid>.json                          one per column
analyses/<uuid>/sheet.json                     always exactly five files, plus
analyses/<uuid>/parameters.json                  result_sheets/ and floating_notes/
analyses/<uuid>/parameters.dt
analyses/<uuid>/results.json                   computed results, full precision
analyses/<uuid>/constants.json                 the only JSON entry with no $id
analyses/<uuid>/result_sheets/<uuid>.json
graphs/<uuid>/sheet.json
graphs/<uuid>/data.bin                         PCFF binary - opaque
info/<uuid>/sheet.json
layouts/<uuid>/sheet.json
layouts/<uuid>/data.bin                        PCFF binary - opaque
misc/used_fonts.bin                            PCFF, table-of-offsets variant
```

Sections are optional; `analyses`, `graphs` and `info` are each absent from some documents. **Do not assume a sibling exists**: `Wine.prismt` contains two `graphs/<uuid>/data.bin` with no `sheet.json`, referenced from nowhere in the archive.

### `document.json`

```jsonc
{
  "@class": "Document",
  "$id": "document.schema.json",
  "creationDate": "...", "modificationDate": "...",
  "createdBy":  { "name": "Prism", "user": "<OS account>", "version": "...", "platform": "Win" },
  "modifiedBy": { ... },
  "formatVersion": "1-6-0",       // hyphens, not dots
  "minFormatVersion": "1-2-0",    // oldest format a reader must understand
  "minPrismVersion": "10.1.0",
  "compatibility": [{ "formatVersion": "1-0-0", "action": "warningOpen" }],
  "sheets": { "graphs": [uuid...], "analyses": [...], "info": [...], "data": [...] },
  "sheetAttributesMap": { "<uuid>": { "title": "...", "highlightColor": "#ffffffff" } },
  "uiSettings": { ..., "printer": { /* Win32 DEVMODE fields */ } },
  "customColors": [ "#000000ff", ... ]
}
```

`compatibility` and `customColors` are optional. `sheets` maps a folder name to sheet ids and always includes `data`, last. Note that `data/sheets/<uuid>/` directories are routinely absent from `sheetAttributesMap` - those are analysis-internal result sheets, which is normal.

> **Privacy.** `createdBy.user` and `modifiedBy.user` hold the OS account name of whoever saved the file, and are present in every document examined. Anything that writes a Prism file should not populate them by default.

---

## 4. JSON conventions

Two layouts coexist in one archive:

| Where | Indent | Trailing newline |
|---|---|---|
| `data/tables/*/content.json` | four spaces | yes |
| everything else | tab | no |

Both use `": "` between key and value. Beyond layout, three things defeat `JSON.parse` + `JSON.stringify`:

- **Integral doubles are written with a decimal point** - `1676.0`, `95.0`, `0.0`. A JS number cannot remember this, so the value is written back as `1676`.
- **One integer exceeds 2^53** (`-9223372036854775807`). Here the *value* is lost, not just its spelling.
- **Objects can carry numeric-looking keys in non-ascending order** (`"2", "1", "4", "3", "0"`). JS objects promote integer-like keys to the front and sort them.

String escapes are limited to `\r`, `\"`, `\\`, `\t` and `\n`; no `\uXXXX` and no `\/` appear. Non-ASCII is stored raw. `\r` is the paragraph separator inside rich text.

---

## 5. Data tables

`data.csv` holds the cells. UTF-8, no BOM, LF endings, always terminated with one. Quoting is minimal, and every quoted field observed is quoted because it contains a comma; no embedded newlines or doubled quotes appear, though both are handled.

**Cells are text, not numbers.** Prism writes numbers with `%.18g`, and 69% of the numeric cells in the corpus change if routed through a JS number: `2.35671923073764633` shortens, `2.000` becomes `2`, `177.0` becomes `177`.

### Column mapping

Verified against every table in the corpus, matching both `content.json.numberOfColumns` and the parsed CSV:

```
columns = (rowTitlesDataSet ? 1 : 0)
        + (xDataSet && xDataSet.format !== "series" ? 1 : 0)
        + dataSets.length x subcolumnsPerDataSet
```

Order is row titles, then X, then each dataset's block in `dataSets` order.

| `table.dataFormat` | Subcolumns per dataset |
|---|---|
| `text`, `y_single` | 1 |
| `y_sd`, `y_se`, `y_cv` | 2 |
| `y_plus_minus`, `y_high_low`, `y_sd_n`, `y_se_n`, `y_cv_n` | 3 |
| `y_replicates`, `text_replicates` | `table.replicatesCount` |

Two traps:

- An X dataset whose own `format` is `series` **occupies no column** - its values are generated. The dataset's single replicate is a `SeriesReplicate` carrying `startValue` and `interval`, and the rule is arithmetic: `x[i] = startValue + i * interval`, for `content.json.numberOfRows` values. Three documents do this, all with 1000 rows; two of them land on exactly `1000.0` and `72.0` at the last row, where a geometric reading gives `0.2459` and `1.0`. A reader that walks only the stored columns loses the X axis of these tables entirely.
- `subcolumnTitlesDataSet` also occupies no column; it is a header row.

The table's `dataFormat` decides the layout, **not** the datasets' own `format`, and the two can disagree: both `y_high_low` tables in the corpus contain datasets whose individual format is `y_plus_minus`.

### Stored values are not always displayed values

- `y_high_low` stores **two independent offsets**, not absolute bounds. The two are unequal in real data.
- `y_plus_minus` likewise stores separate up and down offsets, so "+/-" is not symmetric in storage.
- `y_sd`, `y_se`, `y_sd_n` and `y_se_n` store what their names say. Every dataset inside such a table declares the same format as the table.
- **`y_cv` and `y_cv_n` store a standard deviation**, not a coefficient of variation. The disagreement between the two axes is what says so: every dataset inside a `y_cv` table declares its own format as `y_sd`, and inside a `y_cv_n` table as `y_sd_n`. Prism computes the percentage for display. A reader that shows the stored number under the %CV heading is out by a factor of the mean. This confirms a third-party report that could not previously be checked. Evidence is one document, which is why the finding is recorded with its basis rather than as a bare rule.

All five formats above were absent from the original corpus and are present now. The subcolumn counts in the table above are confirmed for every one of them: the computed layout matches `numberOfColumns` on 95 of 95 tables.

### Cells carry flags the CSV cannot express

`replicates[].cellAttributes` marks rows inside one subcolumn, as inclusive ranges: `"34"` for a single row, `"0~1"` for a span. The attributes that change what a number means:

| Attribute | Meaning |
|---|---|
| `EXCLUDED` | Prism keeps the value visible on the table and leaves it out of **every analysis and every graph**. Reading it as ordinary data reports numbers Prism does not use. |
| `CENSORED` | Survival tables: the subject was still alive when observation stopped. 29 cells in the corpus. |
| `SECTION_TITLE` | A row used as a heading rather than data. |
| `OUTLIER`, `ERRONEOUS_VALUE`, `BAD_VALUE` | Marked by Prism's own outlier and validation passes. |

`.pzfx` records the same idea per cell instead, as `<d Excluded="1">`.

### Derived state in `data/sets/*.json`

Editing one cell touches several entries. What can be recomputed, and what must not be:

| Field | On write |
|---|---|
| `replicates[].firstRow` / `lastRow` | **Recompute** - the dataset-level union span across its subcolumns. Exact on 496/496. |
| `replicate ranges[].replicate.firstRow` / `lastRow` | **Recompute**, but per-range. Same field name, different meaning by container. Exact on 18/18. |
| `categories[].usageCount`, `firstRowIndex` | **Recompute.** Exact on 105/105. |
| `realsCount`, `integersCount`, `textsCount` | **Preserve.** These are stale caches Prism does not maintain - 149 records carry `realsCount: 0` over columns full of real numbers, and Prism opens them without complaint. Recomputing would rewrite 192 records. |
| `excludesCount`, `decimalsLength`, `significantDigitsCount`, `currentType`, `isManual` | **Preserve.** Display settings or UI state. `significantDigitsCount` is 7 in all 513 records. |
| `valuesStorageData` (in-table formula) | **Preserve, never recompute.** |

In-table calculated columns store a `TransformDataSource` with an expression referencing table columns by letter (`C-D`, `2^(-G)`). The computed values are already materialised into the CSV, so the expression is provenance rather than a live formula.

---

## 6. XML documents (`.pzfx`)

The XML generation exposes data tables and info sheets; **graphs, analyses and formatting live in a `<Template>` element** holding base64 of a zlib stream wrapping the same PCFF binary the bundle keeps in `data.bin`. Four of the seven shipped `.pzfx` files have no `<Template>` at all, so its absence is normal.

Byte-level characteristics that defeat conventional serialisers:

- CRLF throughout, and no indentation at all
- trailing whitespace on some lines
- a UTF-8 BOM on some files
- `<X/>` and `<X></X>` both used, sometimes in one file
- non-canonical entities: `&gt;` in text where it is not required, `&apos;`, and numeric references `&#xA;` and `&#38;`
- **`xmlns` is optional** - absent from 11 of 53 documents. Match on local names.

Numbers use MSVC three-digit exponents (`1.401298e-045`) and at most 10 significant digits, so a `.pzfx` -> bundle conversion is lossy in both directions.

Sample `.xml` files wrap the document in an XSLT stylesheet so a browser renders them as a table; the Prism payload is a literal result element inside. **Never feed these to an XSLT processor** - parse them as text.

The shipped `PrismXMLSchema.xml` is XDR (a Microsoft pre-XSD dialect), describes itself as being for Prism 9.0, and is out of date: `CategoryDictionary` and twelve attributes including `CellType`, `UserText`, `MVType` and `num` are used but not declared, while `HugeTable`, `Table1024` and `Script` are declared but never appear.

Out of date is not the same as useless. Where the schema *does* enumerate values it is authoritative, and the user guide points programmers at it for exactly this purpose. A writer must stay inside these sets:

| Attribute | Values |
|---|---|
| `XFormat` | `none` `text` `numbers` `error` `series` `date` `startenddate` `time` |
| `YFormat` | `replicates` `SD` `SE` `CV` `SDN` `SEN` `CVN` `low-high` `text` `upper-lower-limits` |
| `TableType` | `Result` `Legacy` `XY` `OneWay` `TwoWay` `Contingency` `Survival` `PartsOfWhole` |
| `ExtTableType` | `MultipleVariables` (the schema's only member; real Prism 11 files also write `Nested`) |
| `EVFormat` | `Number` `AsteriskAfterNumber` `Blank` |

Note there is no `number` and no `none` for `YFormat`. Both are easy inventions and neither appears in any of the 137 pzfx-family documents examined.

The combinations are constrained beyond the individual enumerations, and the corpus is consistent about them:

- **Whether `YFormat` appears is a property of the table kind, not of the column width.** `OneWay` never carries it (41 of 41), nor do `Survival` (5) or `Contingency` (5). No `XY` table omits it - including all 36 whose columns hold a single subcolumn, which write `YFormat="replicates" Replicates="1"`. `PartsOfWhole` does the same, 7 of 7.
- `Replicates` appears only alongside `YFormat="replicates"`. The error-bar layouts never carry it.
- An `XY` table always has an X column; a table without one is `OneWay` when its columns are single and `TwoWay` when they are not.
- An X wider than one subcolumn is `XFormat="error"`.

`YFormat` is the attribute that decides what the numbers *are*. Writing `replicates` for a mean-and-SD pair is not a mislabel: Prism averages replicates, so `(100, 10)` is read as 55.

### The eight table kinds, in both vocabularies

The user guide names eight; the two generations spell them differently, and two of them are not a `TableType` at all.

| Kind | Bundle `table.format` | `.pzfx` |
|---|---|---|
| XY | `xy` | `TableType="XY"` |
| Column | `column` | `OneWay` |
| Grouped | `grouped` | `TwoWay` |
| Contingency | `contingency` | `Contingency` |
| Survival | `survival` | `Survival` |
| Parts of whole | `partsofwhole` | `PartsOfWhole` |
| Multiple variables | `multivariable` | `OneWay` + `ExtTableType="MultipleVariables"` |
| Nested | `nested` | `TwoWay` + `ExtTableType="Nested"` |

The bundle also uses `view` for a results table, `control`, `obsolete` and `undefined`.

---

## 7. What we deliberately do not read

**PCFF** - the legacy binary holding graph geometry. Its body is a fixed-layout structure dump whose corresponding C++ model runs to hundreds of classes. We carry every such blob through byte-for-byte and never author one. Prism itself opens legacy files, so converting one is a matter of opening and re-saving it there.

**Statistics.** Analysis results are read, displayed and exported. Recomputing them is a different project.

---

## Open questions

| Question | Status |
|---|---|
| ~~What do `y_cv`, `y_cv_n`, `y_sd_n`, `y_se_n`, `y_se` store?~~ | **Answered.** All five now appear. `y_se`, `y_sd_n` and `y_se_n` store what they name; `y_cv` and `y_cv_n` store SD. See section 5 |
| Does `upper-lower-limits` mean the same thing in both formats? | `.pzfx` distinguishes it from `low-high`; the bundle has one name, `y_high_low`, for both. Which of the two a bundle holds is not recorded anywhere we have found |
| Is `.dt` a checksum or a random revision token? | 88 samples, all distinct, matching no digest of their siblings |
| What is the minimum entry set Prism will open? | Needs testing against Prism |
| Does entry order matter? | Consistent within each document; untested |
