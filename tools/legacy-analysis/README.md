# legacy-analysis

Scripts that analyse GraphPad Prism **data files** - bundles, `.pzfx` documents and the legacy PCFF container. They are the reference implementation and cross-check for prismbinder, and are not part of the build.

Everything prismbinder documents was established by reading files: their bytes, their structure, and the statistical regularities across a corpus of them. `docs/format/` and `docs/measurements.md` cite these scripts and nothing else.

## Commit policy

| Path | Commit | Reason |
|---|---|---|
| `*.py`, `measurements/t-*.mjs`, `measurements/*.json` | yes | Analysis code we wrote, and its results |
| `measurements/{fflate,fxp,hp2,jsoncp,pxml,zipjs}.mjs` | no gitignored | **Other people's libraries**, fetched whole from a CDN so the experiments could run without a package.json. See below |
| `local/` | no gitignored | Local-only tooling. Not part of this project's published work |
| `res/`, `resrc/`, `tmpl/`, `extracts/` | no gitignored | **GraphPad's content.** Never redistributed |

The scripts regenerate every output from a local Prism installation on demand. No output is committed, and no GraphPad file is copied into the repository.

## Scripts

| File | Purpose | Facts established |
|---|---|---|
| `bundle.py` | Dumps `.prism` / `.prismt` ZIP bundles | section 3, the bundle reader |
| `schemas.py` | Bundle JSON schema catalogue - aggregates `$id`, `@class`, field names | F12, F16 |
| `verify.py` | `.dt` digest checks, `formatVersion` distribution, `analysisClass` enumeration | F8, F11 |
| `survey.py` | CSV characteristics, ZIP entry ordering, compression statistics | F5, F6, F7 |
| `pzfx.py` | `.pzfx` XML structure and attribute enumeration | N1, N5, N10 |
| `tmpl.py` | Decodes `<Template>`: base64 -> zlib -> PCFF | F9 |
| `pcff.py` | PCFF container - entropy map, signatures, length-prefixed strings | section 2 optional item |
| `pzser.py`, `pzkeys.py` | Decodes the tag grammar of PCFF's embedded zlib extension dictionary | section 2 |
| `databin.py` | Analyses `graphs/*/data.bin` headers | F10 |

### `measurements/`

Measurement scripts written while validating the plan. **This is the evidence behind F6b-F6f, the deflate encoder families.**

| File | What it measures |
|---|---|
| `t-zip.mjs`, `t-zip2.mjs` | How much ZIP entry metadata fflate and zip.js can actually control |
| `t-fxp*.mjs` | fast-xml-parser round-trip fidelity (mixed content, entities, DOCTYPE) |
| `t-xmlspan.mjs` | `@rgrove/parse-xml` offset coverage |
| `jsoncp.mjs` | `jsonc-parser` `modify`/`applyEdits` byte-preservation check |
| `node_out.json`, `py_out.json` | Raw comparison data for pako vs `node:zlib` vs CPython zlib |

## The vendored bundles

Six of the measurement scripts import a library directly rather than through a
package.json, because these experiments predate the workspace. Those bundles are
not committed - they are other people's code under other people's licences, and
they are one command away:

```bash
cd tools/legacy-analysis/measurements
curl -o fflate.mjs https://esm.sh/fflate@0.8.3
curl -o fxp.mjs    https://esm.sh/fast-xml-parser@5.10.1
curl -o hp2.mjs    https://esm.sh/htmlparser2@12.0.0
curl -o jsoncp.mjs https://esm.sh/jsonc-parser@3.3.1
curl -o pxml.mjs   https://esm.sh/@rgrove/parse-xml@4.2.3
curl -o zipjs.mjs  https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.8.34/+esm
```

The versions are the ones the measurements in `docs/measurements.md` were taken
against; a different version may give a different answer, which is the whole
point of pinning them here.

## Reproducing

```bash
python bundle.py "C:/Program Files/GraphPad/Prism/SampleData/MultipleVariables/Wine.prismt" document.json
python schemas.py "C:/Program Files/GraphPad/Prism/SampleData/MultipleVariables/*.prismt"
python survey.py "C:/Program Files/GraphPad/Prism/SampleData"
```

## Plan

The design document is kept outside the repository. Facts these scripts establish are numbered F1-F17 and N1-N12 in its section 1; the confirmed ones are restated in `docs/measurements.md`, which is the copy that travels with the code.
