# 0049. `state`, lifecycle functions, handlers and writes: details the specification leaves open

- Status: Accepted
- Date: 2026-10-05
- Blueprint origin: M3 (blueprint §11), tasks M3-01 and M3-02; `spec/scenes.md` §§2, 4.4, 6–8, 11; `spec/runtime-abi.md` §§3, 4.2; decisions 0025 (milestone gating), 0027 (scene checks), 0030 (code generation), 0045 (assignable places).
- Supersedes: nothing. Lifts the M3 gating of `state`, lifecycle functions, event handlers and `self` (decision 0025); `bind` stays gated to M3-05.

## Context

The specification fixes what `state`, `update`/`fixed_update` and `on <event>` mean and in which order a scene initialises, but not how they are checked, lowered or described in the manifest. Every choice below is a **proposal** the owner may overrule.

## Decision

1. **Gating.** The four constructs move to "implemented" in `resolve/gate.rs` (`E9010` no longer reports them). The gate rows still say M3 in the specification; the table in `compiler-architecture.md` is unchanged.
2. **State initialisers** are CPU root bodies checked in declaration order: they may read constants, state declared earlier (scene state from anywhere in the scene, entity state of its own entity) and call pure and `cpu` functions. Reading an entity or camera field is `E5081`. Non-constant *field* initialisers (a field reading state) are still `E9010`; they arrive with `bind`/initial values in M3-05.
3. **Names.** State shares the scene scope; an entity's own state may be used bare inside that entity, other entities' state is `Entity.name`. Entity state may not shadow scene state (`E2001`) or share a name with an entity field (`E2002`).
4. **Lifecycle functions** are exactly `update(dt: f32)` and `fixed_update(step: f32)`, at most once per owner (`E5050`–`E5052`).
5. **Handlers.** `on <event>(filter?)(param?)` resolves against the stdlib event table: `key_down`/`key_up` take a `Key` filter and no parameter, pointer events take a `PointerEvent` parameter and no filter (`E5060`, `E5061`). Handlers lower to `fn(ctx, self, args…)`; the scene's come first, then each entity's in stable instance order.
6. **Writes** go through the single-writer analysis (decision 0045): a write to a transform, visibility, camera or material field from a lifecycle function or handler makes the target `imperative` (a new update class, manifest `class: "imperative"`); construction-only fields stay `E5073`. State is written with `ctx.s.<name>` / `<entity>.state.<name>` and needs no analysis.
7. **Generated code.** `init` assigns scene state, then each entity's state and fields in declaration order (`spec/scenes.md` §11). `scenes[Name]` carries `update`, `fixedUpdate`, `entityUpdate[i]`, `entityFixedUpdate[i]` (functions or `null`) and `events` as `{ event: [{ key?, owner, fn }] }`, where `key` is the DOM `KeyboardEvent.code` (`Key.Space` → `"Space"`) and `owner` the entity index or `-1` for the scene. The manifest gains `state` entries (name, type, symbol) per scene and entity and `update`/`fixedUpdate` flags per entity.
8. **`print`** is compiled out of lifecycle functions and handlers in release builds (`BuildMode::Release`).

## Known limitations (recorded, not fixed here)

- A non-constant field initialiser still reports `E9010` (M3-05).
- A default-material entity cannot write `Cube.material.<param>` (the type has no instance of its own to write).
- An inactive camera written from a handler is lowered to `ctx.cam`, i.e. the active camera; switching cameras is out of M3's scope.

## Consequences

- Fixtures that tested the old gate (`gate_state`, `gate_lifecycle`, `gate_handler`, `gate_self`, `gate_builtin_*`) became real pass or fail fixtures with the code they now produce; the IR goldens gained empty `state` and `behaviors` arrays.
- `tests/codegen/state_and_handlers` is built with the real runtime and executed against a fake context (`behaviors.test.ts`); the runtime scheduler that calls these functions is M3-03.

## Verification

`cargo test --workspace --locked`, `npm run check`, `npm run test:unit` (codegen: 992 tests including `behaviors.test.ts`).
