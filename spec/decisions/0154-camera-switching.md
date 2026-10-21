# 0154. Camera switching

- Status: Accepted
- Date: 2026-10-21

## Context

A scene may declare several cameras, and exactly one is `active: true` (`E5013`). The runtime kept only that camera. A game that cuts from a close camera to a wide one had no way to change which one draws.

## Decision

1. **`set_camera(Name)`.** The argument is the name of a camera of this scene, written where the call is (`E5015` otherwise), the same shape as `go_to`. Handler-only. It switches the active camera. The others stay, with the values they had.
2. **Every camera is a record.** The world keeps one record per manifest camera (`position`, `target`, `rotation`, `projection`). `ctx.cam` reads the active record. Exposure stays a constant of each camera and is read from the active one each frame. A binding names the camera it writes; a manifest from before this decision, with no name, writes the active camera.
3. **One camera is unchanged.** A scene with a single camera emits no `selectCamera`. Its init text stays the text it had.

## Verification

- `tests/semantics/pass/camera_switch` and `tests/semantics/fail/e5015_set_camera_not_a_camera`.
- `packages/runtime-web/src/scene/world.test.ts` (the active record follows `selectCamera`).
- `examples/stage-show`.
