# Platform runtime APIs

These APIs are implemented in runtime ABI 1. Their contract and remaining limits are
in [decision 0193](../spec/decisions/0193-platform-runtime-extensions.md). The
[implementation scorecard](../evidence/platform-step/scorecard.md) distinguishes
passing checks from the rest of the supplied platform request.

## Existing JavaScript applications

Run `node examples/incremental-animation/serve.mjs` from the repository root and
open `http://127.0.0.1:5183`. The [example](../examples/incremental-animation/README.md)
uses Three.js for rendering and Mtek for animation, with longer-limbed retargeting,
masked actions, foot placement, two hand grips and a skeleton overlay.

```ts
import { createAnimationController, retargetSkin } from "./runtime.js";

// `skin` is manifest-shaped checked rig data; `bones` maps rig names to Three.js bones.
const actor = createAnimationController(skin, { clip: "walk", bones });
actor.setLayer("upper", {
  clip: "wave", weight: 0.7,
  mask: { spine: 0.4, shoulder: 1, elbow: 1, hand: 1 }
});
actor.setIK("grip", {
  chain: ["shoulder", "elbow", "hand"], target: [0.3, 1.5, 0.6], iterations: 24
});
actor.update(dtSeconds);
actor.setUpdateInterval(1 / 15); // Host policy for a distant actor.
actor.dispose();
```

Rig translation is in local coordinates; IK targets and socket queries are
mesh-local. Layers modify only authored channels. A layer mask does not implicitly
include descendants: name every bone to include. Updating a layer retains its clock.
Use `player.locomotion.set({ samples: [{ clip: "walk", threshold: 0 },
{ clip: "run", threshold: 1 }], parameter: 0.5 })` for a synchronized locomotion
blend, then add masked action layers. Changing its parameter retains cycle phase.

`player.setProceduralOverride(pose => ...)` runs after layers. The array stores
translation XYZ, quaternion XYZW and scale XYZ per node. Keep it pure; the runtime
can evaluate again without advancing time. Nonfinite transforms, nonpositive
scales and zero quaternions are errors.
Treat `pose` and `palette` as read-only outside the procedural callback; direct
array edits bypass change tracking. Interrupted transitions snapshot the base pose
before layers, so persistent actions and additive motion are applied once.

`player.setRootMotion("hips")` gives base translation ownership to the host:
`consumeRootMotion()` returns and clears the local displacement. Apply that through
your character/physics controller. Root rotation is not extracted. Seek does not
move the host. Layers must not translate the host-owned root. Crossfades of nonlinear
root motion are approximated over the update interval.

`retargetSkin(source, destination, mapping, translationScale)` transfers clips onto
the destination's rest proportions. Every animated source node must be mapped,
along with its parent chain. Names and destinations must be unique. Use rigs with
compatible bone axes/rest semantics; arbitrary-rig humanoid inference is not provided.

For CPU inspection call `deformSkin(skin, player.palette, positions, normals,
outPositions, outNormals)` with reusable output arrays. Normal output uses the
inverse transpose of the blended skin matrix, including nonuniform scale.
Optional paired `tangents`/`outTangents` arguments preserve authored vec4 frames;
normal output is required too. Tangents use the linear transform and are
re-orthogonalized against normals, with reflected handedness and a zero marker
for unavailable or collapsed frames. Mounted imported meshes share immutable
source streams and deform tangents only for material consumers that need them.
See [decision 0212](../spec/decisions/0212-authored-tangent-integration.md) for
source fields, mapped PBR, derivative fallback and buffer ownership.

The [character composition workshop](../examples/character-composition/README.md)
demonstrates the mounted workflow on original CesiumMan geometry and a generated
compatible proportion variant. It combines locomotion, masked override/additive
actions, procedural pelvis adaptation, feet on unequal heights, two hand grips and
host-owned travel, with authored vertex deformation and shadows. Run
`node examples/character-composition/serve.mjs` and open `http://127.0.0.1:5189/`.
Its README identifies generated motions, explicit rig assumptions, numeric limits,
recovery behavior and reproducible CPU/GPU checks.

## Mounted-scene extensions

```ts
const app = await mountMtek(canvas, program, {
  hostServices: { navigation: myNavigationService },
  extensions: [{
    id: "my-package.navigation", apiVersion: 1,
    setup(context) {
      const navigation = context.service("navigation");
      return () => navigation?.dispose();
    },
    beforeFrame(context, delta) {
      const entities = context.readTransforms();
      context.writeTransforms(entities.map(entity => ({
        id: entity.id,
        position: { ...entity.position, x: entity.position.x + delta }
      })));
    }
  }]
});
```

The snippet illustrates the API; type host services with your own interface, e.g.
`context.service<NavigationService>("navigation")`. IDs are opaque and scoped to
the live scene, including spawn generations. Reacquire IDs after scene replacement.
Snapshots contain local transforms. Batches validate before any write; bindings
retain ownership later in the frame. `context.animation(id)` obtains an actor's
live animation player. Hooks run before input/update work and after presentation
commands respectively; a throwing hook is disabled and cleaned up once.

## Content loading and unloading

```ts
import { AssetPool } from "./runtime.js";
const assets = new AssetPool({
  baseUrl: new URL("./", location.href),
  allowedOrigins: [location.origin, "https://assets.example.com"],
  maxAssetBytes: 16 * 1024 * 1024
});
const jsonLoader = {
  id: "my-package.json", apiVersion: 1 as const,
  decode: bytes => JSON.parse(new TextDecoder().decode(bytes))
};
const abort = new AbortController();
const lease = await assets.load({ url: "content/scene.json" }, jsonLoader, {
  signal: abort.signal,
  onProgress: ({ loaded, total }) => showProgress(loaded, total)
});
useContent(lease.value);
lease.release(); // Last lease disposes the resource; no idle cache is retained.
assets.dispose();
```

Loaders may define `dispose(value)` for decoded resources such as textures or scene
bundles. Keep loader instances stable: one ID cannot name two implementations in
one pool. Consumers share live fetches/decodes; cancellation of one consumer does
not abort the others. Requests can require exact `bytes` and `sha256`. Redirects
and implicit remote origins are rejected. This independent API does not change
compile-time asset loading or add GLB compression/morph support.

## Rendering and movement

```ts
const app = await mountMtek(canvas, program, {
  rendering: {
    additiveMaterials: ["effects.mtek::Glow"],
    postProcessing: [{
      id: "desaturate",
      wgsl: `fn effect(c: vec4f, uv: vec2f) -> vec4f {
        let luminance = dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
        return vec4f(vec3f(luminance), c.a);
      }`
    }]
  },
  physics: { continuousCollision: true }
});
```

Material IDs come from the manifest. Additive draws keep depth testing, disable
depth writes and add `source.rgb * source.a` to the destination. Ordinary draws
keep their existing alpha-over behavior. Effects run in the listed order; use
`sampleScene(uv)` for neighboring samples. Values are linear; hardware performs
sRGB conversion. Effects are LDR. There is no HDR bloom, automatic exposure,
shadow mapping or environment lighting. Shader errors fail mount; effects rebuild
after device loss. GPU render-pass counters exclude skinning and post effects.

Image assets now have mipmaps, including NPOT textures. Color textures average
in linear light; data textures retain linear data semantics. Straight-alpha mip
filtering can show fringes around transparent texels.

The independent Rapier adapter optionally exposes `castShape`, `moveCharacter`,
`setCollisionGroups` and `contacts`. Test method presence on alternative adapters.
Sweeps take displacement over the interval `[0, 1]`; character queries return a
displacement for the caller to apply. Advance movement in fixed ticks and implement
moving-platform carry in the host. CCD is opt-in and does not sweep teleports.
