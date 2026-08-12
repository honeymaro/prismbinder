# Comparing our charts against Prism, without doing it by eye

Every chart defect found so far was found by putting a screenshot of ours beside
a screenshot of Prism and looking: the connecting line ran through the
replicates rather than the means, the survival curve sloped where it should have
stepped, the error bars had no caps, the axis title sat on the tick labels. That
works and does not scale, and it only catches what someone happens to look at.

This is the machinery for doing it automatically. It has three layers, and they
are worth keeping separate because they need very different things.

## Layer 1 - numbers Prism already computed. No Prism needed

The strongest check, and the only one that is entirely automatic today, because
the reference is inside the file.

| What is stored | Where | What it checks |
|---|---|---|
| `descriptiveStatistics` | `COLUMN_STATISTICS` results | Every number a box plot or an error bar is made of, at full precision |
| dendrogram linkage | `HIERARCHICAL_CLUSTERING` results | The tree we draw, join for join |
| `medianSurvival` | `SURVIVAL` results | The Kaplan-Meier estimator |
| fitted curves | ordinary data tables | The curve Prism drew, as points |

This layer already settled a real question: of five common percentile
definitions, only the Weibull rule reproduces the quartiles Prism stored, which
is what the user guide means when it warns that Prism differs from Excel. See
M14 in `docs/measurements.md`.

Its weakness was coverage. The whole corpus holds **one** `COLUMN_STATISTICS`
analysis over **two** columns, which cannot exercise ties, even lengths, single
values, or a sample whose whiskers fall outside the fence. Widening it inside
Prism is P5 in `docs/measurements.md` and needs a licence.

### Layer 1b - numpy, scipy and statsmodels. No Prism, no licence

`oracle.py` computes the same descriptions independently, and
`packages/charts/src/summary.oracle.node.test.ts` compares a few hundred
generated samples against it.

This is not a second-best substitute for the stored statistics. numpy spells
Prism's percentile rule `method="weibull"`, and it reproduces all three stored
quartiles of the fourteen-value column exactly - `7.75`, `50.5`, `138.75` - as
well as the stored `sd` and `meanSE` to the last digit. Agreeing with numpy over
three hundred samples is therefore the same claim as agreeing with Prism over
two columns, made far more times.

| Checked | Against |
|---|---|
| every percentile we draw | `numpy.percentile(method="weibull")` |
| mean, sd, sem | `numpy.mean`, `numpy.std(ddof=1)`, `scipy.stats.sem` |
| Tukey whiskers | the textbook fence, plus our documented clamp to the hinges |
| Kaplan-Meier | `statsmodels.duration.survfunc.SurvfuncRight` |

The suite skips when Python or the modules are absent, the same way the corpus
suites skip when no Prism installation is found.

It was checked by breaking things on purpose. Swapping the Weibull rule for
Excel's, dividing the variance by `n`, and taking the survival product over the
risk set after removing same-time censors each made it fail, in four suites and
several hundred cases. A comparison harness that has never been seen to fail is
not evidence.

## Layer 2 - reference SVGs exported from Prism

Prism draws the figure; we compare structure against it.

**Prism exports SVG**, and its scripting language can be driven from outside:

```
prism.exe @script.pzc
```

A script that produces references looks like this:

```
SetPath "C:\path\to\references"
Open "C:\path\to\document.prism"
GoTo G, 1
ExportSVG "document-graph-1.svg"
GoTo G, 2
ExportSVG "document-graph-2.svg"
Close
OpenOutput "done.txt"
WText "done"
```

Prism returns immediately and runs invisibly, so a harness waits for `done.txt`
rather than for the process. `generate.mjs` writes such a script for a list of
documents, using our own reader to count the graphs.

**This machine cannot run it.** The installed Prism is in Viewer mode - the
window title says so - and export is not available there. `Open` works, so the
mechanism is confirmed as far as it can be; the rest needs a licensed Prism.

Until then the same references can be produced by hand: open a document, and
for each graph use File, Export, SVG. Once a reference exists it is checked on
every run forever, so this is a one-time cost per document rather than a
per-change one.

### There is no open-source substitute, and there is a reason

Worth writing down so it is not searched for twice. No open-source tool renders
a Prism graph, because the graph is PCFF and nobody has decoded PCFF. `prism2R`,
the only reader of third-generation bundles, says so in its own README:

> the graphs even in a `.prism` file are still stored in a proprietary binary
> format and therefore inaccessible

`pzfx` (R and Python) reads and writes data tables only. `prismWriter` writes
tables only. The gap is the same one this project has: the drawing is not in a
format anyone outside GraphPad can read, so layer 2 needs a licence or nothing.

Reproducing a chart in matplotlib or ggplot2 is not a substitute either. It
would test whether we agree with matplotlib's conventions, which is a different
question from whether we agree with Prism's, and the two disagree on real points
- default whisker rule, whether error bars are capped, where a bar baseline
sits.

## Layer 2b - the curves Prism already drew, stored as points

There is one place where Prism's own drawing survives as numbers, and it needs
no licence. A curve fit writes its fitted curve into an ordinary data table of
**1000 rows**, which is Prism's rendered line sampled finely enough to be
compared point by point. `prism2R` notes the same thing: "lines from a curve
fitting analysis are available, albeit buried in internal `.csv` files".

In the corpus:

| Document | Sheet | Rows |
|---|---|---|
| `MV- Simple Nonlinear Regression.prismt` | `Nonlin fit of ...:Curve` | 1000 |
| `Dose-response curves.pzt` | `Nonlin fit of Transform of Data 1:Curve` | 1000 |

Two of these carry a generated series X (`startValue` plus `interval`), so
reading them at all exercises the series rule from `docs/format/README.md`. What
they can check is the curve geometry of the one chart family where we would
otherwise have nothing: whether the line we draw passes through the points Prism
drew it through.

**References are not committed.** A Prism export of a GraphPad sample is
GraphPad's rendering of GraphPad's content, and an export of a user document is
that user's data. Same rule the corpus follows.

## Layer 3 - structural comparison

`features.mjs` reads any SVG - ours or Prism's - and extracts what can be
compared across two renderers that agree about nothing cosmetic:

- how many symbols are drawn, which is how "we plot every replicate, Prism
  plots the mean" shows up as a number
- how many long vertical strokes there are, and how many of their ends carry a
  crossing cap, which is the error bar question
- whether a path alternates horizontal and vertical moves, which is the
  staircase question
- the numeric tick labels, which give the axis range

Nothing is measured in pixels. Fonts, colours, page size and anti-aliasing all
differ between the two and none of those differences is a mistake, so a pixel
diff would report a hundred findings and hide the four that matter.

`compare()` returns findings rather than a verdict. Some disagreements are ours
by choice - gridlines, legend placement, colour - and a harness that failed on
those would be switched off within a week. It reports the shape of the
disagreement and a person decides; the ones already decided are written down in
`docs/charts.md`.

## What to do with it

Ordered by what is possible without a licence, because for now nothing else is.

1. **Done: layer 1b.** The arithmetic is checked against numpy, scipy and
   statsmodels on every run.
2. **Next: layer 2b.** Compare our fitted-curve chart against the 1000-point
   curves already in the corpus. Needs no Prism and no reference images.
3. Wire layer 3 into the corpus suite, skipped when no reference is present -
   the same shape as the existing corpus tests, which skip when no Prism
   installation is found.
4. When a licensed Prism is available again: export references for a handful of
   documents covering the eight table kinds, and widen the stored statistics
   (P5 in `docs/measurements.md`). Both are one-time costs that keep paying.
