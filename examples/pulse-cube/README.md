# Pulse Cube

The blueprint §3.1 complete `Demo`: a rotating cube with the `Pulse` material, Space to reverse direction, and a host-exposed `tint` input.

Created by `mtek new pulse-cube` (task M3-08). Same files as the built-in scaffold template.

## Run

```bash
mtek check
mtek build
mtek dev
```

From the repository root:

```bash
mtek new my-demo   # scaffolds the same Demo under ./my-demo
```

## Host inputs

`mtek.toml` exposes `tint` as `Demo.tint`. After mount:

```ts
app.setInput("tint", "#f04f72");
```

## M3 behaviour (gate)

Browser specs under `tests/browser/specs/m3/` drive this example with the manual clock (`spec/testing.md` §6.5): rotation after N steps, Space, bound `frame.time`, host tint, pause/resume, and hot-reload cases.

**Note.** Compiling and running this Demo requires M3 language features (`bind`, lifecycle `update`, event handlers, `self`) and the matching runtime phases. Those are planned as M3-01..M3-05; until they are present on the branch, `mtek check` reports `E9010` for the gated constructs.
