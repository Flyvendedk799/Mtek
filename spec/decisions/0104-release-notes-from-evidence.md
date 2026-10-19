# 0104. The release notes are drafted from evidence only, and a test holds them to it

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: M7 (blueprint §11), task M7-06 ("release notes drafted from evidence only"; "every claim in the release notes links to evidence"); decisions 0100, 0101; the pending results of M7-03 (environment matrix), M7-04 (runtime benchmark), M7-05 (AI and token benchmark) and M7-07 (reproducible builds).
- Supersedes: nothing.

## Context

Release notes are where an unproved sentence does the most damage. Four results the notes will need do not exist yet, and one CI job is red. The honest draft says what is proved, links the proof, lists what is known to fail, and marks what is not measured as not measured.

## Decision

1. **The draft is `docs/release-notes-v0.1.md`, written by hand from the evidence files** (`evidence/M0` to `evidence/M6`, the decision records, the specification and the tests). It is a draft: its first line says so, and it is finished when the placeholders of its last section are replaced by results.
2. **A claim is a bullet or a table row** outside the preface and the section "About this draft". `tools/release-docs/src/releasenotes.ts` fails when
   - a claim has no link to a file under `evidence/`, `spec/` or `tests/`, to a file in a `test` or `tests` directory, or to a `*.test.*` or `*.spec.*` file;
   - a link does not resolve to a file or directory of the repository;
   - a number of two or more digits in the claim (code spans, link labels and targets, task ids, dates, version numbers and "decision N" excluded) does not occur in at least one of the files it links to (thousands separators are ignored: `1 590` and `1590` are one number). This is what stops a figure from being invented or rounded;
   - the known issues listed in "Unsupported / remaining" of `evidence/M6/report.md` are not all in the notes by their own bold lead-in, or the red `dev-overlay` job is not mentioned.
3. **A pending item** starts with the words "Pending: not yet measured." and names, in code spans, the evidence files that will replace it. It must name at least one path, may contain no number (a number there would be an invented measurement), and the check fails once one of the named files exists, until the placeholder is replaced by the result. The notes must contain a placeholder for each of M7-03, M7-04, M7-05 and M7-07; these are the work items of the plan whose results do not exist at this commit. When one lands, the work item that lands it removes its entry from `REQUIRED_PENDING` with its placeholder.
4. **Known issues are not softened.** The notes list the seven items of "Unsupported / remaining" of the M6 report and the red job by the report's own words, and the single machine and the software-adapter status of the evidence.
5. **What the check does not do.** It cannot tell that a sentence says more than the file it links to; a reviewer still reads the claims against the files. It proves that every figure is in the evidence and every claim has some.

## Consequences

- A figure in the release notes can be traced to a file in one hop, and a stale or invented one fails the build.
- The results of M7-03 to M7-05 and M7-07 cannot be reported without evidence files: the placeholders go stale only when those files are committed.

## Verification

`npm run check:release` (`release-notes/*`); the unit tests of `releasenotes.ts` (a claim without a link, a broken link, a link to a non-evidence file, an invented number, a placeholder with a number, one that names nothing, one whose evidence now exists, a missing placeholder, a dropped known issue). Recorded in the completion report of M7-06.
