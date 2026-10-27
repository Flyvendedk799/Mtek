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
compatible bone axes/rest semantics.

For bipeds with different names, proportions or rest poses (T-pose and A-pose),
`mapHumanoid(skin)` finds the canonical humanoid bones from names and, failing that,
from the skeleton's shape (it returns `{ error }` for non-humanoids such as the Fox), and
`retargetHumanoid(source, target)` plays the source clips on the target through both maps,
with rest-pose correction and the hips translation scaled by the leg-length ratio. Extra
and unmapped bones keep their bind pose. See
[decision 0221](../spec/decisions/0221-humanoid-mapping-and-retargeting.md) and
[`spec/animation.md`](../spec/animation.md) for the rules and measured accuracy.

A `.mtek` program reaches the same machinery without host code (decision 0223): the
`animation.*` calls `set_layer`, `fade_layer`, `blend_sample`/`blend_play`/`blend_parameter`,
`limb_goal`, `foot_placement`, `chain_goal`, `root_motion` and `take_root_motion` take world-space
goals and return the root displacement in world space for `body.move_character`, and the entity
field `clips_from: asset.glb("..")` plays another humanoid's clips through `retargetHumanoid` when
the scene mounts. A name the entity lacks is `E8111`, a rig that is not a humanoid `E8110` or `E8112`,
a refused argument `E8113`; each is reported once per entity and the call returns `false`. The
mounted runtime keeps this state with the entity's `SkeletonPlayer`, so `player.layers`,
`player.ik` and `player.blend` show and can change what a program set, and a hot reload starts it again
(`spec/animation.md` section 4).

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

A `.mtek` program moves a character itself: a `Kinematic` body with a
`CapsuleCollider` calls `self.body.move_character(velocity * dt, rotation)` from
`fixed_update`, reads `self.body.grounded` and `self.body.ground_normal`, and gets
collide-and-slide, stair stepping, the slope limit, ground snapping and
moving-platform carry (a kinematic platform under the character moves it by the
platform's translation and yaw) without host code. The optional `Kinematic` fields
`max_slope`, `step_height`, `step_min_width`, `snap_to_ground`, `skin` and `carry`
tune it (`spec/physics.md` section 2). Gravity is not applied; add your own vertical
motion. Passing back `self.rotation` keeps the character's facing, and a turning
platform turns it with the platform (decision 0218). `examples/character-movement`
is a playable course with stairs, a ledge, two slopes, walls and three kinds of
moving platform, and its browser spec walks it on both local backends.
`Dynamic { continuous: true }` asks for continuous collision detection for
one body; the `physics.continuousCollision` mount option enables it for every dynamic
body. CCD is opt-in and does not sweep teleports.

### Spatial queries from the host

`app.physics` and `ExtensionContext.physics` are `undefined` when the running
program has no physics, and otherwise one object with four methods that take and
return entity IDs, the same opaque IDs as `inspectScene()` and `readTransforms()`
(never adapter handles or slots):

```ts
const physics = app.physics;
if (physics) {
  const hit = physics.castRay({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 20, {
    exclude: playerId,            // an entity ID whose body the query ignores
    includeSensors: false,        // the default
    groups: { memberships: 0x0001, filter: 0xffff }  // optional 16-bit masks
  });
  if (hit) console.log(hit.entityId, hit.distance, hit.point, hit.normal);

  const swept = physics.castShape(
    { kind: "capsule", radius: 0.4, height: 1.8 },        // or sphere / box (full extents)
    { position: { x: 0, y: 1, z: 0 } },                    // rotation defaults to identity
    { x: 3, y: 0, z: 0 }                                   // displacement; fraction is 0..1
  );
  for (const contact of physics.contacts(bodyId)) console.log(contact.entityId, contact.distance);
  physics.setCollisionGroups(bodyId, 0x0002, 0x0001);     // memberships, filter
}
```

Queries read the world as of the last completed tick: they never step it, and
nothing here moves a body, so the single pose authority of `spec/physics.md` holds
(a program moves its own bodies; a host that wants to move one writes a host input
the program reads). A collider added in a tick (a spawn) is seen from the next tick.
Inputs are validated: a bad value throws a `RangeError` or `TypeError` and an unknown
or stale ID, or an entity without a physics body, a `RangeError`. The methods are
always present; one the loaded adapter does not implement throws a
`MtekPhysicsUnsupportedError` that names the method and the adapter, so an alternative
adapter is detected by catching it. `setCollisionGroups` lasts until the physics world
is rebuilt by a hot reload. Types (`MtekPhysics`, `MtekQueryShape`, `MtekQueryOptions`,
`MtekRayHit`, `MtekShapeHit`, `MtekContact`) are exported from `@mtek/runtime-web`.

Alternative adapters implement the optional `castRay`, `castShape`, `moveCharacter`,
`contacts` (normals point from the other body toward the queried one: a floor gives +Y) and `setCollisionGroups` of `spec/physics.md` section 5; without
`moveCharacter` a `move_character` command is dropped with `MTEK-E8105`. Sweeps take
displacement over the interval `[0, 1]`.
