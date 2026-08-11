# Authored fixtures

Test files created by hand from synthetic data. These are **our own work**, so
they are committed and ship with the package.

Files sourced from a Prism installation go in `fixtures/vendor/` instead, which
is gitignored - GraphPad's sample files are their copyrighted content.

## Nothing is currently needed here

This directory was created to hold a hand-made `.prism` that two open questions
depended on. Both have since been answered without one:

- **"We have never seen a `.prism`."** The shipped samples are all `.prismt`
  templates. Comparing eight real documents against eleven templates found no
  structural difference at all - same entry shapes, same `document.json` key
  paths, same ZIP metadata profile. See M3 in `docs/measurements.md`.
- **"`create()` needs a template to copy."** It does not. The format is
  documented well enough to write one from nothing, which is what
  `createBundle` does, and the result is checked against every table shape in
  the corpus. See M6.

The corpus tests read this directory, so anything dropped in gets picked up
automatically. That still has one use: a document saved by a Prism version we
have not seen would widen the fidelity suite for free.

The one thing no fixture can settle is whether Prism *opens* a file we
synthesised - a file Prism wrote shows what it writes, never what it requires.
That needs Prism itself, and it is the last open item in `docs/measurements.md`.
