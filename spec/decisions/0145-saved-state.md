# 0145. Saved state: `saved state`, `save()`, `load()` and `clear_saved()`

- Status: Accepted
- Date: 2026-10-21
- Builds on: decision 0141 (scenes, `shared state`, the carryable types).

## Contract

A small game keeps a high score, unlocked levels or progress between visits. The program declares which state persists. The runtime keeps it in the browser's storage.

- **Syntax.** `saved state name: T = value;` in a scene. The contextual words `saved` and `setting` (decision 0146) come before `state`, after `shared` if any: `shared saved state best: i32 = 0;`. Outside that position they are ordinary names (`spec/language.md` §2.4). Grammar: `StateDecl = 'shared'? ( 'saved' | 'setting' )? 'state' Ident ':' Type '=' Expr ';'`.
- **Checks.**
  - `E5210`: persistent state in an entity or a prefab. Those come and go; only a scene's state has a place to come back to.
  - `E5211`: a type that cannot be stored. These are the types that cannot carry over (decision 0141, `E5203`): an `entity_ref`, a resource, a descriptor, or a struct or array that holds one.
  - `E5212`: two scenes declare a persistent state of one name with different types, or one `saved` and the other `setting`. There is a related span at the first declaration.
- **Intrinsics**, all CPU and handler-only (`E5080` in a function), like `go_to`:
  - `save() -> ()` writes every persistent state of the running scene at once.
  - `load() -> bool` sets every persistent state that has a stored value to it and returns whether at least one was applied.
  - `clear_saved() -> ()` deletes the program's stored data. The running scene keeps its values; `reset()` after it starts over.
- **Scene start.** When a scene starts (mount, `go_to`, `reset()`), each persistent state that has a stored value takes it, after `init` and before shared state is carried over (a carried value is newer). `init` sees the declared initial value. This is the same point at which shared state is applied (decision 0141).
- **One store per program**, keyed by state name. A name means one value in every scene, so `best` in `Title` and in `Run` is one high score. A scene that does not declare a name leaves its stored value alone.
- **Manifest.**
  - `scene.state[i].persist` is `"saved"` or `"setting"`.
  - `scene.state[i].storedType` is the structural description of the type: struct fields and enum variants spelled out, `{volume: f32, lefty: bool}`, `enum(Easy|Hard)`.
  - `game.storage` is the storage name, which is the project name. A single-scene program with persistent state gets a `game` object with only `storage`.
- **Runtime.** One JSON document per program in `localStorage` under `mtek.save.<game.storage>`: `{ "format": 1, "values": { name: { "type": storedType, "value": json } } }`.
  - A stored value whose `type` differs from the state's `storedType`, or whose JSON does not have the shape of the state's value (array length, struct keys, a non-integer `i32`, an enum index out of range), is ignored. The state keeps its value, and the runtime warns once per state with `W5402`.
  - A write the browser refuses warns `W5403`. A page without usable `localStorage` keeps the values in memory and warns `W5403` once.
  - Nothing reaches the program as an error.
  - The host can pass `storage` (any `getItem`/`setItem`/`removeItem` object, or `null` for memory) to `mountMtek`. Test mounts default to a fresh memory store, so `mtek test` is deterministic.
- **Codes.** `E5210`–`E5212` (compile time), `W5402` "saved data ignored" and `W5403` "saving failed" (runtime, phase `runtime:update`).

## Why these choices

- **Declared persistence, not a key-value API.** `save("best", best)` would need a dynamic value type, string keys the compiler cannot check, and a typed `load`. A declaration gives the compiler the type and the name, the manifest the schema, and the program one word to write.
- **Explicit `save()` for saved state.** Progress is saved at a moment the game chooses (a checkpoint, a game over). Writing every change would save a half-finished run. Settings are the opposite (decision 0146).
- **Restore after `init`, like shared state.** `init` runs in the background preparation of a scene (decision 0141), and the stored and carried values are applied together, just before the first frame. A program that needs the stored value in its setup reads it in its first `update` or in a binding. The alternative, restoring before `init`, would make initialisers depend on storage. A scene would then start differently depending on what the browser holds, even in a test.
- **The structural `storedType`.** The manifest `type` of a struct is its symbol and an enum is `u32`. Neither changes when a field or a variant is added, so an old save would be decoded into the wrong shape or the wrong variant. The structural description makes such a value a mismatch, and the game ignores it (`W5402`) instead of misreading it. Renaming a struct keeps its saves; renaming a field or a variant does not.
- **The project name as the key.** It is stable across builds (the build id is not) and readable in the browser's tools. Two projects with the same name on one origin share their saves. Give them different names.

## Alternatives considered

- **IndexedDB.** Asynchronous; `load()` would have to be a promise or a callback. The values are small, so `localStorage` (synchronous, about 5 MB) is enough.
- **Per-scene stores.** A high score is a game value, not a scene value; a per-scene store would make `Title` and `Run` disagree.
- **Saving entities.** Entities, bodies and timers are not plain data. A game that wants to resume a level saves the numbers it needs and rebuilds the level from them.

## Verification

- `tests/syntax/pass/SavedState.mtek`, `tests/syntax/fail/e1001_saved_before_shared.mtek`.
- `tests/semantics/pass/saved_state`; `tests/semantics/fail/game/e5210_saved_state_outside_a_scene`, `e5211_saved_state_cannot_be_stored`, `e5212_saved_state_types`, `e5080_save_in_function`.
- `packages/runtime-web/src/scene/saves.test.ts` and `src/host/game.test.ts` (restore on start, save/load/clear, go_to, W5402, W5403); `tests/abi/manifests` (`persist`, `storedType`, `game.storage`).
- `examples/lane-runner` (the best score).
