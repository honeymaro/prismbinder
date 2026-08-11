# Measurements

Only claims we have **executed and confirmed** are recorded here. Estimates and second-hand sources do not belong in this file.

The plan lives at `~/.claude/plans/glistening-exploring-pancake.md`; fact IDs (F*, N*) refer to its section 1.

---

## M1 - T1' recompression oracle (2026-08-07) confirmed

**Question**: if we re-compress a deflate stream that Prism wrote, do we get the same bytes back?

**Why it matters** - this is the plan's central premise. If it holds:

1. **T1 stops being the identity function.** It round-trips through a completely independent encoder, which answers the "the oracle only grades the copy path" criticism.
2. **`create()` can emit bytes indistinguishable from Prism's own output.**
3. Passthrough of original compressed bytes becomes an optimisation, not a requirement.

**Method**: `tools/prism-experiments/t1-recompress.mjs`, Node 24.16.0, pako 3.0.1

```
bundles          : 14
deflate entries  : 1171
byte-identical   : 1171  (100.00%)
mismatched       : 0
elapsed          : 1085 ms
params           : { level: 2, memLevel: 9, strategy: 0, legacyHash: true }
```

**Result**: F6b confirmed. The previous evidence was a CPython zlib measurement plus a 10-sample pako spot check; this covers the whole corpus with the encoder we actually ship.

### Control group - what happens without `legacyHash`

Same file (`Gene Expression.prismt`), omitting only the `legacyHash` option (i.e. pako 3's default):

```
8 / 168 match  (4.8%)
```

**Dropping one option breaks 95% of entries.** From the pako 3.0.0 changelog: *"`legacyHash` default is now `false`. Binary output is now compatible with nodejs by default."* Prism is in the stock-zlib family, so passing it explicitly is mandatory.

**Three layers of defence**:

1. `pako: '3.0.1'` pinned exactly in `pnpm-workspace.yaml` - never a `^` range.
2. Parameters exported as a single frozen constant; call sites never spell out literals.
3. A golden-hash canary test asserting the deflate output of a fixed input in CI.

### Independent corpus: real `.prism` documents

Re-run against 8 real `.prism` files produced by **Prism 10.x on a different machine**, with real experimental content rather than GraphPad's shipped samples:

```
deflate entries : 368
byte-identical  : 368  (100.00%)
```

Combined: **1,539 / 1,539** across two corpora that share neither a Prism version, a machine, nor a content type. The parameter set is not overfitted to GraphPad's build machine.

### Performance note

1,171 entries (inflate + deflate) in 1,085 ms on Node; the corpus is ~1.3 MB compressed. The plan's "1 MB bundle < 100 ms" budget is stated **against the browser**, so it still needs its own measurement (outstanding Phase A item).

---

## M2 - deflate parameter search (2026-08-07) confirmed

**Method**: exhaustive sweep with CPython zlib 1.3.1 over `level` x `memLevel` x `strategy`.

```
1171 / 1171  ->  (level=2, memLevel=9, Z_DEFAULT_STRATEGY)
entries uniquely attributable to any other combination: 0
```

- The earlier claim that some entries needed `Z_FILTERED` was an **artifact**. zlib only consults `strategy` in `deflate_slow` (levels 4-9), so at levels 1-3 `Z_FILTERED` is a **no-op** - a search that tried it first would misattribute every match.
- `memLevel: 9` is load-bearing: 8 and 9 produce different bytes on larger payloads, because memLevel sizes the hash table.
- Independent cross-check: the ZIP general-purpose bit `flag=0x4` means "Fast" compression per APPNOTE 4.4.4. So the level-2 conclusion rests on **two independent observations**, not one fit.

---

---

## M3 - `.prism` vs `.prismt`: same format (2026-08-07) confirmed

**Question**: the sample corpus contained **zero `.prism` files** - every modern-format sample GraphPad ships is a `.prismt` template. `create()` is committed scope, so we were about to write a format nobody had observed. How does a real document differ from a template?

**Method**: `tools/prism-experiments/compare-prism-vs-prismt.mjs` over 8 real `.prism` documents (Prism 10.x) vs 11 shipped `.prismt` templates. The script reports **structure only** - entry layout, JSON key paths, enum values, counts. It never prints cell values, titles, notes or user identity, because the inputs are real research data.

**Result - no format difference could be found.**

| Comparison | Result |
|---|---|
| `document.json` key paths present only in `.prism` | **0** |
| `document.json` key paths present only in `.prismt` | 2 - `sheets.info`, `uiSettings.currentSheets.info` |
| ZIP entry shapes present only in `.prism` | **0** |
| ZIP entry shapes present only in `.prismt` | 6 - `info/`, `data/sheets/*/floating_notes/`, `misc/<uuid>.bin` |

Every difference is **content the documents happen not to contain** (these 8 have no Info sheet), not a structural distinction. The two extensions carry the same container.

**ZIP entry metadata matches the writer spec exactly**, on documents written by a different Prism version on a different machine:

```
createVersion=831 (0x033F: Unix host, spec 6.3)
extractVersion=20 for most entries, 45 for data/tables/* - with NO ZIP64 extra field
flag=0x4  method=8  externalAttr=0x81b60000  extraLen=0
```

**Minimum observed entry inventory** (smallest real document, 70 KB, 4 data sheets + 1 analysis + 1 graph): 31 distinct entry shapes, listed in the script output. Notably it carries `misc/used_fonts.bin` and `analyses/<uuid>/` with the invariant 5-file set.

**Consequences**:

1. C2 is closed. `create()` targets a format we have now observed.
2. F6/F6g's writer rules are confirmed against real documents, not just shipped samples.
3. `minFormatVersion` in these documents is `1-2-0` / `minPrismVersion 10.1.0` - lower than the templates' `1-6-0` / `11.0.0`, so real documents declare a wider compatibility floor.

**NOTE These files are not fixtures.** They are unpublished experimental data. They were read locally to answer a format question and must never be committed or redistributed. A committable `create()` template still has to be either authored from synthetic data (P0) or synthesised by us and validated once in Prism.

---

## M4 - codec fidelity (2026-08-07) confirmed

Every codec reproduces its inputs byte-for-byte. These run in CI (`pnpm test`) and are the project's regression gate.

| Layer | Corpus | Result |
|---|---|---|
| ZIP container | 14 archives | **14 / 14** byte-identical |
| deflate (T1') | 1,171 streams | **1,171 / 1,171** byte-identical |
| JSON | 953 entries | **953 / 953** byte-identical |
| CSV | 72 tables | **72 / 72** byte-identical |
| XML | 121 documents | **121 / 121** byte-identical |
| **Whole stack** (`readBundle` -> `writeBundle`) | 14 archives | **14 / 14** byte-identical |
| Whole stack, incl. real `.prism` documents | 22 files | **22 / 22** via `prismbinder verify` |

The whole-stack figure is the meaningful one: ZIP headers, deflate parameters, JSON layout and CSV quoting all have to be simultaneously correct for it to hold.

### What each layer had to get right

- **ZIP** - three distinct metadata profiles coexist in one archive (`createVersion=831`; `extractVersion` 20 or 45, the latter *without* a ZIP64 extra field; `flag` 0x0 on directories and 0x4 on files; two `externalAttrs` values). The reader captures all of them; the writer replays them rather than recomputing.
- **JSON** - two layouts in one archive (881 entries use tabs with no trailing newline; 72 use four spaces with one, and those 72 are exactly `data/tables/*/content.json`). Scalars keep their source text, so `1676.0`, `-9223372036854775807` and `1.016526170331098e-07` survive. Member order is preserved, including numeric-looking keys in non-ascending order.

  Those two counts are recorded here rather than asserted in the test, which checks the invariant - *exactly these two layouts, no third* - instead. A count assertion fails the moment a valid new document joins the corpus, and a test that fails on correct input teaches you to edit the number rather than read the failure.
- **CSV** - cells stay strings. 69% of numeric cells change if routed through a JS number.
- **XML** - CRLF throughout, no indentation, trailing whitespace, optional BOM, `<X/>` and `<X></X>` in the same file, and entity choices no serialiser reproduces (`&gt;` in text where unnecessary, `&apos;`, `&#xA;`). Nodes keep their markup verbatim and printing is concatenation.

### Bugs this caught

- `TextDecoder` strips a leading BOM by default, so two XML documents came back three bytes short. Fixed with `ignoreBOM: true`, which despite its name means "decode U+FEFF as an ordinary character".
- Tests resolving workspace packages to `dist/` let a stale build decide what was being tested. Vitest now aliases `@prismbinder/*` to source.

---

## M5 - the write path (2026-08-07) confirmed, one gap remains

Editing a cell is not a local operation: the value lives in `data.csv`, but `content.json` records the shape, `data.dt` carries a revision token, and `data/sets/<uid>.json` holds statistics derived from the column. Writing only the CSV produces a file that opens and shows the wrong thing.

**Verified by test:**

| Property | Result |
|---|---|
| Only the entries we declare are changed | every other entry byte-identical |
| Entry set and order are unchanged | no additions, removals or shuffling |
| The edited value survives a reparse | yes |
| Stale caches are left alone (`realsCount` etc.) | yes |
| `content.json` follows a shape change | yes |
| No account name is written by default | `modifiedBy.user` is `""` |
| `anonymize` clears identity and nothing else | yes |

**What this is not.** These assertions compare our output against our own declared intent, so they cannot catch a case where we and Prism disagree about what *should* change. Turning that into a real oracle needs before/after pairs saved by Prism itself (P2), or a `.pzfx` cross-check against the `pzfx` R/Python package. Until then, `prismbinder verify` on a real document plus opening the output in Prism is the honest check.

---

## M6 - synthesis (2026-08-07, confirmed in Prism 2026-08-11)

`createBundle()` builds a bundle with no original to copy from. Every field is taken from the documented format rather than invented, and the result is checked by test:

| Property | Result |
|---|---|
| Our reader accepts it with no error diagnostics | yes |
| It round-trips byte-for-byte through `readBundle` -> `writeBundle` | yes |
| Cells land in the F17 column order | yes |
| ZIP metadata matches the three profiles exactly | yes (`cv=831`; dir `ev=20 flag=0 m=0 attr=41ff0000`; file `ev=20 flag=4 m=8 attr=81b60000`; `data/tables/*` the same but `ev=45`) |
| Both JSON layouts land on the right paths | yes |
| No account name is written | yes |

Field choices that needed a justification rather than a guess:

- `realsCount` / `integersCount` / `textsCount` are written as **0**. Not because zero is right, but because 149 records in the corpus carry `realsCount: 0` over columns full of reals and Prism opens them - so zero is a value Prism demonstrably tolerates.
- `significantDigitsCount` is **7**, constant across all 513 observed records.
- `minPrismVersion` defaults to **10.1.0**, the oldest floor seen in a real document, to maximise what can open the result.
- Entry order reproduces what Prism writes (`data/` -> `data/sets/` -> `data/sheets/` -> `document.json` -> `data/tables/`). Nothing proves the order matters; nothing proves it doesn't.

**The gap local testing could not close, and how it closed.** Byte-fidelity tests need an original, and a synthesised file has none. Reading our own output back proves internal consistency and nothing about Prism's acceptance criteria - the corpus shows what Prism *writes*, never which entries it *requires*.

On 2026-08-11 a bundle written by `createBundle` from a CSV, with no Prism involved at any point, was opened in Prism 11.0.2. It loaded without an error or a repair prompt, as a Column table titled `Dose response`, with the column titles `Dose`, `Control`, `Treated` and all twelve cell values correct.

So the entry set is sufficient: `data/`, `data/sets/*.json`, `data/sheets/<uid>/sheet.json`, `document.json` and `data/tables/<uid>/{content.json,data.csv,data.dt}` are enough for Prism to accept a document. The count caches written as zero, the `1-6-0` format version and the ZIP metadata profile are all accepted as written.

**What that check did not cover.** One sheet, `y_single` columns, no row titles, no X column, and it was not re-saved from Prism. Row titles, an X column and multiple sheets go through the same code and read back correctly here, but have not themselves been in front of Prism. Nothing suggests they are wrong; they are simply not evidence yet.

---

## M7 - conversion (2026-08-07) confirmed

`.pzfx` <-> bundle, run over every document readable on this machine.

| Property | Corpus | Result |
|---|---|---|
| Every cell survives bundle -> `.pzfx` | 72+ tables | yes |
| Every cell survives XML -> bundle | 124+ tables | yes |
| Cells survive bundle -> `.pzfx` -> bundle | 10 documents | yes |
| Dropped content is named, never silent | every document with graphs or analyses | yes |

Cells are compared **subcolumn by subcolumn**, not as one concatenated run. XML tables are ragged - 29 of 124 have subcolumns of differing lengths - and a CSV is a rectangle, so a short subcolumn comes back padded. Compared as a flat sequence that padding shifts every later value and reads as corruption; compared per subcolumn it is what it is, a representational difference that loses nothing. Getting this wrong was the first result of the test, and the fix was to the comparison, not to the converter.

### Two bugs this found

- **The X column was being demoted to Y.** `createBundle` could only write `y_single` columns, so converting an XY table produced four unrelated columns instead of a curve - no cell lost, but the table's meaning gone. Fixed by teaching the writer `xDataSet`, `XYDataTable` and the `xy` table format, which the F17 mapping already specified.
- **`prismbinder inspect` dispatched on extension.** It assumed a bundle and failed on `.pzfx` with a ZIP error - the exact mistake N2 exists to warn about, made by us. It now sniffs magic bytes like every other entry point.

---

## M8 - editor defects found by testing (2026-08-10) fixed

Two faults in the autosave path, both invisible at runtime, both found only because a test tried to use the feature the way a person would.

**Recovery stopped working after the first document of a session.** Autosave writes the document bytes once and the edits repeatedly, since the bytes cannot change while a file is open. That "once" was a boolean that nobody reset when a document was replaced, so the second file wrote `state.json` with no `document.bin` to go with it - and `load()` needs both. Nothing failed, nothing was logged; recovery simply never appeared again.

Fixed by tracking *which* buffer was written rather than *whether* one was. A boolean has to be reset and can be forgotten; an identity comparison cannot, because a different document is a different buffer. The class of bug goes away rather than this instance of it.

**Edits made while a second file was parsing were discarded.** Opening a new document left the old one on screen, and interactive, until parsing finished. Anything typed in that window went into a grid that was about to be replaced - no error, no warning, the value just was not there afterwards. The outgoing document is now cleared before the incoming one is read.

### What this says about the tests

Both faults sat under a suite that was passing. Neither is reachable by a unit test: they live in the ordering between a file dialog, a debounce, a worker round trip and a page reload. The regression test that covers them opens *two* documents, because one was never enough - and it waits for the write to land rather than sleeping, since the first version of it raced a 125 KB write and blamed the app.

---

## M9 - code review (2026-08-10) fixed

Four reviewers over the codebase, every finding checked against the code before being accepted. Six defects were reproducible by execution.

### Reproduced, then fixed

| | What was wrong | Evidence |
|---|---|---|
| **ZIP expansion** | The bomb guard tested the size the archive *declares*, which is a number its author picks. | A 204 KB archive passed with zero diagnostics and inflated to 209,715,200 bytes - 1029x its declared size. Now bounded on produced bytes: 0 bytes returned, `zip/inflate-failed`. |
| **No integrity check** | `crc32` was written, read into metadata, and never compared. | A tampered entry now returns `zip/crc-mismatch`. |
| **`inspect --json` leaked data** | The XML branch serialised the whole `Project`, including every cell. The bundle branch never did. | 612 cell values in the output of one sample; now 0. |
| **`diff` exit code** | A file that would not parse produced "No cell differs" and exit 0 - in the one workflow where that answer matters. | Now exit 1. "Compared, found nothing" and "could not compare" are distinct results. |
| **Alternate data streams** | `isSafeEntryName` accepted `readme.txt:hidden`. On NTFS that is not a filename; it is a stream attached to another file. | `extract` created a hidden 16-byte stream while reporting "2 entries" for one visible file. Now refused, along with reserved device names and the other characters Windows cannot store. Checked against 2,052 real entries: none rejected. |
| **Column off-by-one** | An X dataset whose record could not be resolved was treated as `series`, the rarest case (2 of ~500). Every Y column shifted left by one - on the write path too. | `dataSetStarts` went `[1,2]` -> `[0,1]`, so an edit to Y1 would land on X. Fixed to match the documented formula, plus a diagnostic when the guess is being made. |

### Also fixed

A rejected edit still minted a revision token and rewrote `document.json`, so a save that changed nothing looked like a change. Row-title and X datasets were never recomputed on edit, only Y. `createBundle` wrote each column's row span as the table height rather than the column's own extent, disagreeing with what `edit.ts` computes for the same field. `new ByteWriter(0)` looped forever. The editor could restore work the user had undone, could let a slower parse overwrite a newer one, and leaked collapsed-state between analysis sheets. `export` and `anonymize` discarded error diagnostics and exited 0. `e2e/` was in no `tsconfig` include list, so a deliberate type error passed CI.

### What the review says about the tests

Every one of these sat under a green suite. The `--json` leak was introduced *in the same session* that added a test asserting `diff` never prints values - the principle was written down and then not applied one file away. The gap was not knowledge; it was that no test asked the question. There are now process-level CLI tests (exit codes, stream separation, extraction against a hostile archive), hostile-input tests for the ZIP layer, and edit tests for the cases the corpus suites structurally could not reach.

---

## M10 - naming (2026-08-11)

The project was called `pzkit`, then `OpenPrism`, and is now `prismbinder`. The middle step was a mistake worth recording, because it was caught by searching rather than by thinking.

`OpenPrism` collides with [OpenAI Prism](https://openai.com/prism/), a LaTeX/AI workspace for scientists launched 2026-01-27 - the same audience as this project - and with [OpenDCAI/OpenPrism](https://github.com/OpenDCAI/OpenPrism), an npm-installable clone of it. The name had stopped meaning "an open implementation" and started meaning "the OpenAI Prism clone".

### How the final name was chosen

3,018 candidates containing `prism`, filtered by five independent signals:

| Signal | Coverage | Eliminated |
|---|---|---|
| npm + PyPI | 3,018 names, 6,036 requests | 40 |
| DNS (apex and `www`, over .com/.io/.dev/.org) | top 800, 6,400 lookups | 175 |
| GitHub account name | top 200 | 3 |
| Web search | 212 names | 35 |

**DNS was the strongest filter, by a factor of five over web search.** `prismatlas`, `prismloom` and `prismledger` each returned zero web results while their .com was serving a site - and the first two had already been recommended on the strength of a clean search. No single signal was sufficient; three separate recommendations were withdrawn after a later filter contradicted an earlier one.

Two flaws in the method were found and fixed while running it: the DNS check initially queried only the apex, reporting `prismaccess` free while `www.prismaccess.com` served a company's site; and the npm scope endpoint silently rate-limited to HTTP 429, which a control name in each batch exposed as noise rather than data.

`prismbinder` was the only high-ranking name with zero hits on all five signals. It also describes the format: a `.prism` file is sheets, datasets and analyses bound into one container.

---

## Outstanding - requires the Prism GUI

| ID | Content | Status |
|---|---|---|
| ~~P0-observe~~ | First observation of `.prism` | **resolved by M3** without needing the GUI |
| ~~P0-open~~ | Does a generated bundle open in Prism? | **resolved 2026-08-11**. It does. See M6 |
| P1 | E0-a/b/c plus 6 section-removal candidates | waiting |
| P2 | Four before/after mutation pairs (makes T2 non-circular) | waiting |
| P3 | Unobserved `dataFormat` values (`y_cv`, `y_cv_n`, `y_sd_n`, `y_se_n`, `y_se`) | waiting |
