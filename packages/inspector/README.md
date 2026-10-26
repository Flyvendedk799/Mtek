# Optional scene inspector

`@mtek/inspector` is a separately packaged extension API 1 consumer. It adds a
scoped DOM panel and a renderer-independent controller without changing Mtek's
scene/runtime implementation. The JavaScript bundle imports no runtime, compiler,
GPU or physics implementation. Mtek is a peer dependency for the public types.
The package is private; these are local development tarballs, not a registry release.

```ts
import {InspectorController, mountInspectorPanel} from "@mtek/inspector";
import type {MtekApp} from "@mtek/runtime-web";

const inspector = new InspectorController({onError: console.error});
const removePanel = mountInspectorPanel(inspector, sidebar);
let app: MtekApp | undefined;
app = await mountMtek(canvas, program, {
  extensions: [inspector.extension],
  // Optional. Only supply metrics you actually have; absent data stays unavailable.
  hostServices: {
    "mtek.inspector.metrics": {read: () => {
      const counters = app?.debug?.counters();
      return counters === undefined ? {} : {liveEntities: counters.liveEntities};
    }},
  },
});

// Host shutdown:
app.dispose(); // extension teardown clears queued commands and scene references
removePanel(); // removes DOM, listeners and subscription
inspector.dispose();
```

The metrics callback is read during extension setup too, so it handles the period
before `app` is assigned. Omit that service if no suitable source exists. Never
fabricate zero counters for unavailable diagnostics. The controller can be consumed
without any DOM panel.

## Controls and ownership

- Filter/select entities by names and opaque IDs; duplicate names stay distinct.
- Inspect local position/quaternion/scale and visibility. Edit a field and apply
  it on the next scene frame; no write happens in a DOM input event. Only changed
  fields are submitted. A paused application must be resumed or stepped by its host.
- Undo/redo validated transform batches with bounded session history (default 100).
  Stale scene/spawn IDs are rejected; removed targets invalidate affected history.
- Inspect clip duration/time, playback/locomotion status and mesh-local joint
  positions. Switch clips, pause/resume the base clip or locomotion clock and seek
  through public animation methods. Layers, crossfade progress and constraints can
  still change the pose; the host's application pause freezes the entire scene.
  A clip switch selects that base clip and can replace a locomotion blend.
- Shared-pose changes can affect other actors. **Make pose independent** explicitly
  calls the public detach operation before changing an individual actor. Detach
  holds the copied pose; select a clip to resume motion on that independent player.
- Optional host metrics show resource counts and CPU timings, with units, when
  supplied. They are observations, not whole-frame GPU time or benchmark evidence.

Bindings/physics can overwrite transform edits after the before-frame hook. The
panel shows the resulting scene state after the frame; it does not take permanent
ownership from application logic. Undo covers transform edits only, not animation
commands or external scene changes. The current public API does not expose the
active base clip's name; the clip selector is a switch command, not a guessed
active-clip indicator. Skeleton coordinates are mesh-local, not a world overlay.

Snapshots default to four per scene second with no independent render loop/timer.
An observer failure is isolated and sent to `onError`; command failures remain
visible without disabling the extension. Panel disposal removes only its own DOM
and handlers. Controller disposal is permanent; normal scene teardown detaches it
and permits remount. One controller must not be mounted into two applications.

## Build and validate with low resource use

```sh
npm run build -w @mtek/runtime-web
npm run build -w @mtek/inspector
npm run check:types -w @mtek/inspector
npm run lint -w @mtek/inspector
npm run test:unit -w @mtek/inspector -- --maxWorkers=1
npm run verify:package -w @mtek/inspector
npm run verify:ui -w @mtek/inspector
```

The installed-consumer check packs both SDKs, installs them offline in an ignored
scratch project, compiles strictly without source aliases and exercises the public
exports. Mounted integration tests use the runtime's fake GPU; no hardware benchmark
or renderer optimization is part of this increment.
The unit-test prerequisite builds the small runtime SDK so a checkout without
`dist/` can exercise the public package too; it does not invoke Cargo or a GPU.

The short DOM-only UI verification launches one headless browser with GPU/WebGPU
disabled, rejects any GPU-adapter request and checks panel behavior and disposal.

See [runtime compatibility policy](../runtime-web/README.md) and the
[CPU-only sandbox](../../examples/scene-inspector/README.md). Full rendered scene,
collision/IK overlays, transition internals, resource provenance and end-to-end
authoring workflows remain separate roadmap work.

When the runtime supplies an authored local bounding sphere, the entity snapshot
and panel show its center/radius. These values are copied and frozen by the
controller. They describe the source enclosure, not a world-space wireframe or a
compiler proof that every deformed vertex lies inside it.
