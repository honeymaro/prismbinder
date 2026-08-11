# External fixtures

Prism documents borrowed from other open-source projects, to widen the corpus
past what one machine's Prism installation contains.

Nothing here is committed except this file. `MANIFEST.json` records where each
document came from, at which commit, and under which licence;
`tools/fetch-external-fixtures.mjs` downloads them again from those same
commits.

```bash
node tools/fetch-external-fixtures.mjs
PRISMBINDER_CORPUS_DIRS="$PWD/fixtures/external" pnpm test:node
```

## Why these

The corpus this project was built from - the samples GraphPad ships, plus a
handful of real documents - turned out to be narrower than it looked. It
contained none of the subcolumn layouts Prism can write, and every archive in it
had been written by the same kind of machine. Two published parsers keep test
fixtures that fill both gaps.

| Source | Licence | What it adds |
|---|---|---|
| [Yue-Jiang/pzfx](https://github.com/Yue-Jiang/pzfx) | MIT | 23 `.pzfx` documents covering `y_cv`, `y_cv_n`, `y_sd_n`, `y_se`, `y_se_n`, upper/lower limits, a `HugeTable`, comma decimals, ragged subcolumns, date axes and X-with-error |
| [Biomiha/prism2R](https://github.com/Biomiha/prism2R) | MIT | 3 `.prism` bundles, two of them written on a machine whose umask differs from ours |

The sources are pinned to commits rather than to `master`, because
`docs/measurements.md` cites counts taken against these exact files.

## What they found

Adding them broke four suites on the first run, and each break was worth having:

- `toBundle` silently dropped the second subcolumn of an X column, losing the
  error values of every XY table that had them. Fixed.
- `verify` only understood ZIP bundles, so the `.pzfx` half of the project -
  where byte fidelity is the harder problem - could not be checked from the
  command line at all. Fixed.
- The documented "three ZIP metadata profiles" was an artifact of a uniform
  corpus. Permissions vary with the writing machine, and `extractVersion 45` is
  not a property of the `data/tables/` path. Documentation corrected, and the
  test now asserts what is actually invariant.
- The corpus helpers treated every ZIP as a Prism bundle. One fixture is a ZIP
  holding a single empty directory; refusing it is correct behaviour and was
  being counted as a failure.

Every one of these passed against the original corpus. A test suite is only as
honest as the inputs it has been shown.
