# Chart support: where we are and how to cover the rest

> **Status, 2026-08-12.** C1 to C5 are built and green. `@prismbinder/charts`
> exists; the editor and `prismbinder plot` both render through it. Implemented:
> points and lines, scatter and aligned dot plots, bars (interleaved, stacked,
> horizontal), floating bars, symbol at mean, before-after, box and whiskers with
> all seven rules, violins, pie and donut, Kaplan-Meier curves, and the two
> Multiple Variables figures that are read from the file rather than
> reconstructed. Linear, log and category axes.
>
> Three things this document said turned out to be wrong or incomplete, and are
> corrected in place below: **Prism's percentile rule is now measured**, not an
> open question; **Tukey whiskers need clamping** to their own hinges, which no
> description of the rule mentions; and the C2 work was only half done until
> scatter plots stopped using the row number as an axis.
>
> Not built, and deliberately: a second Y axis, symbol shapes, nudging, arrows
> and per-point formatting. Every one of those is a choice recorded only in the
> PCFF blob, so implementing them would mean inventing an appearance and
> presenting it as the file's.

## Two kinds of graph sheet, and only one of them is opaque

The blanket claim that "graph geometry is a PCFF blob" is true of most graphs and false of a whole
family. The corpus splits cleanly, with nothing in between:

| Sheet `@class` | Count | `data.bin` | sheet.json | What it means |
|---|---|---|---|---|
| `FENGraphSheet` | 38 | `PCFFGRA4`, ~24 KB | **~250-350 bytes**: uid, title, inputDataSets, and nothing else | Everything is in the blob. Not recoverable |
| `GraphSheet` holding an `MVGraph` | 7 | 3 have none; 4 have a **different** binary, magic `00 00 00 00 EE 80 68 01`, ~5 KB | **11-15 KB**: axes with limits and intervals, colormaps, legends, titles, plot geometry, links into the analysis results | Fully described in JSON |

A `FENGraphSheet`'s JSON contains no `Axis`, no `lowerLimit`, no `logarithmBase`, no symbol or bar
settings - checked, all absent. Those seven classic families are as opaque as we have always said.

A Multiple Variables graph is not. Its sheet carries, in readable JSON:

```
axisY <Axis> ... segments[<LinearAxisSegment> lowerLimit=0.0, upperLimit=2.5,
                             interval=0.5, startTicksValue=0.0, ticksVisibility="all"]
gdoSettingsExt.dendrogram <DendrogramFigure::Settings>
     branchesLink="/rows/dendrogram"    <- a pointer into the analysis results
     colormap <CategoricalColormap> colorSchemeID=29, outlierColor="#000000ff"
legends[<CategoricalSymbolsLegend> dockPosition="right", ...]
```

Three of the seven have no binary beside them at all, which proves the JSON is sufficient on its
own for at least the dendrogram and heat map cases.

That gives two different targets, and they should not be confused:

**Fidelity tier 1 - reproduce.** Multiple Variables graphs. We can render what Prism rendered,
because Prism wrote it down.

Bound the claim carefully. **All seven `MVGraph` sheets in the corpus are analysis output** -
heatmaps, dendrograms, clustered-data views and PC scores, from three files. There is no
user-authored MV scatter or bubble plot to check, so what is measured is "every MVGraph we have is
described in JSON", not "every MV graph is". The Format Graph documentation treats bubbles,
symbols, ellipses and hulls as components of the same MV graph, and `BubblesFigure::Settings`
appears in the binary next to `DendrogramFigure::Settings`, which makes the wider claim likely -
but likely is not measured, and the first user-made MV graph we see may say otherwise.

**Fidelity tier 2 - reconstruct.** Everything else. Draw the chart Prism would draw *by default*
for that table kind, computed from the data alone, and say so. Someone without Prism wants to know
whether the assay worked; a bar chart of the right shape answers that, and a line through a column
table does not. The "reconstructed" badge belongs on these and only these.

## Where we are

One chart form. `apps/editor/src/Preview.tsx` draws points, an optional connecting line, and an
optional vertical error bar, on linear axes.

Measured across all **256 data sheets** the editor offers to plot - 95 from ZIP bundles and 161
from XML documents. Both denominators matter and mixing them is easy: the bundle-only count is the
one every other measurement in `docs/measurements.md` uses.

| | |
|---|---|
| has an X column, so an ordered axis exists | 115 |
| no X column, so the row number is the axis | 141 |
| has Y columns wider than one subcolumn | 86 |

By table kind, over all 256: xy 98, multivariable 37, column 35, grouped 33, view 32, partsofwhole
7, survival 6, contingency 5, nested 2, undefined 1. Over the 95 bundle tables alone: view 32,
multivariable 27, xy 25, grouped 6, column 3, survival 1, undefined 1.

**141 of 256 - 55% - have no ordered horizontal axis**, and Prism draws none of those as a line
chart.

How the extra subcolumns are read, after the fix that keyed this on `storage` rather than on the
layout's name:

| | |
|---|---|
| every replicate plotted, no bars | 98 |
| symmetric bar (SD, SEM, or an SD behind a %CV label) | 26 |
| two offsets | 7 |
| absolute limits | 3 |
| nothing beyond the first subcolumn | 122 |

## The catalogue to cover

Recovered from Prism's own Change Graph Type labels rather than from prose.

| Family | Styles |
|---|---|
| Column | Scatter dot plot, Aligned dot plot, Before-after, Bar (one per column), Symbol (one per column), Box and whiskers, Floating bars (min to max), Violin plot, Violin plot (truncated), Scatter plot with bar, Column mean with error bars and mean connected - each with a horizontal variant |
| Grouped | Interleaved / Stacked / Separated / Grouped bars, Interleaved / Separated / Superimposed scatter, Interleaved / Separated / Superimposed symbols at mean or median, Superimposed symbols with connecting line, Interleaved / Separated low-high, Interleaved / Separated box and whiskers, Category graph (symbols and lines, symbols only), Area fill - most with a horizontal variant. Three-way is a Grouped variant |
| XY | Symbols, connecting line (straight, staircase, arrows), spikes and drop lines, area fill, error bars (SD, SEM, 95% CI, range), error envelope with fill, box and whiskers at each X, every replicate plotted, second Y axis |
| Survival | Staircase with ticks, staircase with SE or 95% CI bars, staircase with symbols at censored or at all observations, point-to-point with or without error bars. Y as survival or death, percent or fraction |
| Parts of whole | Pie, Donut, Slice, dot plot, exploded slices |
| Contingency | Bars (interleaved, stacked, grouped, superimposed), symbols |
| Nested | Scatter, aligned scatter, before-after, symbol at mean, bar, box and whiskers, violin |
| Multiple variables | Bubble plot with size and colour mapped to variables, heat map, dendrogram, confidence ellipses, convex hulls |

Box and whiskers alone has seven whisker rules: min to max, Tukey, 10-90, 5-95, 2.5-97.5, 1-99, and
min to max showing all points. The guide contradicts itself on the count - the Format Graph page
says seven, the box-and-whiskers page says six and then lists those seven - so treat seven as the
number to implement and the discrepancy as a reason to check against a real file.

## Architecture

`Preview.tsx` is one file doing selection, scaling and rendering. That is fine for one chart and
will not survive eight families.

Proposed: a new package, `@prismbinder/charts`. Pure, browser-safe, no React, subject to the same
`node:*` ban as the other library packages, and therefore testable in both the Node and browser
Vitest projects.

```
TableView
   |
   v  series.ts     one typed series per column, replicates and spread resolved
   |                (this is today's `build`, promoted out of the editor)
   v  summary.ts    descriptive numbers: mean, SD, SEM, quartiles, KDE, KM steps
   |                quarantined here so the statistics rule has one place to live
   v  marks.ts      chart type -> marks in DATA coordinates
   |                point | line | step | bar | box | violin | wedge | cell | link | ellipse | hull
   v  scales.ts     linear, log, category; nice domains; category spacing modes
   |                (interleave, stack, group, superimpose)
   v  render.ts     marks -> a framework-free element tree
```

Two consumers of the element tree:

- the editor renders it with React, keeping the existing `role="img"` and text alternatives
- the CLI gains `prismbinder plot <file> <dir>` writing SVG, which makes every chart testable as a
  string and gives non-browser users something

Chart type selection: a default per table kind, plus an override restricted to the styles that kind
supports. The default is the important half - it is what someone opening a file sees.

**These defaults are ours, not Prism's.** Prism has no silent default to copy: creating a table
opens the Change Graph Type dialog and asks. So the column below is a judgement about what is least
misleading for each kind of data, and it should be presented that way rather than as fidelity.

| Table kind | Default | Also allowed |
|---|---|---|
| xy | points, line if the X is ordered | error bars, box at each X, replicates, spikes, area |
| column | scatter dot plot | bar, aligned dot, box, violin, floating bars, symbol at mean |
| grouped | interleaved bars | stacked, separated, grouped, scatter, box, violin |
| contingency | interleaved bars | stacked, grouped, symbols |
| survival | staircase | point-to-point, symbols at censored, error bars |
| partsofwhole | pie | donut, slice, dot plot |
| nested | scatter grouped by subcolumn | bar, box, violin, symbol at mean |
| multivariable | scatter of two chosen variables | bubble, heat map, dendrogram, ellipses, hulls |
| view | points, no line | table only |

## The statistics line

The project says it does not recompute statistics. Charts need summaries, so the rule needs a
precise edge. Three tiers:

**Tier A - compute.** Definitional descriptions of the values present: count, sum, min, max, mean,
median, quartiles, arbitrary percentiles, SD, SEM, range, geometric mean. These are not models. A
box plot is a way of writing five numbers down.

**Tier B - read, never compute.** Anything Prism already worked out and stored in
`analyses/<id>/results.json`. Verified present in the corpus:

- `COLUMN_STATISTICS` stores `descriptiveStatistics` per column with `n`, `mean`, `sd`, `meanSE`,
  `meanCI {lower, upper, level}`, `minimum`, `firstQuartile`, `median`, `thirdQuartile`, `maximum`,
  `percentiles {lower, upper, level}`, `range`, `geometricMean`, `geometricSD`,
  `coeffOfVariation`, `skewness`, `kurtosis`, `qcLines`
- `HIERARCHICAL_CLUSTERING` stores the dendrogram as a linkage list of
  `{node1, node2, distance, cluster}` - directly renderable, no clustering to redo
- fitted curves are already materialised as ordinary data tables; the ones observed hold 1000 rows

**Tier C - refuse.** Anything needing a fit we would have to run. Draw nothing and say why.

Kaplan-Meier sits awkwardly. The corpus `SURVIVAL` results hold the comparison tests, censored and
event counts and median survival, but **not the curve points**. The estimator is a running product
over the event times - arguably Tier A - but it is the one place where drawing a chart means
computing a statistic that Prism labels an analysis. Proposal: implement it, keep it behind the
same badge, and verify median survival against the stored `medianSurvival` in `dataSummary`, which
is a real check on the implementation.

## Verification

The hard question for this project is not how to draw a box, it is how anyone knows the box is
right. Five layers, strongest first.

**V1 - Prism's own numbers.** `descriptiveStatistics` gives, at full double precision, every number
a box plot, an SD bar, an SEM bar and a 95% CI bar is made of. Our summary layer must reproduce
them for every column that has such an analysis. This is non-circular: Prism computed them, we did
not. It also settles the percentile question, which the user guide flags as a real hazard - Prism
documents that its method differs from Excel's, and this is how we find out which one we have.

**The oracle is currently almost empty, and this is the single biggest weakness in the plan.** The
whole corpus holds **one** `COLUMN_STATISTICS` analysis, covering **two** columns, in one shipped
GraphPad file - which also means it cannot be committed. Two columns will catch a wrong quartile
definition and will not catch much else: no tied values, no even-length samples, no single-value
columns, no missing values interleaved. Before C3 starts, the oracle has to be widened, and the
only way to widen it is in Prism: run Column Statistics over a handful of deliberately awkward
columns and save the file. That is a P-level task in the sense `docs/measurements.md` uses, it
takes minutes, and C3's gate is meaningless without it.

**V2 - stored structures.** The dendrogram linkage list and the fitted-curve tables are compared
element by element against what we render.

**V3 - geometry snapshots.** Fixed input to a deterministic SVG string, in both Vitest projects.
Catches accidental change, proves nothing about correctness.

**V4 - properties, with fast-check.** A bar chart has one bar per non-blank cell; a pie's wedge
angles sum to a full turn; a box's whiskers never cross its hinges; a stacked bar's segments sum to
the column total; no mark escapes the plot area.

**V5 - a human with Prism.** Open the same file in Prism, compare by eye, record the verdict in a
matrix. Note there is no `docs/prism-open-matrix.md` yet - the original plan named one and it was
never written - so this phase creates it. V5 is the only check on the things no stored number can
settle: whether our chart is a fair rendering of the same data, and whether the style we picked is
one a user of that table would recognise. It cannot check our default against Prism's, because
Prism does not have one.

Plus the standing accessibility requirement: every chart ships with a text alternative and the
underlying numbers reachable without reading the picture.

## Phases

Estimates are person-days including tests.
Calendar time on evenings and weekends is two to three times these.

### C1 - foundation, no new chart types (6-8 d)

Extract `@prismbinder/charts`; move today's logic into `series.ts` and `marks.ts`; add log and
category scales, axis titles, a legend, and the SVG serialiser; wire `prismbinder plot`. The editor
draws exactly what it draws now, through the new pipeline.

Gate: every assertion in today's `Preview.test.ts` still holds against the new package - the
imports move, the expectations do not - and the suite runs in both Vitest projects rather than only
under Node.

### C2 - bars and points (8-10 d)

The 141 sheets with no ordered axis. They no longer get a misleading connecting line, but points at
row positions is still not what any of these kinds of data should look like. Column bar, scatter,
aligned dot and floating bars; Grouped interleaved, stacked, separated and grouped bars;
Contingency bars; the category axis with the four spacing modes; error bars from the spread layouts
we already decode; horizontal variants.

Gate: every table kind draws the default chosen for it in the table above - ours, not Prism's,
since Prism has none. V4 properties hold. No table kind falls back to a line unless its X is
ordered.

### C3 - distributions (6-8 d)

Box and whiskers with all seven whisker rules; violin plots with the three smoothing levels; points
superimposed. Requires the summary layer and a KDE.

Gate: V1 - our five numbers equal Prism's stored `descriptiveStatistics` for every column that has
a `COLUMN_STATISTICS` analysis. The violin bandwidth mapping is documented as ours, not Prism's,
because the light/medium/heavy scale is not specified anywhere we can read.

### C4 - parts of whole, and survival (5-7 d)

Pie, donut, slice, dot plot, exploded slices, legend with value or percent. Kaplan-Meier staircase
with censoring ticks, from time and event codes; SE and 95% CI bands; survival or death, percent or
fraction.

Gate: pie wedge angles sum correctly and match the column totals; median survival matches the
stored `medianSurvival`.

### C5 - multiple variables, at fidelity tier 1 (10-14 d)

Different in kind from C2 to C4: this family is **read, not reconstructed**.

Size it honestly. There are 37 multivariable data sheets in the corpus, 27 of them in bundles - but
tier 1 applies to a *graph sheet*, and there are **7**, in three files, all of them analysis
output. A multivariable table with no MV graph beside it gets tier 2 like everything else. So this
phase buys perfect fidelity for seven known graphs and a plausible path to more, on an evidence
base of three documents. That is the weakest evidence any phase here rests on, and it is the reason
C5 should follow C2 rather than jump the queue.

Read from `graphs/<id>/sheet.json`: axis limits, intervals and tick visibility per segment; the
categorical vs linear segment choice; colormap and colour scheme id; legend placement and contents;
title text and docking; plot area geometry. Resolve `branchesLink` and `clustersLink` against the
analysis results. Then render: bubble plot with size and colour channels, heat map, dendrogram,
confidence ellipses, convex hulls.

Gate: the dendrogram reproduces the stored linkage exactly (V2); axis limits come from the file and
are never invented; a chart in this family carries **no** reconstructed badge, because it is not a
reconstruction - and that distinction must be visible in the UI, or the badge stops meaning
anything.

Prerequisite: extend the bundle reader to model `graphs/<id>/sheet.json` beyond title and inputs.
Today it reads four fields and treats the rest as opaque, which was the right call while the family
looked like PCFF. Roughly 2 of the days above.

### C6 - the long tail (6-10 d)

Second Y axis; staircase and arrow connecting lines; spikes and drop lines; area fill and error
envelopes; nudging; symbol shapes; before-after; three-way grouped layout; per-point formatting.

**Total 41-57 person-days, about 8 to 12 weeks full time.**

## Feasibility, per chart

| Chart | Needs PCFF? | Needs computation | Verifiable how |
|---|---|---|---|
| Bar (column, grouped, contingency) | no | none | V4 |
| Scatter, aligned dot, before-after | no | none | V4 |
| Floating bars (min to max) | no | Tier A | V1 |
| Symbol at mean or median | no | Tier A | V1 |
| Error bars SD / SEM / 95% CI | no | Tier A | V1 |
| Box and whiskers | no | Tier A percentiles | V1 |
| Violin | no | Tier A + KDE | V1 for the quartile lines; bandwidth is ours |
| Pie, donut, slice | no | none | V4 |
| Kaplan-Meier staircase | no | Tier A estimator | median survival vs stored value |
| Heat map | no, settings are in JSON | none | V3, plus the stored colormap |
| Dendrogram | no, settings are in JSON | Tier B, read only | V2 exact |
| Bubble | no, settings are in JSON | none | V4, plus the stored channel mapping |
| Confidence ellipse | no | Tier A covariance | ours, labelled |
| Convex hull | no | Tier A geometry | V4 |
| Log axes | no | none | V4; for MV graphs the axis is read from the file |
| **A Multiple Variables figure as Prism drew it** | **no** | - | **reproducible for the analysis-output graphs we have; unmeasured for a user-authored one** |
| **Any other figure as Prism drew it** | **yes, PCFFGRA4** | - | **not attempted** |

## Risks

| Risk | Mitigation |
|---|---|
| ~~Percentile method differs from Prism's~~ | **Settled by V1 on the first run.** Prism uses the Weibull rule, position `(n+1)p`. Of the five common definitions only that one reproduces all four quartiles Prism stored for the two columns it has: Q1 7.75 and Q3 138.75, where Excel's default gives 12.75 and 105.5. The guide warns that Prism differs from Excel without saying how - it differs from `PERCENTILE.INC` and agrees with `PERCENTILE.EXC` |
| A Tukey whisker can end inside its own box | Found by the corpus suite rather than by reasoning. A hinge is interpolated between two values, so on a small skewed sample the furthest point inside the fence can sit below q3 - `Col. stats of Data 1` has a q3 of 499.625 whose nearest inside point is 107.5. The whiskers are clamped to the hinges. No description of the rule mentions this |
| Violin bandwidth mapping is unspecified | Ship our own, label it, do not claim it matches |
| Category spacing rules (interleave, stack, group, superimpose) are visual conventions with no written spec | Not derivable from the sample files - that geometry is inside PCFF. Either eyeball a graph rendered by Prism, or choose a convention and label it as ours |
| A reconstructed chart gets mistaken for Prism's | The badge is not optional and not dismissible. Every export carries it too |
| Scope: this is a plotting library inside a file-format toolkit | Phase boundaries are release points. C2 alone removes the misleading default from 141 sheets and is worth shipping on its own |
| Chart code drifts from the format layer | `@prismbinder/charts` depends on `@prismbinder/model` only, and never parses a file. Tier 1 therefore needs the graph settings surfaced *through* the model: `GraphSheetView` currently exposes four fields, and `opaque` is derived from "a `data.bin` exists", which mislabels the four MV graphs whose binary is not PCFF and whose geometry is in the JSON |

## Open questions

| Question | How to settle it |
|---|---|
| Which whisker rule and which percentile method does a given saved graph use? | For the seven classic families it is in the PCFF blob. Our default is ours; make it selectable and say so |
| ~~Does Prism store the chosen chart style anywhere readable?~~ | **Settled.** For `MVGraph`, yes, in full. For `FENGraphSheet`, no - its sheet.json is 250 bytes and holds no styling at all |
| What is the 5 KB non-PCFF `data.bin` beside 4 of the 7 MV graphs? | Magic `00 00 00 00 EE 80 68 01`. Three MV graphs have none and are complete without it, so it is not the geometry. A cached thumbnail or embedded drawings are the obvious candidates. Read the three-versus-four difference before trusting the JSON to be exhaustive |
| What are the exact colour stops of Grayscale, Rainbow, Inferno, Plasma? | `colorSchemeID` is an integer in the file. Map it by sampling a rendered heat map, or accept close equivalents and label them |
| Is the KM estimator inside our stated scope? | A decision, not a measurement. Recorded above as a proposal |
