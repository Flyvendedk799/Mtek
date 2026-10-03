# 0003. What "AI-native" means

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §1.3.

## Decision

"AI-native" means minimising the **total work to reach a correct result** — tokens in and out including language context, generation and repair rounds, actionable vs misleading diagnostics, and run-time correctness — measured over whole sessions (benchmark §12.2), never characters in a first response. Design rules: familiar, consistent constructs; one complete name per concept (`position`, never `pos`/`p`/`translate`); remove boilerplate, not meaning; compactness only after measuring tokenisation, repair frequency and run-time correctness; structured diagnostics enabling localised edits. Mtek is fully usable without an LLM, hosted account or inference service; no inference library is ever a language dependency, and removing AI tooling changes nothing about compiling or running programs.

## Verification

Independence from AI services: CI builds and tests with no network access to inference endpoints. Total-work claims: only after the §12.2 benchmark.
