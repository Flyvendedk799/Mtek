# 0141. Several scenes, `go_to(Scene)` and `shared state`

- Status: Accepted
- Date: 2026-10-21
- Supersedes: the rule "v0.1 mounts one scene per application" (`spec/scenes.md` §1) and the reservation of `E5901` ("scene switching not supported"), which is retired: it stays in the catalogue, marked reserved, so that its number is not reused.

## Contract

A small game has a title screen, levels and a game-over screen. They are scenes.

**Packaging.** The entry module may declare several scenes; `mtek.toml` `project.scene` names the first (`E9006` as before). `mtek build` packages every scene. The entry scene keeps the fixed names (`app.js`, `program.manifest.json`, `index.html`), every other scene `S` gets `app.S.js` (with its source map) and `program.S.manifest.json`; shaders, assets and the runtime are content-addressed and shared. Every manifest of a multi-scene program carries `game.scenes` (`[{ name, module, manifest }]`, sorted by name, `spec/runtime-abi.md` §5); a single-scene program has no `game` object and is packaged byte for byte as before.

**`go_to(Scene)`.** An intrinsic `(scene name) -> ()`, handler-only (`E5080`). The argument must be the bare name of a scene of the program (`E5201` for anything else: an expression, a camera, an unknown name, a scene of another module). The switch is requested, not immediate: the runtime prepares the new scene in the background (module, manifest, shaders, assets, physics, `init`) and swaps it in as a whole at the start of a later frame. The old scene keeps running until then. A failure reports `E5401` (runtime, notes with the causes) and the old scene keeps running. Only the first request counts until it is applied or fails.

**What carries over: `shared state`.** `shared state score: i32 = 0;` is a scene state that is copied into the next scene when that scene declares a shared state of the same name. The copy happens after the new scene's `init`, before its first frame. Rules:

| Code | Rule |
|---|---|
| `E5201` | `go_to` needs the name of a scene of the program |
| `E5202` | `shared` is only for scene state (not entity or prefab state) |
| `E5203` | shared state must be plain data: bool, numbers, vectors, matrices, `quat`, `color`, `string`, enums, and arrays/structs of these (no `entity_ref`, resource or descriptor) |
| `E5204` | two scenes declare a shared state of one name with different types (related span at the other declaration) |
| `E5401` | runtime: the scene change failed |

Everything else (state, entities, bodies, timers, queued commands, the game pause) ends with the old scene. Input state is the application's and stays.

`shared` is contextual: only `shared state` at a member position is the modifier. The manifest marks such entries `"shared": true`.

## Alternatives considered

- **A global `game { }` block for persistent values.** More syntax, a new declaration kind and its own lifetime rules; shared state is a scene state with one flag, read and bound exactly like the others.
- **Carry state by name without a modifier.** Implicit: a scene's `timer` state would leak into the next level. The modifier states the intent and lets the compiler check the types across scenes (`E5204`).
- **One bundle with all scenes in one module.** Simpler to load, but every scene's init code and shaders would load for the first frame. Separate program modules keep the first scene's start-up what it was, and reuse the hot-reload preparation path.
- **Immediate switch.** The rest of the handler would run against a dead world.

## Consequences

- Hot reload while a non-entry scene runs reloads that scene.
- Host inputs and outputs are declared for the entry scene; another scene uses those whose state it declares.
- The cold-start context lists `go_to`; `shared` is in the contextual words of `spec/grammar.ebnf`.

## Verification

`tests/semantics/fail/game/e5201_*`, `e5202_*`, `e5203_*`, `e5204_*`; `tests/semantics/pass/game_flow` (build: `app.Level.js`, `program.Level.manifest.json`); `tests/abi/manifests/valid/full.json` (schema); `packages/runtime-web/src/host/game.test.ts` (go_to with carry, E5401).
