# Scene inspector sandbox

From the repository root:

```sh
npm run build -w @mtek/runtime-web
npm run build -w @mtek/inspector
node examples/scene-inspector/serve.mjs
```

Open `http://127.0.0.1:5186/`. This is a CPU-only, event-driven API sandbox with
three local entities and a two-joint public Mtek animation controller. It creates
no WebGPU device, 3D viewport or automatic frame/animation loop.

Select a crate, edit its position, Apply, then Step scene. Undo/redo are also
frame-queued. Select Rig to pause, scrub, inspect mesh-local joints and switch the
Reach clip. Replace scene changes opaque IDs and clears stale selection/history.
Disconnect demonstrates extension cleanup and remount. Names are rendered as text.

The inspector itself is imported from its public package, not repository source
aliases. The sandbox implements a small host fixture to make UI work reviewable
without competing with CPU/GPU-heavy work. It is **not** evidence of rendered
scene compatibility or frame performance. A separate mounted-runtime contract test
uses the real extension host with a fake GPU. Real rendered-scene checks remain
deferred until the workstation is available.

For use in a compiled Mtek application, see
[`@mtek/inspector`](../../packages/inspector/README.md).
