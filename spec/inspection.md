# Copied scene and animation inspection

Delivered in the platform step under [decision 0208](decisions/0208-spatial-inspection-and-diagnostics.md).
These are additive optional capabilities of extension and animation API 1. There
is no manifest or language change. Older providers may omit these methods;
consumers must report unavailable data and retain ordinary transform controls.

## Scene snapshots

`ExtensionContext.inspectScene?.()` returns a fresh `SceneInspection` when the
provider has spatial data; an absent capability/provider yields `undefined`.
As with other context methods, calls after application teardown are invalid and
the mounted runtime rejects them. It is a passive CPU read: it does not propagate scene
transforms, evaluate animation, step physics, consume renderer change flags,
submit commands or read back GPU data. Use the after-frame hook for completed
scene state. Between frames, changes may precede their propagation or rendering;
the snapshot is not a promise of an atomic arbitrary-time render capture.

The snapshot contains the last rendered viewport and column-major view-projection
matrix (WebGPU clip space, z in [0,w]), a renderable flag and a frame counter when
the surface exposes one. It includes last-propagated world matrices and parent
IDs. Entity/contact identities use scene and spawn generations; stale targets
cannot alias a replacement. Internal slots, mutable runtime records and GPU
handles are not exposed. Every returned array, vector, shape and matrix is copied.

Draw bounds identify their source: authored final-local sphere, compute attachment,
current animated enclosure, ordinary mesh or unbounded shader. Spheres are
expanded into world space conservatively, including inherited nonuniform scale
and shear where required. The culling flag uses the active camera. Stale animated
enclosures and unbounded authored shaders report a null sphere. Pending compute
output is not presented as a completed draw. A bound is an enclosure supplied to
the renderer, not proof that arbitrary authored vertex arithmetic stays inside it.

The host can also ask the physics world questions (ray and shape casts, contacts, collision groups) by the same entity IDs: `app.physics` and `ExtensionContext.physics`, decision [0217](decisions/0217-character-movement-language-and-host.md) and `docs/platform-runtime.md`.

Physics records contain actual backend body poses, the validated collider passed
to that backend, active state and optional contacts. Mesh/entity scale must not be
applied again to the nominal collider dimensions. Contacts are world-space and
their other ID is null when no live scene entity can be resolved. A provider
without contact support omits contacts; missing data does not mean zero contacts.

## Animation snapshots

`AnimationPlayer.inspect?.()` copies current mode, active base clip, transition
progress/outgoing clip/snapshot status, root-motion node, procedural override
state, ordered layers, IK settings and locomotion sample weights. Layer masks are
the effective node-indexed evaluation masks. IK reports normalized effective hinge
limits and actual target/chain indices. Nodes carry indices, parents, joint flags
and last evaluated mesh-local positions; duplicate node names remain distinct.
These positions include layers and constraints but precede material-authored
vertex deformation. Multiply by the entity world matrix for world overlays.

Inspection does not advance clocks, reevaluate poses or consume extracted root
motion. Pose throttling therefore exposes the last evaluated pose while clocks
may continue. Shared-pose players expose shared evaluation state. Transition and
layer clocks can continue when only the base clip is paused; the host application
pause freezes the whole frame.

## Optional consumer

`@mtek/inspector` is a separate private development package. Its controller freezes
copied snapshots, queues edits before frames and polls its ordinary panel at four
snapshots per scene second by default. Spatial subscribers opt into after-frame
sampling; with no subscribers there is no spatial snapshot work. Opening the
spatial panel or mounting an overlay creates a subscription; closing/disposal
removes it. Source resets clear stale selection and geometry immediately.

The Canvas2D overlay draws finite world bounds, node-indexed skeletons, IK targets
and reach errors, actual box/sphere colliders and contact normals. It performs
homogeneous clipping against all WebGPU clip planes, including positive w, and
rejects nonfinite coordinates. Selection is the default scope. All-scene mode
applies to bounds/colliders/contacts; skeleton/IK diagnosis remains selected.
Lines do not participate in scene depth testing or picking.

The transparent, pointer-free canvas lives in a Shadow DOM and aligns to the
render canvas content box, including borders/padding, scrolling, resize, device
pixel ratio and positive axis-aligned CSS scaling. Rotated, skewed, reflected or
perspective CSS ancestors are unsupported and reported. Segment count defaults
to 4,096 and is capped at 16,384; truncation is explicit. Backing storage caps DPR
at 3, each dimension at 8,192 and total pixels at 16,777,216. Hidden/disposed
overlays release backing storage. Disposal removes observers, subscriptions and
listeners; no independent animation timer or GPU resource is introduced.

See the [package usage](../packages/inspector/README.md) and actual
[inspection studio](../examples/inspection-studio/README.md). Resource provenance,
persistent authored IDs, source editing and the full end-to-end workflow corpus
remain separate roadmap work. Desktop hardware and SwiftShader acceptance do not
establish integrated/mobile or another physical-device tier.
