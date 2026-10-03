# 0017. Language name: Mtek

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: board task 1.4 ("Chosen name is \"Mtek\"").

## Context

The original blueprint used "Aura" as a placeholder name; the owner chose **Mtek**.

## Decision

The language and toolchain are named **Mtek** everywhere in the specification, code and documentation: language Mtek; CLI `mtek`; project file `mtek.toml`; source extension `.mtek`; crates `mtek-compiler` and `mtek-cli`; npm scope `@mtek/`; host API `mountMtek`, `MtekApp`, `MtekProgram`, `MtekMountOptions`, `MtekMountError`, `MtekDiagnostic`, `MtekInputResult`, `MtekDebug`; diagnostic code prefix `MTEK-`; generated identifiers `Mtek…` (WGSL structs such as `MtekFrame`, `MtekParams_<hash8>_<Name>`) and `mtek_…` (bindings, entry points, helpers); span-map suffix `.mtek-map.json`; environment variables `MTEK_*` (for example `MTEK_BLESS`, `MTEK_REQUIRE_GPU`).

## Consequences

The blueprint sections 1–15 on the board keep the word "Aura" as the historical design baseline; reading "Aura" there means Mtek. The original document reference [U1] keeps its original file name and title.

## Verification

A repository test (added by the bootstrap task) fails if the word "aura" appears anywhere outside `spec/decisions/0017-language-name.md`, `spec/decisions/sources.md` and quotations of the original blueprint.
