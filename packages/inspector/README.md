# Optional scene inspector

`@mtek/inspector` is a separately packaged extension API 1 consumer. It adds a
scoped DOM panel and a renderer-independent controller without changing Mtek's
scene/runtime implementation. The JavaScript bundle imports no runtime, compiler,
GPU or physics implementation. Mtek is a peer dependency for the public types.
The package is private; these are local development tarballs, not a registry release.

```ts
import {InspectorController, mountInspectorPanel, mountInspectorOverlay} from "@mtek/inspector";
import type {MtekApp} from "@mtek/runtime-web";

const inspector = new InspectorController({onError: console.error});
const removePanel = mountInspectorPanel(inspector, sidebar);
const overlay = mountInspectorOverlay(inspector, canvas); // optional Canvas2D layer
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
overlay.dispose(); // removes canvas, observers and spatial subscription
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
commands or external scene changes. Optional animation diagnostics report the
actual active clip, transition progress, ordered layers and effective masks,
root-motion ownership, procedural override state and IK settings/reach errors.
Older providers without diagnostics show unavailable data.

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
[CPU-only sandbox](../../examples/scene-inspector/README.md). The lighting-studio
rendered integration now exercises edit/undo/redo/reset/removal on Radeon and
SwiftShader. The [inspection studio](../../examples/inspection-studio/README.md)
also combines an original Fox character, layers, procedural pose/IK controls,
physics contacts and world overlays through this public package. Resource
provenance, persistent authored IDs and the broader end-to-end authoring workflow
corpus remain roadmap work.

When the runtime supplies an authored local bounding sphere, the entity snapshot
and panel show its center/radius. These values are copied and frozen by the
controller. They describe the source enclosure, not a compiler proof that every
deformed vertex lies inside it.

## World overlays and spatial diagnosis

`mountInspectorOverlay(controller, renderCanvas, options?)` adds an optional
transparent, pointer-free Canvas2D layer. Bounds, skeleton, IK targets/reach errors,
box/sphere colliders and contact normals have independent switches through
`overlay.setOptions(...)`. Selection is the default scope; `selectedOnly: false`
shows all entities' bounds/colliders/contacts. Skeleton/IK stays selected.
When the scene or target has no visible viewport, backing storage is released.
`dispose()` removes the host, observers, listeners and subscription. It has no
render loop or GPU resources. Dispose/recreate it to toggle the optional layer.

The controller's `subscribeSpatial` samples after frames only while a spatial
observer exists. The closed-by-default spatial panel also subscribes only while
open and updates its text at four Hz. Ordinary snapshots retain their configured
polling interval. Scene resets discard stale selection and geometry. Direct
`spatialSnapshot()` reads the latest copied/frozen sample; absent providers report
unavailable state without disabling the panel.

World matrices include parents, nonuniform scale and node animation. Skeletons
use node indices, so duplicate names remain distinct. Their mesh-local pose includes
layers/IK and precedes material-authored vertex deformation. Physics shapes use
actual backend poses and nominal collider dimensions; entity scale is not applied
again. Pending compute geometry and stale animated bounds are not fabricated.

Overlay lines clip against all WebGPU planes but do not depth-test against the
scene. Shadow DOM isolates their transparent canvas from host canvas styling.
Alignment handles content-box borders/padding, scrolling, resize, DPR and positive
axis-aligned CSS scale. Rotated/skewed/reflected/perspective CSS ancestors report
unavailable alignment. Segment count defaults to 4,096 (maximum 16,384); truncation
is visible. Backing storage caps DPR at 3, dimensions at 8,192 and pixels at
16,777,216. See the full [inspection contract](../../spec/inspection.md).
