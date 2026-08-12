"""
Reference values for the arithmetic in `packages/charts/src/summary.ts`.

The point of this file is that it is not ours. Every number a box plot, an error
bar or a survival curve is made of has a definition that predates Prism, and
numpy, scipy and statsmodels implement those definitions independently of
anything in this repository. Checking against them catches the kind of mistake
that a test written by the same person who wrote the code cannot: a percentile
rule off by one position, a variance divided by n, a Kaplan-Meier product taken
over the wrong risk set.

It does not need a Prism licence, which is the whole reason it exists. Prism's
own stored statistics are the better oracle where they are available, but the
corpus holds one COLUMN_STATISTICS analysis over two columns; this runs over as
many randomly generated samples as the caller cares to send, including the ties,
even lengths and single values that two columns cannot cover.

The percentile rule is the load-bearing one. Prism uses Weibull, `(n+1)p`, which
numpy spells `method="weibull"`, and that agreement is checked three ways: the
quartiles Prism stored for a fourteen-value column are 7.75, 50.5 and 138.75,
and numpy's weibull reproduces all three exactly.

Protocol: a JSON object on stdin, a JSON object on stdout.

  in   {"cases": [{"id": 0, "values": [...], "km": [[time, event], ...]}, ...]}
  out  {"ok": true, "versions": {...}, "results": [{"id": 0, ...}, ...]}

Any import failure is reported as `{"ok": false, "reason": "..."}` rather than a
traceback, so the caller can skip rather than fail when the modules are absent.
"""

import json
import sys


def fail(reason):
    json.dump({"ok": False, "reason": reason}, sys.stdout)
    sys.exit(0)


try:
    import numpy as np
    import scipy
    from scipy import stats
except ImportError as e:
    fail(f"numpy/scipy not available: {e}")

try:
    from statsmodels.duration.survfunc import SurvfuncRight
    import statsmodels

    HAVE_SM = True
except ImportError:
    HAVE_SM = False


# The percentiles summary.ts computes, named as it names them.
PERCENTILES = {
    "q1": 25.0,
    "median": 50.0,
    "q3": 75.0,
    "p1": 1.0,
    "p2_5": 2.5,
    "p5": 5.0,
    "p10": 10.0,
    "p90": 90.0,
    "p95": 95.0,
    "p97_5": 97.5,
    "p99": 99.0,
}


def describe(values):
    """Counts, extremes, centre and spread, plus every percentile we draw."""
    v = np.asarray(values, dtype=float)
    v = v[np.isfinite(v)]
    n = int(v.size)
    if n == 0:
        return None

    out = {
        "n": n,
        "min": float(v.min()),
        "max": float(v.max()),
        "mean": float(v.mean()),
    }
    # ddof=1 is the sample divisor, which is what Prism's stored meanSE implies:
    # sd / sqrt(n) reproduces it exactly. numpy defaults to ddof=0.
    out["sd"] = float(np.std(v, ddof=1)) if n > 1 else 0.0
    out["sem"] = float(stats.sem(v)) if n > 1 else 0.0

    for name, q in PERCENTILES.items():
        # Weibull is Prism's rule. Do not let this default.
        out[name] = float(np.percentile(v, q, method="weibull"))
    return out


def tukey(values):
    """
    The Tukey whiskers, as the definition gives them.

    The furthest observation within 1.5 interquartile ranges of the nearer
    hinge, which is the classic construction. summary.ts additionally clamps
    each whisker to its own hinge, because an interpolated hinge on a small
    skewed sample can sit outside every point inside the fence and a whisker
    drawn there would end inside its own box. That clamp is ours and this does
    not apply it, so the caller compares the unclamped values and treats the
    clamp as the documented, deliberate difference it is.
    """
    v = np.asarray(values, dtype=float)
    v = np.sort(v[np.isfinite(v)])
    if v.size == 0:
        return None
    q1 = float(np.percentile(v, 25, method="weibull"))
    q3 = float(np.percentile(v, 75, method="weibull"))
    fence = 1.5 * (q3 - q1)
    inside_lo = v[v >= q1 - fence]
    inside_hi = v[v <= q3 + fence]
    return {
        "q1": q1,
        "q3": q3,
        "lower": float(inside_lo.min()) if inside_lo.size else float(v.min()),
        "upper": float(inside_hi.max()) if inside_hi.size else float(v.max()),
    }


def kaplan_meier(pairs):
    """
    Survival at each event time.

    statsmodels reports one row per distinct time carrying an event; summary.ts
    emits a step at every distinct time, holding the value across censor-only
    times. Only the event times are returned here and the caller looks each one
    up, so the two conventions are compared where they are comparable rather
    than being made to agree by construction.

    Returns None when statsmodels is absent, or when nothing is observed - a
    sample with no events has no product to take.
    """
    if not HAVE_SM or len(pairs) == 0:
        return None
    time = np.asarray([p[0] for p in pairs], dtype=float)
    status = np.asarray([1 if p[1] else 0 for p in pairs], dtype=int)
    if status.sum() == 0:
        return None
    sf = SurvfuncRight(time, status)
    return [[float(t), float(s)] for t, s in zip(sf.surv_times, sf.surv_prob)]


def main():
    try:
        payload = json.load(sys.stdin)
    except (ValueError, OSError) as e:
        fail(f"bad input: {e}")

    results = []
    for case in payload.get("cases", []):
        row = {"id": case["id"]}
        values = case.get("values")
        if values is not None:
            row["describe"] = describe(values)
            row["tukey"] = tukey(values)
        km = case.get("km")
        if km is not None:
            row["km"] = kaplan_meier(km)
        results.append(row)

    json.dump(
        {
            "ok": True,
            "versions": {
                "python": sys.version.split()[0],
                "numpy": np.__version__,
                "scipy": scipy.__version__,
                "statsmodels": statsmodels.__version__ if HAVE_SM else None,
            },
            "results": results,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
