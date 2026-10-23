# 0179. A project save id keeps the saves of two games of one name apart

- Status: Accepted
- Date: 2026-10-23
- Builds on: decision 0145 (saved state; the key `mtek.save.<game.storage>`), decision 0146.
- Source: `docs/audits/2026-10-23-game-audit.md`, finding S8.

## Contract

Decision 0145 keyed a program's saves by the project name. itch.io serves every HTML5 game from one origin, and `mtek new` suggests names like `my-game`, so two games of one name overwrote each other's saves.

- **`[project] id`** in `mtek.toml`: optional, 4 to 16 lowercase hexadecimal digits (`E9001` otherwise). `mtek new --template game` writes 8 random digits. The demo template writes none (it has no saves).
- **`game.storage`** is the project name as before when there is no `id`, and `<name>.<id>` with one (the name is cut so the whole fits the 64 characters the schema allows). The key is `mtek.save.<game.storage>`; the format of the document is unchanged.
- **`[project] migrate_saves`**: optional boolean, default `false`, meaningful only with an `id`. When `true` the manifest has `game.legacyStorage`, the plain project name. At the first read, if the new key does not exist and the old one does, the runtime copies the document to the new key. The old key is left alone (it may belong to another game of the same name). `clear_saved()` with a `legacyStorage` leaves an empty document under the new key instead of removing it, so the old saves are not adopted again.
- A project that sets neither key behaves exactly as under decision 0145: its saves stay where they were. Adding `id` and `migrate_saves = true` to an existing game is how a shipped game moves to the new key without losing a player's save.

## Why these choices

- **A stable id in the project file, not a hash of title and name.** Two games with the default title and name hash alike; the problem is precisely two games that look alike. A random id written once is unique and stays stable across builds and machines when the file is committed.
- **Migration is opt-in.** Adopting the old key by default would let a new `my-game` read another `my-game`'s save on the same origin, which is the collision again. The author of an existing game knows that the old key is theirs.
- **Old key kept.** On a shared origin it can belong to someone else; deleting it is not ours to do.

## Verification

- `crates/mtek-compiler/src/project/parse/tests.rs` (`id`, `migrate_saves`), `crates/mtek-cli/src/scaffold.rs` (id of a new game), `crates/mtek-cli/tests/cli.rs` (two scaffolds, migration), `packages/runtime-web/src/scene/saves.test.ts` (adoption, precedence, `clear_saved`), `tests/abi/manifests/valid/full.json` (`legacyStorage`).
