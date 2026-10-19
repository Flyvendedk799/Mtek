# 0113. Diagnostics say what to write instead: the facts of a finite set go into the message, the nearest members are ranked, and a unique part match is a validated edit

- Status: Accepted
- Date: 2026-10-19
- Blueprint origin: blueprint §9.4 (diagnostics are the repair interface for agents); task K-02 (the guide run of the pilot, decision 0109 item 5); decisions 0071 (suggested edits), 0076 (the language server uses them), 0109.
- Supersedes: nothing.

## Context

The pilot of M7-05 (decision 0109) found attempts that ended after three repairs because a diagnostic named the mistake but not the way out: the model wrote `Key.Up` and was told the enum has no such member, wrote `color.linear(rgb)` and was told it takes two arguments, wrote `if` where a value was expected. `spec/diagnostics.md` §1 already asks for diagnostics that are *actionable*; several were not, because the useful fact (the members of a finite set, the parameters of the one signature, the form that does exist) was missing or sat in a note after a message that did not mention it.

## Decision

1. **A finite set is listed.** An unknown member of a built-in enum or namespace (`E2003`) carries a `help:` with the nearest members and a note with every member (`Key` has 51; a function member is written `name()`). Members of a namespace that this build does not implement are left out. A type that does not exist (`E3003`) carries a note with the built-in types.
2. **"Nearest" is a ranking, and it is deterministic** (`crates/mtek-compiler/src/hints.rs`, the one implementation). Three tiers: the same name in another letter case; names within edit distance 2 where the distance is less than half the length of the longer name (so `U` is not a typo of `Up`); names that contain the written one, case-insensitively, with at least two letters (`Up` for `ArrowUp`, `Esc` for `Escape`). Within a tier the order is by edit distance and then alphabetical; at most five are named. Nothing depends on hash order, the host or the time.
3. **One rule for the mechanical edit.** For a member of a built-in enum or namespace the `E2003` edit (decision 0071) is offered when the closest tier that has any member has exactly one member. `Key.Up` becomes `Key.ArrowUp`; `Key.Shift` (two members) and `Key.Foo` (none) get no edit. Validation is unchanged (`spec/diagnostics.md` §6.3): the edit is attached only if the re-check shows the diagnostic gone and no new error. The set of codes that carry edits does not change (`E2003` already did).
4. **The message carries the parameters of a single signature.** `E3002` for a function, constructor, namespace function or body command with one signature of plain types reads ``"`color.linear` takes 2 arguments (rgb: vec3, a: f32), but 1 was given."``; a `help:` names the missing arguments or the number to remove, and for a colour constructor with the alpha left out says that `1.0` is opaque. The note `signature:` stays. With several signatures, or a signature in a type class (`T`), the message keeps the count only and the note lists the signatures. A vector constructor whose argument has the wrong type names all three forms.
5. **A usual idiom of another language is corrected where the mistake is made**, in the texts decision 0115 lists. These are `help:` and `note:` lines: the code, the span and the first sentence of the message keep their meaning.
6. **What does not change.** No code is added, removed or renumbered. The checker accepts and rejects exactly what it did: every change is in text, in notes, in a proposed edit, or in which of several diagnostics of one broken construct is reported (decision 0114). Messages stay free of absolute paths and deterministic; the new texts name only forms that check (each example was run).

## Consequences

- Several `expected.diag.json` and `.diag.json` goldens changed (notes added, six messages with the parameters). They were rewritten with `MTEK_BLESS=1` and the diff reviewed line by line.
- `spec/diagnostics.md` §5, §6.2 and §7 say so; the writing rules of §7 gain the two rules this decision and 0114 add.
- The ranking is small and local; if a later diagnostic needs "did you mean" over a finite set it uses `hints::nearest` and `hints::unambiguous` rather than a third copy of the edit-distance loop (there are still older copies in `types/`; they keep their behaviour).

## Verification

Unit tests of the ranking (`hints.rs`), the fixtures `edits_e2003_key_member_by_part`, `e2003_key_member_ambiguous`, `e2003_namespace_member_listing`, `e3002_color_linear_missing_alpha`, `e3003_foreign_type_name`, the updated arity fixtures, `crates/mtek-compiler/tests/suggested_edits.rs` (re-proves the new edit with its own re-check), the language-server tests, and `npm run check:coverage`.
