# 0008. Syntax decisions beyond the blueprint

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §3, §3.4, §4.6.

## Context

The blueprint's reserved list and examples leave gaps a real grammar must fill.

## Decision

1. Keywords added to the blueprint's list: `struct` (typed records need a declaration form), `true`, `false`, `self` (used by the blueprint's own example), `bind` (reserved so binding sites are unambiguous), `break`, `continue`.
2. Words reserved for future versions (`while`, `match`, `vertex`, `compute`, `storage`, …) so later features never break programs; using them is `E0013`.
3. Contextual words: `camera` (scene-object kind), `update`/`fixed_update` (lifecycle), `fragment` (stage), `from` (imports), event names.
4. Array type syntax `array<T, N>` (WGSL-familiar); array literals use commas; descriptor and struct literals use `;` separators as the blueprint specifies for descriptors.
5. No shadowing (one name, one meaning), with the narrow exception that locals/params/state may reuse prelude **function** names.
6. Console output is `print(string)`, not `log`, because `log` is the logarithm.
7. Float literals require digits on both sides of `.`; no numeric suffixes or hexadecimal in v0.1; integer literals adopt the contextual type.
8. Not in v0.1 syntax: `while`, bitwise operators, ternary/if-expressions, closures, methods, enums (beyond registry enums), Unicode identifiers.

## Consequences

`spec/language.md` and `spec/grammar.ebnf` encode these; every rule has fixtures.
