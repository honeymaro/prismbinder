# Diagnostics

Parsing never throws because of file content. A truncated archive, an unknown class, a format version from the future - all produce a diagnostic and a best-effort value, because a tool that refuses to open the one file you needed to rescue is not much use.

Exceptions are reserved for programmer error (`PrismbinderError`).

```ts
interface Diagnostic {
  code: string        // stable, listed below
  severity: 'error' | 'warning' | 'info'
  path: string        // ZIP entry name, JSON pointer, or cell reference
  message: string
  detail?: unknown
}
```

Every parser returns `ParseResult<T> = { value, diagnostics }`.

**Severity means:**

| | |
|---|---|
| `error` | We could not read part of the file. The value returned is incomplete. |
| `warning` | We read it, but something is off, or an edit may have consequences you did not intend. |
| `info` | Worth knowing; nothing is wrong. Content we carry through without interpreting reports at this level. |

The CLI exits `1` when any `error` is present, `2` on a usage mistake, `0` otherwise.

---

## ZIP container

| Code | Severity | Meaning |
|---|---|---|
| `zip/truncated` | error | Fewer bytes than the smallest possible archive. |
| `zip/no-eocd` | error | No end-of-central-directory record. Not a ZIP, or badly damaged. |
| `zip/zip64` | info | The archive uses ZIP64 records. Prism does not currently produce these. |
| `zip/zip64-malformed` | error | A ZIP64 locator is present but the record it points at is unreadable. |
| `zip/bad-central-record` | error | A central directory record is missing or has the wrong signature. |
| `zip/bad-local-header` | error | An entry's local header is missing at the offset the directory gives. |
| `zip/truncated-entry` | error | An entry's data runs past the end of the file. |
| `zip/unsafe-name` | warning | The entry name is unsafe to write to disk (traversal, absolute path, backslash, NUL). Parsing continues; extraction skips it. |
| `zip/too-many-entries` | error | Entry count exceeds the configured limit. |
| `zip/ratio-exceeded` | error | An entry's declared compression ratio looks like a decompression bomb. |
| `zip/size-exceeded` | error | Total inflated size would exceed the configured limit. |

The last three are configurable through `ReadZipOptions.limits`, and exist because a browser tab may be asked to open a file from anywhere.

## Entry contents

| Code | Severity | Meaning |
|---|---|---|
| `zip/inflate-failed` | error | The entry is malformed, or expands past the size it declares. The value is empty; do not treat that as an empty entry. |
| `zip/crc-mismatch` | error | Inflated contents do not match the CRC-32 the archive records. |
| `zip/entry-too-large` | error | A stored (uncompressed) entry is larger than the configured ceiling. |
| `zip/size-mismatch` | warning | The entry inflates to fewer bytes than it declares. |

A ZIP states an entry's inflated size, and nothing makes that statement true. The bound is therefore applied to bytes as they are produced, not to the declared figure - a 204 KB archive can declare a 1:1 ratio, pass every header check, and inflate to hundreds of megabytes.

## JSON

| Code | Severity | Meaning |
|---|---|---|
| `json/syntax` | error | Malformed JSON. Comments and trailing commas count: we accept strict JSON only, even though the underlying scanner would tolerate JSONC. |
| `json/duplicate-key` | warning | An object repeats a key. Both members are kept in order. |

## XML

| Code | Severity | Meaning |
|---|---|---|
| `xml/syntax` | error | The document could not be parsed. |
| `xml/no-root` | error | No root element. |

## Bundle (`.prism` / `.prismt`)

| Code | Severity | Meaning |
|---|---|---|
| `bundle/no-document` | error | No `document.json`. Not a Prism bundle. |
| `bundle/entry-unreadable` | error | An entry could not be decompressed. |
| `bundle/no-format-version` | warning | `document.json` declares no `formatVersion`. |
| `bundle/table-no-uid` | warning | A data sheet has a table with no `uid`; its cells cannot be located. |
| `bundle/table-missing-storage` | warning | A table has no `content.json` or no `data.csv`. |
| `bundle/row-count-mismatch` | warning | `content.json` and `data.csv` disagree on the row count. |
| `bundle/graph-disagreement` | info | A table is drawn by more than one graph and they state different axes or a different graph kind. `Geometric mean.pzt` draws the same data linearly and logarithmically; `Time line.pzt` draws it whole and again zoomed. Neither answer is used, and the chart falls back to bounds derived from the numbers. |
| `bundle/orphan-graph` | info | A `graphs/<uuid>/data.bin` with no `sheet.json`, referenced from nowhere. Real files contain these; it is carried through verbatim. |
| `bundle/series-without-parameters` | warning | A dataset declares itself a generated series - so it occupies no CSV column - but records no `startValue` and `interval`. Its X values cannot be rebuilt from anything in the file. |
| `bundle/unreadable-cell-range` | warning | A `cellAttributes` entry names its rows in a form the range grammar does not accept (`"12"` or `"3~7"`). The mark is dropped, which downgrades an excluded value to an ordinary one, so it is said out loud. |

## pzfx (`.pzfx` and XML `.pzt`)

| Code | Severity | Meaning |
|---|---|---|
| `pzfx/no-root` | error | No `GraphPadPrismFile` element, even after looking inside an XSLT wrapper. |
| `pzfx/no-tables` | info | The document has no data tables. Two shipped samples are like this. |
| `pzfx/unread-table-element` | warning | A root element named like a data table that this reader does not model, so its rows are not shown. Distinct from `no-tables`, which is a fact about the document rather than a limit of the reader; conflating the two is what let a `HugeTable` document read as empty. Prism's schema declares one such element we have never seen, `Table1024`. |
| `pzfx/opaque-template` | info | Graphs, analyses and formatting are inside a `<Template>` blob that we carry but do not read. |

## Project (format dispatch)

| Code | Severity | Meaning |
|---|---|---|
| `project/legacy-binary` | error | The file is the pre-ZIP `PCFF` binary. We do not read it; open it in Prism once and save it again. |

## Editing

| Code | Severity | Meaning |
|---|---|---|
| `edit/no-such-sheet` | error | No data sheet with the given id, or it has no table. |
| `edit/row-out-of-range` | error | The edit names a row the table does not have. Appending rows is a separate operation. |
| `edit/no-content-json` | warning | A table's shape changed but it has no `content.json` to update. |
| `edit/x-dataset-unresolved` | warning | The table names an X dataset whose record is missing, so the column layout assumes it occupies a column. Layout affects where an edit is *written*, so this is not cosmetic. |
| `edit/formula-column-source-changed` | warning | The edited column is produced by an in-table formula. The stored values changed; the formula was left as recorded, because recomputing it is out of scope. |

---

## Conversion

| Code | Severity | Meaning |
|---|---|---|
| `convert/no-data` | error | The document has no data tables, so there is nothing a conversion could carry across. |
| `convert/unverified-layout` | warning | This table's subcolumn layout has never been observed, so its columns are copied as stored without interpreting what they mean. |
| `convert/duplicate-column-title` | warning | Flattening subcolumns generated a column title that another column already used. No data is lost; the names simply stop identifying a column, and the source document did not have that ambiguity. |

Conversion also returns a **loss list** alongside its diagnostics. It is not a diagnostic channel: a loss is expected and unavoidable, not a defect, and it is reported on every successful conversion rather than only on suspect ones. Graphs and analyses always appear there when present, because in both formats they live inside a legacy binary we decline to author.

## Diff

| Code | Severity | Meaning |
|---|---|---|
| `diff/not-both-bundles` | info | Entry and structure comparison needs two ZIP bundles; only the cell layer ran. |
| `diff/sheet-count` | warning | The two documents have different numbers of data sheets; those that pair up by position were compared. |

## Adding a code

Codes are `area/kebab-case` and are part of the public interface - `--json` output and exit codes depend on them. Renaming one is a breaking change. Add the row here in the same commit.
