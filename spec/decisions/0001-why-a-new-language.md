# 0001. Why a new language is worthwhile

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §1.1.

## Context

Mtek must justify itself against a well-designed TypeScript library, not deliberately verbose JavaScript. Three.js already offers shader-oriented abstractions through TSL [S1]; "JavaScript can describe shaders" is not a defensible novelty.

## Decision

Mtek is pursued on four **hypotheses**, none claimed true in any documentation until its evidence exists:

| # | Hypothesis | Confirmed by | Refuted by | Evidence from |
|---|---|---|---|---|
| H1 | One semantic model: scene structure, state, stages and resource dependencies are understood together | a change to one declaration is checked against all its CPU, GPU and scene uses in one compile, with a negative fixture per dependency kind | a typed TypeScript helper layer achieves the same checks with comparable effort | M1–M3 fixtures; M0 baseline |
| H2 | Cross-boundary checking: a material param, its CPU value and its GPU representation are one checked interface | type/layout mismatches between CPU value and GPU read are rejected at build time; in the baseline they surface only at run time or not at all | the TS/TSL baseline rejects the same mismatches at type-check time | M0 baseline record; M2 fixtures |
| H3 | Bounded, inspectable automation | `inspect` shows every layout, upload and resource; upload volume per edit is bounded and attributable | unexplained upload volume or unattributable cost | M3 counters; §12.3 benchmark |
| H4 | Agent-facing contract | less total work (attempts, tokens, repairs) to a correct result than the baseline over whole sessions | equal or worse totals once context, examples and repairs are counted | §12.2 benchmark |

Each hypothesis has three acceptable outcomes — **better, equivalent, worse** — reported as found. No comparison is constructed or tuned to turn "equivalent" into a win; a "worse" result triggers the blueprint's risk response (strengthen checking and workflow value; do not manufacture comparisons) or a reduced claim. The baseline is competent TypeScript with three.js/TSL (or equivalent typed helpers) written with the same care; a deliberately weak baseline invalidates the comparison.

## Consequences

Value lives in checking, inspectability and the agent workflow. Benchmarks are release evidence and must be reproducible. If H1 and H2 cannot be shown against a strong baseline, this record is revisited by a superseding decision, not reworded.

## Verification

Status of every hypothesis today: **untested**.
