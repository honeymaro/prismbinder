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

- **ZIP** - several metadata profiles coexist in one archive (`createVersion=831`; `extractVersion` 20 or 45, the latter *without* a ZIP64 extra field; `flag` 0x0 on directories and 0x4 on files; `externalAttrs` varying with the writing machine). The reader captures all of them; the writer replays them rather than recomputing, which is why widening the corpus changed the counts without changing the result.
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
| ZIP metadata matches the profile Prism writes | yes (`cv=831`; dir `flag=0 m=0`; file `flag=4 m=8`; `data/tables/*` at `ev=45` with `0666`) |
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

## M11 - a wider corpus (2026-08-11)

The corpus was every Prism document on one machine: fourteen shipped templates and eight real files, all written by the same kind of writer. Two published parsers keep MIT-licensed test fixtures, and adding 27 of them - 23 `.pzfx` and 3 `.prism` - broke four suites on the first run.

| What broke | What it turned out to be |
|---|---|
| `convert` cell comparison | **A real defect.** `toBundle` kept only `x.subcolumns[0]`, so an X column carrying error values lost them. Every XY table with error bars had been converting wrong. |
| `verify` on 24 of 27 files | **A real gap.** The command existed to prove byte fidelity and only understood ZIP bundles, so the XML half of the project - where fidelity is the harder problem - could not be checked from the command line at all. |
| ZIP metadata profile | **A documented fact was wrong.** "Exactly three profiles" held only because every archive came from one kind of machine. Permissions vary with the writer's umask, and `extractVersion 45` is not a property of the `data/tables/` path: nine archives carry both 20 and 45 inside it. What survives is that `ev` is 20 or 45 and that `45` always travels with `0666`. |
| bundle reader over the corpus | **A test assumption.** One fixture is a ZIP holding a single empty directory. Refusing it is correct; the suite counted the refusal as a failure. |

The new fixtures also cover five subcolumn layouts the original corpus never contained - `y_cv`, `y_cv_n`, `y_sd_n`, `y_se`, `y_se_n` - plus a `HugeTable`, comma decimals and a date axis. All 24 `.pzfx` documents round-trip byte-for-byte.

Nothing is committed: `tools/fetch-external-fixtures.mjs` downloads them from pinned commits, and `fixtures/external/README.md` records why each source was chosen.

**The general point.** Every one of these four passed against the original corpus, for months, at 297 green tests. A suite is only as honest as the inputs it has been shown, and a corpus drawn entirely from one machine will agree with itself.

---

## M12 - reading the vendor's own documentation (2026-08-11)

1,495 pages of the Prism 11 guides went past the implementation, looking for anything the format work had not covered. The guides are about using Prism, so most of it does not touch a file format at all. Four things did, and one of them pointed at a file already sitting on disk.

**The user guide tells programmers to read `PrismXMLSchema.xml`**, shipped in the Prism program folder, "using that (and by exporting sample files from Prism) a programmer could enable other programs to export data in Prism XML format". That file had been examined before, for which elements and attributes exist (M-N10: it is XDR, it describes Prism 9, twelve attributes in real files are undeclared). Its *enumerations* had never been checked against what we write. They should have been - the `.pzfx` writer was emitting three values that are in no enumeration and in none of the 137 pzfx-family documents examined:

| Written | Problem |
|---|---|
| `XFormat="number"` | The member is `numbers`. Singular appears nowhere |
| `YFormat="none"` | No such member. Real files omit the attribute; 52 tables do |
| `TableType="XY"` on a table with no X column | Every `XY` table in the corpus has an X. Such a table is `OneWay` or `TwoWay` |

Plus an internal inconsistency the schema had nothing to say about: `<XColumn Subcolumns="1">` was hardcoded while all of the X subcolumns were written after it, so an X with error values announced a width it did not have.

None of this was caught because our own reader is permissive: it reads attributes it does not validate, so everything round-tripped cleanly. The suite now checks the written document against the enumerations rather than against ourselves.

**Excluded values had no representation at all.** The `.pzfx` reader parsed `Excluded="1"` and the model discarded it; the bundle's `cellAttributes` were never read. Prism keeps such a value visible on the table and leaves it out of every analysis and every graph, and its own export dialog asks what to do about it - which is the tell that the question has no default answer. `export` emitted them as ordinary numbers with nothing to say so. The same mechanism carries `CENSORED`, without which a survival table's meaning is not recoverable.

**Generated X columns were dropped.** An X dataset whose format is `series` occupies no CSV column; its values come from a start value and an interval. Reading only the stored columns lost the X axis of three documents, 1000 rows each - and the exported table looked like a perfectly ordinary one with no X, which is worse than an error. The rule is arithmetic, `startValue + i * interval`; two of the three land on exactly `1000.0` and `72.0` at the last row, against `0.2459` and `1.0` for a geometric reading.

**The pzfx half of the model reported `storage: 'direct'` unconditionally**, and put the XML's own `YFormat` spelling into a field that holds the bundle's vocabulary everywhere else. So `low-high` - a value with two offsets - was reported as though the stored numbers were the displayed ones, which is the single answer `StorageSemantics` exists to prevent, and the same table read as `low-high` or `y_high_low` depending on which file it came from.

Two facts fell out of chasing that last one. `upper-lower-limits` is genuinely different from `low-high`: it stores absolute bounds (100, 110, 70) where the other stores offsets (100, 10, 30), and the bundle vocabulary has one name for both. And an open question closed: **`y_cv` stores a standard deviation.** Every dataset inside a `y_cv` table declares its own format as `y_sd`, and inside `y_cv_n` as `y_sd_n`. A third-party report had claimed this; it could not be checked while the corpus had no such table, and now it can.

**The general point.** M11 was about the corpus being too narrow. This one is different: the answer was in a file the vendor ships specifically so that other software can write this format, and the project had already opened that file for a different question. Reading a source once, for one purpose, is not the same as having read it.

---

## M13 - reviewing M12 (2026-08-11)

The M12 changes went through review before landing. Four of the findings were in the code M12 had just added.

**Two of them were denial of service, and both were new.** Reading the generated X column meant knowing how many rows to generate, and the row count was taken as `max(rows in the CSV, numberOfRows from content.json)`. Nothing validates `numberOfRows`. A 1,299-byte archive claiming twenty million rows exhausted the heap and killed the process. Separately, expanding `cellAttributes` ranges cost `ranges x span`, and both come from the file: 5,000 copies of one full-width range in a 2,666-byte archive burned 92 seconds of CPU.

Neither is a decompression bomb, which is why the existing ZIP defences - ratio caps, entry counts, bounded inflation - did nothing. The amplification is a small integer.

| | before | after |
|---|---|---|
| 1,299 B, 20,000,000 claimed rows | heap exhausted, process killed | 33 ms, 0 cells, 7 MB |
| 2,666 B, 500,000,000 range expansions | 91,841 ms | 121 ms |

The fix for the first is to stop consulting `numberOfRows` at all: producing a row costs a row of bytes, claiming one costs ten characters, and the two agree on all 95 tables in the corpus. The fix for the second is a per-subcolumn budget - a subcolumn cannot have more marked cells than it has cells.

**One was a fix that was only half right.** M12 replaced `YFormat="none"`, which is in no enumeration, with omitting the attribute whenever a column had one subcolumn. Recounting the corpus by table kind rather than by width showed that no `XY` table omits `YFormat` - all 36 single-subcolumn ones write `replicates` with a count of one - so the new output was a combination that appears in none of the 137 documents. One unattested thing had been swapped for another. The rule is the table kind: `OneWay`, `Survival` and `Contingency` omit it, nothing else does.

**One was older than M12 but newly dangerous because of it.** `convert` never told the `.pzfx` writer what the subcolumns meant, so every error-bar table went out as `YFormat="replicates"`. The fixture set happens to contain the same document in both formats, which makes Prism its own oracle: our conversion disagreed with Prism's on 9 of 13 tables, writing `replicates` where Prism writes `SDN`, `SEN`, `CVN`, `CV`, `low-high`, `upper-lower-limits`. Prism averages replicates, so a mean of 100 with an SD of 10 would have come back as 55. This was not introduced by M12 - but M12 made the file schema-conformant, and a file Prism rejects cannot be misread by it. Wiring the layout through brings the disagreement down to 2, both of them losses the conversion now declares: the table kind is rebuilt from the columns, and the bundle keeps no record of whether a three-subcolumn error layout held offsets or absolute limits.

**And a parser that was too willing.** `Number("")` is `0`, so `rows: ""`, `"~5"` and `"0~"` all parsed as valid ranges naming row 0. Matching a grammar instead of coercing fixes it, and dropping a mark now says so - an ignored exclusion turns a value Prism never uses into ordinary data.

**The general point.** M12 was written to stop the library from quietly mishandling data, and three of its own additions did something in that family. The two that mattered most were not visible in any test that reads a real file, because real files are not adversarial: they needed a file built to be hostile. That suite now exists.

---

## M14 - charts (2026-08-12)

`@prismbinder/charts` now sits between the model and both front ends, and the
editor and `prismbinder plot` render through the same code. What it draws is in
`docs/charts.md`; what building it taught is here.

**Prism's percentile rule is the Weibull rule, `(n+1)p`.** The user guide warns
that Prism differs from Excel and never says how. Prism's own
`COLUMN_STATISTICS` results give quartiles for two columns of fourteen values,
and of the five common definitions exactly one reproduces all four numbers:

```
values   1 2 4 9 24 35 45 56 67 89 111 222 345 666
Prism    Q1  7.75    median 50.5    Q3 138.75
(n+1)p       7.75           50.5       138.75    <- match
(n-1)p      12.75           50.5       105.5     <- Excel PERCENTILE.INC
```

It agrees with Excel's `PERCENTILE.EXC`. The same two columns pin the standard
deviation to the n-1 divisor, because `sd / sqrt(n)` then reproduces the stored
`meanSE` exactly.

**A Tukey whisker can end inside its own box.** No description of the rule
mentions this and it is not obvious: the fence is built from interpolated
hinges, so on a small skewed sample the furthest real point inside the fence can
sit below q3. `Col. stats of Data 1` has a q3 of 499.625 whose nearest inside
point is 107.5 - a whisker drawn there would end four hundred units inside the
box it belongs to. Found by a property in the corpus suite rather than by
reading. The whiskers are clamped to their hinges.

**The scatter fix in M13 was half a fix.** It stopped the preview joining rows
that are not a sequence, which removed a false trend from 141 sheets, and left
the points where they were: strung along the row number, on tables whose rows
are separate observations. What those tables want is one slot per column with
that column of values stacked in it - what Prism calls a scatter dot plot.
Removing the line was the visible half of the problem.

**The oracle is still two columns wide.** Everything above about percentiles and
standard deviations rests on one `COLUMN_STATISTICS` analysis over two columns,
in a file that cannot be committed. That is enough to have chosen the right rule
out of five, and would not catch a mistake on ties, on even-length samples, or
on a column holding a single value. Widening it needs a few minutes in Prism.

## M15 - auditing every chart (2026-08-12) fixed

M14 checked the default style of each sheet. This planned **every style the
picker offers, for every sheet, in every document on this machine** - 1,101
charts - rendered each at 680x340 and checked the spec and the finished
document. Five defects, none of which the default-style suite could see.

**Half the corpus drew nothing.** Prism writes cells in the locale the document
was saved in, and **36 of the 71 documents store `82,90279` where the others
store `82.90279`**. `Number` refuses those, so every value was dropped in
silence: `Volcano plot.pzt` holds 480 non-empty cells and produced a blank
picture in all seven styles offered for it. 83 charts were empty for this reason
alone.

The reading was measured before it was adopted, over all **86,665** cells:

| Question | Answer |
|---|---|
| Does any document mix `1,5` and `1.5`? | **No. Zero files.** The separator is a property of the document |
| Is a comma ever a thousands separator? | **No.** 82 cells are shaped like one (`117,114`, `-1,962`) and every one sits in a document that is comma-decimal elsewhere. None appears in a dot-decimal file |
| Does it swallow text? | No. `Mecca, Saudi Arabia` fails the shape `-?\d+,\d+` without needing to be recognised as a name |

The second row follows from `%.18g`: stored numbers are never grouped, because
grouping is a display setting and does not reach a file.

**Tied points escaped their column.** An aligned dot plot nudges equal values
apart by a fixed step, which is fine for ten and ruinous for seventy: the
survival table's Event column is 135 zeroes and ones, and its points ran from
`0.44` to `6.56` on an axis ending at `4` - into the neighbouring columns and off
the chart. **5,132 points were outside their own axes.** The widest tie group is
now measured first and the step shrunk to fit, so small stacks look unchanged.

**Dates and elapsed times in X drew nothing.** Prism offers both as X axis kinds
and three sample documents use them - `9:00:00.000` through `30:00:00.000`, and
`13-Jul-2013`. Neither parses as a number, so every row was skipped for want of
an X. Durations now read as hours; dates read as days from the earliest in the
column, with the origin named in the axis title, which keeps the uneven spacing
that is the whole reason a date axis is not a category axis.

**A before-after plot explained the wrong thing.** It colours one line per row
and the key named the three columns, so twelve of fifteen colours had no entry.

**The key ran off the page.** Entries were placed left to right with no bound;
`Gene Expression` put a swatch at x=694 on a 680-wide page. What no longer fits
is now counted, not dropped in silence.

Two findings were the audit's own fault and are worth recording as such: reading
every number in a path `d` attribute as a coordinate pair misreads the seven
numbers of an elliptical arc and reported every pie as off the page, and looking
a sheet up by title picks the wrong one in `MV- Simple Nonlinear Regression`,
which holds two sheets of the same name. A harness is not evidence until it has
been seen to fail for the right reason - all five real defects were re-introduced
one at a time and confirmed to fail the suite that now guards them.

**What was not a defect.** Box and violin refuse a column of fewer than four
values, as Prism does, and say so in a note on the chart.

---

---

## Outstanding - requires the Prism GUI

| ID | Content | Status |
|---|---|---|
| ~~P0-observe~~ | First observation of `.prism` | **resolved by M3** without needing the GUI |
| ~~P0-open~~ | Does a generated bundle open in Prism? | **resolved 2026-08-11**. It does. See M6 |
| P1 | E0-a/b/c plus 6 section-removal candidates | waiting |
| P2 | Four before/after mutation pairs (makes T2 non-circular) | waiting |
| ~~P3~~ | Unobserved `dataFormat` values (`y_cv`, `y_cv_n`, `y_sd_n`, `y_se_n`, `y_se`) | **resolved by M11 and M12.** All five appear in the widened corpus, the subcolumn counts match on 95/95 tables, and `y_cv*` is settled |
| P4 | Does Prism open a `.pzfx` we wrote? | waiting. The output is now schema-conformant, which is necessary and not sufficient |
| P5 | Widen the descriptive-statistics oracle | **largely answered without Prism.** numpy spells Prism's percentile rule `method="weibull"` and reproduces all three stored quartiles exactly, so `summary.oracle.node.test.ts` now checks a few hundred generated samples - ties, even lengths, single values, twelve orders of magnitude - against numpy, scipy and statsmodels. Running Column Statistics in Prism over awkward columns would still tie the rule to Prism directly rather than through numpy |
