export { type Linkage, type MvContext, mvContext, planMvGraph } from './mv.js'
export {
  allowedKinds,
  defaultKind,
  type ErrorKind,
  type PlanOptions,
  type Provenance,
  planChart,
  planProject,
  provenanceOf,
} from './plan.js'
export { PALETTE, type RenderOptions, renderChart } from './render.js'
export { formatNumber, niceDomain, type Scale, scaleFor, slotWidth } from './scales.js'
export {
  type Datum,
  num,
  readTable,
  type Series,
  type Spread,
  spreadOf,
  type TableSeries,
} from './series.js'
export {
  type Descriptives,
  density,
  describe,
  kaplanMeier,
  medianSurvival,
  percentile,
  percentileSorted,
  type Smoothing,
  type SurvivalStep,
  WHISKER_RULES,
  type WhiskerRule,
  type Whiskers,
  whiskers,
} from './summary.js'
export { DEFAULT_STYLE, render, toSvg } from './svg.js'
export type {
  Axis,
  Bar,
  Box,
  Cell,
  ChartKind,
  ChartSpec,
  El,
  ErrorBar,
  Fidelity,
  Link,
  Mark,
  Point,
  ScaleKind,
  SeriesInfo,
  Violin,
  Wedge,
} from './types.js'
export { el } from './types.js'
