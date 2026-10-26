# 0193 — GPU skeletal deformation and independent runtime extensions

Status: accepted. Extends 0191/0192 and the host API without changing runtime ABI 1
or the accepted Mtek source language. This is an implementation increment toward
the platform step; it does not declare the entire platform roadmap complete.

[Decision 0196](0196-animation-blends-and-crowds.md) subsequently adds synchronized
locomotion, mounted distance policies, orientation/hinge constraints, retarget
frames and explicit shared-pose crowd instancing. The limits below describe this
earlier increment; use 0196 for those extended animation capabilities.

The CLI browser runner now accepts Node 22.18+, Node 23.6+ and Node 24+ instead
of incorrectly rejecting all Node 22 installations. Version boundary tests and
the npm engine range follow [Node's type-stripping history](https://nodejs.org/api/typescript.html).
The first broad browser run found the old major-only gate on Node 22.23.2 before
the affected CLI cases could run. Node 24 remains the recommended CI version.

## Skeletal rendering

The WebGPU renderer shares bind geometry and influences across actors. Each actor
owns a palette and storage/vertex output buffers. A compute pass evaluates linear
blend positions and the inverse-transpose normal of the blended matrix, preserving
the existing vertex ABI for every material. Palette uploads are 64 bytes per joint
per changed visible actor; unchanged poses upload nothing. Actors still use
individual draw calls: this is GPU deformation, not instanced crowd rendering.

Per-joint bind-space boxes enclose every influenced vertex. Their transformed union
encloses every nonnegative normalized blend. A mesh-local sphere enclosing that
union and a conservative bound on inherited scale/shear drive frustum culling.
Bounds update before culling, deformation after it. Invisible actors continue their
clocks and pose evaluation, preserving sockets and markers. Geometry deformation is
skipped. Source geometry and the CPU `deformSkin` function remain available for
inspection and collision queries; the CPU renderer path remains for injected
devices without compute support. Distance policy is explicit through the independent
controller's `setUpdateInterval`, not an automatic mounted-scene distance heuristic.

## Animation evaluation

The order is base clip/crossfade and base weight, layers in insertion order,
procedural local-pose override, root translation ownership, positional IK, global
matrices, then palette and sockets. Pose storage uses ten numbers per node:
translation XYZ, quaternion XYZW, scale XYZ. Overrides must be pure, finite and
keep positive scales and nonzero rotations; they may run more than once per frame.

Override layers affect only their authored channels. Their weight multiplies a
per-node mask (missing nodes have zero weight). Additive translation is a bind-pose
delta, rotation is a bind-relative quaternion delta, and scale is a multiplicative
bind-relative ratio. Updating a layer's weight retains phase. Locomotion can be
blended with ordered weighted layers; there is no dedicated blend-tree language.

`setRootMotion(name)` gives translation ownership to the host. The selected base
clip's local translation delta is accumulated across wraps, can be consumed once,
and is removed from the displayed pose. No automatic entity or physics movement is
performed. Layers and procedural overrides must not author translation on the
host-owned root; such translation is discarded and is not added to extracted motion.
Constant-velocity root motion uses the mean smoothstep crossfade weight; nonlinear
motion during a transition remains a finite-step approximation. Rotation extraction
is not supported.

IK accepts contiguous named chains and mesh-local position targets. Work is bounded
to 1–64 CCD iterations. Weight interpolates the target from the unconstrained end
effector. Constraints run in insertion order. There are no angular joint limits,
orientation targets, collision constraints or exact-reach guarantees. Full extension
and unreachable targets may leave a residual; multiple constraints on one chain
can conflict. Foot placement and two independent hand grips are demonstrated by
`examples/incremental-animation`, with skeleton overlays.

Retargeting validates unique names, a one-to-one mapping and matching mapped parent
relationships. Every animated source node must be mapped. Local bind-relative
motion is transferred, with an explicit translation scale; target proportions,
inverse binds and influences remain its own. Compatible coordinate axes and rest
semantics are an author responsibility. This is not automatic arbitrary-humanoid
retargeting or glTF humanoid metadata inference.

## Independent consumption and lifetime

`createAnimationController` accepts manifest-shaped skin data and structural bone
setters implemented by Three.js. It imports no compiler or renderer. Pose evaluation
can be throttled while clocks and marker windows advance at every update. Disposal
drops bone references and clears procedural/layer/IK hooks; later updates fail.

`MtekMountOptions.extensions` accepts only extension API 1 with unique IDs. Setup
runs in declaration order; teardown in reverse. A setup failure rolls back installed
extensions and mounted resources. A throwing frame hook disables that extension,
runs teardown once and reports an error while other rendering continues. An
extension owns cleanup of resources acquired before its own setup throws.

Context snapshots copy local transforms. Batch writes validate every entry before
applying any, normalize rotations and reject stale entities. Bindings later in the
frame retain their normal ownership. Host services are explicitly supplied by name.
Live animation players can be obtained for skeletal entities. Callers should query
the context again after scene changes instead of retaining world-owned players.

`AssetPool` is separately consumable. Versioned custom loaders decode fetched bytes;
leases deduplicate live requests and resource values. Individual abort signals
cancel only their consumer; the final release aborts the shared request and disposes
the value. A late decoder result is disposed too. Failed resources are not retained.
Progress, exact lengths, optional SHA-256 and streaming size limits are supported.
Allowed origins are declared; redirects and credentialed requests are refused.
This does not change compile-time `asset.glb`/`asset.texture` or retire E7901.

## Rendering options

Image asset textures receive complete mip chains on WebGPU. Mip filtering averages
in linear light for sRGB textures and includes NPOT edges. Built-in texture overrides
retain their existing single-level test behavior. Straight-alpha texture filtering
can show fringes; premultiplied alpha import is not provided.

Host rendering options can select additive materials by manifest ID. Color blends
as `source.rgb * source.a + destination.rgb`; alpha adds and clamps in the target.
Depth testing stays enabled and depth writes disabled. Ordinary transparency keeps
back-to-front object sorting and alpha-over blending. Intersections and particle
ordering keep the documented per-object limitations. Skinned particles are not added.

Ordered host-authored WGSL post effects run after scene rendering and before
presentation, in linear color with hardware sRGB conversion. Scratch targets are
bounded to two and replaced on resize/recovery. Effects are LDR, not an HDR bloom
or tone-mapping implementation. They expose no custom Mtek shader stage. Shader
errors reject mount during preparation; recovery revalidates effects. Existing
development GPU pass timing excludes compute skinning and post effects and must not
be reported as whole-frame GPU time.

## Optional physics capabilities

The Rapier adapter adds shape sweeps, collision group filtering, positional character
movement queries and contact inspection. Alternative adapters can omit these optional
methods. Character movement returns a safe displacement; the caller applies it and
owns fixed-step timing, gravity and moving-platform carry. Autostep, slope and ground
snap settings map to the pinned Rapier implementation. These APIs do not yet have
Mtek language intrinsics.

`mountMtek(..., {physics:{continuousCollision:true}})` enables CCD for dynamic bodies,
including spawned bodies and rebuilt scenes. The default preserves the measured
discrete-physics contract. Regression evidence covers a radius-0.05 m sphere at
240 m/s against a 0.1 m moving plate at 60 Hz. This establishes that case only, not
a universal speed or thickness guarantee; teleports are still unswept.
The mounted 17-lane fixture also records a retained failure with all-body CCD:
lane D06, starting at x=3.065 m with speed 9 m/s, passes the moving plate. The
browser regression preserves the lane table as an attachment. CCD must therefore
remain opt-in and must not be advertised as a complete tunnelling fix.
