# 0151. Reading a transform through an entity_ref

- Status: Accepted
- Date: 2026-10-21

## Context

`spawn` and `tagged` hand back an `entity_ref`. Until now the only things a program could do with it were compare it, test `alive`, `destroy` it and command its body (decision 0064). A game that wants "the coin nearest the player" had the reference and could not read where it was.

Writing through a reference stays forbidden. The single-writer rules (`E5070`, `E5071`, bindings) need the entity's declaration, and a reference does not name one.

## Decision

1. **Reads.** `r.position`, `r.rotation`, `r.scale` and `r.visible` are legal wherever a field read of a named entity is legal. The types are `vec3`, `quat`, `vec3` and `bool`.
2. **Everything else is `E5074`.** A write of those four fields, and a read or write of any other field or of state, is rejected. The message names the four fields that can be read.
3. **A dead reference reads as zero.** `alive(r)` false (pending spawn, pending removal, destroyed, or the dead reference a query returns) gives `position` and `scale` `(0, 0, 0)`, `rotation` the identity and `visible` false. Generated code does not have to test `alive` before a read.
4. **Not a binding source (`E5005`).** A `bind` has no dependency kind for "whichever entity this reference points at". Copy the value into state in a handler and bind the state.
5. **ABI.** The read is `ctx.refField(ref, "position")` (`spec/runtime-abi.md` §4.2). A live reference returns the same object a named-entity read returns.

## Alternatives considered

- **Reading every field.** State and material params differ per prefab, so the type of `r.tint` is not known from the reference.
- **Writing `position`.** That skips the body and binding checks. Move a spawned body with `r.body.teleport` or `r.body.apply_impulse`.

## Verification

- `tests/semantics/pass/entity_ref_reads`.
- `tests/semantics/fail/e5074_entity_ref_field_read` reads `hits`, which stays illegal. `e5074_entity_ref_field_write` still rejects both writes.
- `packages/runtime-web/src/scene/world.test.ts` reads a live record and a dead reference.
