# prismbinder

A TypeScript toolkit for reading, writing and editing **GraphPad Prism** files - in the browser and in Node.

> **Unofficial.** prismbinder is not affiliated with, endorsed by, or sponsored by GraphPad Software or Dotmatics, and is not a GraphPad product. GraphPad(R) and Prism(R) are trademarks of their respective owners, and appear here only to identify the file format this software reads - the same way `libpng` names the format it decodes. No GraphPad source code, sample documents, templates, or other assets are included in this repository or in anything published from it.

A `.prism` file is a bound collection: data sheets, datasets, analyses and graphs, gathered into one container. This binds and unbinds them.

## Why

GraphPad describes the Prism 10+ format as intentionally open - the user guide states it "operates much like a zip file", that "data are stored in CSV format and all analysis parameters and results are stored in standard JSON schemas", and that "nothing gets locked away inside a file that can only be accessed if you're using Prism".

Existing tooling stops short of that promise:

| Project | Language | Read | Write | Notes |
|---|---|---|---|---|
| `pzfx` (Yue-Jiang) | R (CRAN), Python (PyPI) | `.pzfx` tables | yes | The de-facto standard. Tables only |
| `prism2R` (Biomiha) | R | `.prism` bundles, analysis results | no | The only prior art for the modern format |
| **prismbinder** | **TypeScript** | both formats | yes | **Runs in a browser. Reports what it cannot preserve** |

Nothing existed for JavaScript, nothing ran client-side, and nothing attempted lossless round-trips.

## Status

Reading, editing and converting both formats works and is verified byte-for-byte against real documents. Creating a file from scratch is implemented but not yet confirmed against Prism itself.

| | | |
|---|---|---|
| done | Read `.prism` / `.prismt` bundles | structure, tables, datasets, analyses, graphs (as opaque blobs), layouts |
| done | Read `.pzfx` and XML `.pzt` | including the XSLT-wrapped samples, and documents with no namespace |
| done | Byte-exact round trip | 14 archives, 1,171 deflate streams, 953 JSON entries, 72 CSV tables, 121 XML documents |
| done | Edit cells and save | with the derived-value updates Prism expects, and nothing else touched |
| done | CLI | `inspect`, `validate`, `extract`, `export`, `verify`, `anonymize`, `new`, `convert`, `diff` |
| done | Browser app | open, browse, edit, undo, plot, autosave, save a copy, all client-side |
| done | `convert` between formats | data crosses over intact; everything dropped is enumerated |
| open | `create()` from nothing | writes a well-formed bundle; whether Prism *opens* it is unconfirmed |
| never | Rendering graphs | out of scope, deliberately. See below |
| never | Recomputing statistics | out of scope, deliberately |

`docs/measurements.md` records what has been executed and confirmed, separately from what is still assumed. `docs/format/` is the format specification that came out of the work.

## Design commitments

**Byte fidelity is checked, not claimed.** Prism's deflate streams re-compress byte-for-byte with one exact parameter set; all 1,171 entries in the sample corpus round-trip through an independent encoder. That turns "we didn't corrupt your file" into something CI can prove without opening Prism.

**Opaque data is preserved, never guessed.** Graphs live in a 30-year-old binary blob (PCFF) that we deliberately do not attempt to author. Anything we cannot fully model is carried through byte-for-byte, and any edit that would invalidate it produces a diagnostic instead of silent damage.

**Parsing never throws on file content.** Unknown classes, newer format versions and malformed regions become diagnostics; the document still loads.

**The browser is the primary target.** `@prismbinder/core`, `@prismbinder/formats` and `@prismbinder/model` may not import Node built-ins - enforced by a lint rule and by running the whole test suite in Chromium on every commit.

**We do not recompute statistics.** Prism's analysis results are read, displayed and exported. Reimplementing its statistics engine is explicitly out of scope.

## Packages

| Package | Purpose |
|---|---|
| `@prismbinder/core` | ZIP, deflate, and byte-faithful JSON / XML / CSV primitives |
| `@prismbinder/formats` | `.prism` / `.prismt` bundles and `.pzfx` XML documents |
| `@prismbinder/model` | Format-neutral document model, conversion, anonymisation |
| `@prismbinder/cli` | `inspect`, `validate`, `extract`, `export`, `verify`, `anonymize`, `new`, `convert`, `diff` |
| `apps/editor` | Browser app: drop a file, browse its sheets and tables |

### The editor

Rows are virtualized, so a table at the format's 500,000-row ceiling scrolls at the same speed as one with ten. Columns are not: across every document we can read, the widest table is 44 columns and the median is 5, and virtualizing an axis that does not grow costs accessibility for nothing. It stays a real `<table>` with `role="grid"` and true `aria-rowindex` values, so a screen reader announces the real position in the real total, and find-in-page still works.

Edits go through a command stack rather than state snapshots - reversing a change costs the same whether the table has ten rows or half a million. Consecutive typing in one cell coalesces into a single undo step; a clear or a paste stays its own.

A document with unsaved edits is autosaved to the origin private file system along with its undo stack, and offered back if the tab dies. It never leaves the browser; there is no server to lose it to.

"Plot the data" draws the numbers with d3. It is **not** Prism's graph - that geometry is a binary blob we carry but do not decode - and it says so on the plot, every time.

## Development

Requires Node >= 20.19 and pnpm 10. All dependencies are pinned through the
workspace catalog, so install them with `pnpm add` rather than editing
`package.json` by hand.

```bash
pnpm install
pnpm exec playwright install chromium   # for the browser test project

pnpm verify        # typecheck + lint + build + test (Node & browser)
pnpm test:node     # faster inner loop
pnpm test:browser  # the runtime-contract gate
pnpm test:e2e      # drives the built app in a real browser
```

### Trying it

```bash
pnpm build
node packages/cli/dist/cli.js inspect path/to/file.prism
node packages/cli/dist/cli.js export  path/to/file.prism ./out
node packages/cli/dist/cli.js verify  path/to/file.prism   # byte-exact round trip?
node packages/cli/dist/cli.js new     out.prism data.csv   # build one from scratch
node packages/cli/dist/cli.js convert in.prism out.pzfx    # move the data across
node packages/cli/dist/cli.js diff    a.prism b.prism      # what actually changed
```

`diff` answers the question the write path is judged on - *did my edit touch
only what it should have?* - in three layers: which archive entries moved, which
JSON paths hold different values, and (with `--cells`) which table coordinates
changed. It prints paths and coordinates, never values, because a diff often
ends up in a CI log and some of these documents are unpublished data. Exit code
1 when anything differs, so it works as a check in a script.

`convert` moves *data*, not documents, and prints what it left behind every
time. Graphs and analyses cannot cross: in both formats they live inside the
same legacy binary we decline to author. Saying so on every run is deliberate -
a conversion that looked complete while dropping the analyses would be the most
dangerous thing this tool could do.

`new` is the one command whose output we cannot verify without Prism. Everything
else is checked against real documents; a generated file has no original to be
compared with, and no local test can establish which entries Prism *requires*
rather than merely writes. It reproduces the documented layout exactly - the
three ZIP header shapes, both JSON styles, the F17 column mapping - and reads
back byte-identically through our own reader, which is a necessary condition and
not a sufficient one. Until someone opens one in Prism, prefer editing an
existing document.

Corpus fidelity tests read a local Prism installation and skip themselves when
there isn't one, so CI checks the codecs while a developer's machine
additionally checks them against several hundred real documents. Point
`PRISMBINDER_CORPUS_DIRS` at extra directories to widen that.

### Repository layout

```
packages/          the toolkit
apps/editor/       browser editor
e2e/               Playwright smoke tests against the built app
docs/              measurements, format notes, diagnostics registry
fixtures/authored/ test files created by hand (committed)
fixtures/vendor/   synced from a local Prism install (never committed)
tools/             format analysis scripts and experiments
```

## Fixtures and copyright

Sample files shipped with Prism are GraphPad's copyrighted content and are **never committed**. `fixtures/vendor/` is gitignored and populated from a local installation; committed fixtures under `fixtures/authored/` are hand-made from synthetic data.

## License

MIT - see `LICENSE`. The licence covers the software and grants no rights in
any trademark; the trademark notice is in the same file.
