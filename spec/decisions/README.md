# Decision records

The blueprint is the design baseline. Any implementation decision that alters or extends it is
recorded here before code depends on it (blueprint §15).

- One decision per file, `NNNN-short-slug.md`, numbered in acceptance order.
- Records are never rewritten to hide history. To change a decision, add a record that supersedes
  it and set the old record's status to `Superseded by NNNN`.
- Every claim is labelled: **proposal** (design choice), **hypothesis** (needs evidence),
  **constraint** (external fact, with a source reference from `sources.md`).
- Template:

    # NNNN. Title
    - Status: Proposed | Accepted | Superseded by NNNN
    - Date: YYYY-MM-DD
    - Blueprint origin: <section, or "none">
    ## Context
    ## Decision
    ## Consequences
    ## Verification

| # | Title |
|---|---|
| 0001 | Why a new language is worthwhile |
| 0002 | The initial use case |
| 0003 | What "AI-native" means |
| 0004 | Release boundaries |
| 0005 | Architecture decisions |
| 0006 | Deliberate exclusions |
| 0007 | Repository, toolchain and dependency policy |
| 0008 | Syntax decisions beyond the blueprint |
| 0009 | Numeric semantics and indexing |
| 0010 | GPU layout and binding strategy |
| 0011 | Program format and CPU value representation |
| 0012 | Browser test environment and evidence policy |
| 0013 | Implementation sequencing |
| 0014 | Scene model decisions |
| 0015 | Asset strictness |
| 0016 | v0.1 restrictions beyond the blueprint |
| 0017 | Language name: Mtek |
| 0018 | `mtek.toml` validation rules the specification leaves open |
| 0019 | Manifest spans carry line and column ranges |
| 0020 | M1 runtime: interim behaviour where a later task is not ready |
