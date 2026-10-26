# 0196 — Locomotion blends, constrained IK and shared-pose crowds

Status: accepted. Extends [0193](0193-platform-runtime-extensions.md), retaining
runtime ABI 1 and extension API 1. There is no new Mtek language syntax.

## Synchronized locomotion

`AnimationPlayer.locomotion.set` and `AnimationController.setLocomotion` accept
at least two `{clip, threshold}` samples in strictly increasing threshold order.
Clips must exist and have positive duration. The finite parameter selects its two
neighbours with linear weights; outside the range it clamps to an endpoint.
Missing channels use the bind transform. Rotation uses normalized shortest-arc
SLERP. This is a one-dimensional piecewise-linear blend, not a general graph or
two-dimensional directional blend space.

All clips use one normalized phase. Its cycles/second are the weighted mean of
the contributing clips' inverse durations, multiplied by the nonnegative playback
speed. Changing the parameter preserves phase; it does not smooth the parameter.
The host owns input smoothing. Setup snapshots thresholds and starts playing at
`phase` (default zero, initially in [0,1)). Playback loops by default. Seeking may
also select phase one to inspect the exact final keys. Seeking creates neither
marker crossings nor extracted root motion.

The mounted `animation.play/pause/resume/seek/time/duration/playing/finished/crossed`
controls target an active blend. Time/markers use seconds in its current effective
cycle; changing the blend parameter changes that duration. Non-looping playback
holds phase one and marks completion. `locomotion.crossed(clip, seconds)` instead
queries the named contributing clip's marker. Crossings describe the most recent
advance, using the weights that actually advanced it. Multiple wraps are retained.
Standalone callers use `player.locomotion` playback methods; `player.clock`
remains the underlying legacy single-clip clock.

The blend replaces the base sample, with base weight/fade applied, before ordered
layers, procedural overrides and IK. A transition to a named clip disables the
blend and captures the displayed unlayered base, avoiding double application of
additive layers during interruption. Clearing the blend resumes the underlying
base selection. A newly configured blend takes effect at the next evaluation.

Root-motion ownership extracts weighted translation deltas at the shared phase,
including every loop, on every advance. Displayed root translation stays at bind.
Pose throttling does not delay extraction. Weights are held constant over each
advance; the host must step changing controls explicitly. Rotational root motion,
automatic movement and general humanoid inference remain outside this API.

## Camera-distance pose policies

`setUpdatePolicy([{distance, interval}, ...])` accepts finite nonnegative values,
with strictly increasing distance thresholds starting at zero. Settings are copied
and validated before replacing the policy. The last threshold at or below camera
distance selects the minimum evaluation interval. Moving into a closer band
refreshes the pose immediately. The default evaluates every advance. Empty or
undefined policy restores that default.

Mounted players use world-origin distance to the active camera, after pending host
transforms propagate. Shared-pose groups use their nearest member. Standalone
controllers receive distance as `update(dt, force, distance)`; `setUpdateInterval`
sets a single constant band. Invalid standalone distance is rejected before clocks
advance. A forced update refreshes the displayed pose.

Clocks, marker windows, layers and root-motion extraction advance on every tick.
Only sampling, procedural evaluation, IK, matrices and palette construction are
throttled. Socket queries therefore describe the last evaluated pose. Bounds and
deformation use that same displayed pose; skipped sampling cannot cull limbs from
a pose that is actually drawn. Distance is not a screen-size/visibility heuristic,
and invisible group members currently participate in nearest-distance selection.

## Orientation and hinge constraints

IK retains bounded positional CCD and insertion-order composition. Optional
`rotation` supplies a normalized mesh-local end-effector target; `rotationWeight`
multiplies the positional weight. The solver converts it through the current mesh
and parent rotation frames after positional iterations, then shortest-arc blends
the end node's local rotation. This changes orientation without changing that
node's own position. Other constraints or child effectors can still interact.

Named `limits` select bind-local hinges: a finite nonzero axis and signed
`min/max` radians in [-pi,pi]. Other rotational degrees of freedom are locked.
The current bind-relative twist is projected onto the axis, normalized and clamped
before solving, after every affected CCD step, and after final end orientation.
Limits must name nodes in the constraint chain. These are hinges, not arbitrary
swing cones, collision constraints or a complete anatomical model.

Orientation requires uniform positive scales along mesh and end-parent ancestry;
animated or procedural nonuniform scales raise an actionable range error. The
mesh frame cannot descend from the end effector. Position-only IK keeps its prior
scale support. Unreachable or conflicting targets may leave a residual; bounded
iterations are a work limit rather than an exact-reach guarantee.

## Retarget frames

The existing numeric fourth argument of `retargetSkin` keeps its original local
bind-relative transfer. The options form adds `rotationSpace: "world"`, a global
translation multiplier and absolute per-source-node translation multipliers.
Names and mappings stay explicit; every animated source node must be mapped.

World mode preserves the bind-relative global rotation delta at mapped nodes.
For source/target parent bind rotations Ps/Pt and local bind rotations Bs/Bt,
with C = inverse(Pt) * Ps, each source key Q becomes:

```
C * Q * inverse(Bs) * inverse(C) * Bt
```

Translation deltas rotate through C before the explicit multiplier; scale retains
the existing bind-relative ratio. Linear/STEP interpolation and original key
times remain intact, with no resampling. Uniform bind and animated scales are
required in world mode. Static unmapped helper nodes are permitted when nearest
mapped ancestors correspond; unmapped animated helpers are rejected. Local mode
retains its stricter direct-parent rule. Target geometry, influences, inverse binds
and proportions remain its own. This does not infer humanoid names, axes or size.

## Explicit crowd pose cohorts

`ExtensionContext.shareAnimation(sourceId, targetIds)` validates the entire batch
before linking identical skeletal assets. Members intentionally share one player:
clip/blend phase, transitions, layers, IK, policy and palette. Controls on any member
affect the cohort. Root-motion deltas are consumed once per cohort; hosts applying
them to multiple actors must distribute that result themselves.

Every cohort advances once per tick, using its nearest member for distance policy.
Per mesh source, it also shares deformed vertex buffers, conservative bounds and
one palette upload/compute dispatch. Different source meshes retain distinct
outputs. Independent players always have distinct mesh sort identities. Opaque
compatible cohort members can therefore use the existing instanced pipeline;
different poses, parameters, pipelines or meshes stay separate. Transparency
retains individual back-to-front draws. Shadow rendering still draws casters
individually while sharing deformation.

`detachAnimation(id)` creates an independent held snapshot. Selecting a named clip
or blend resumes motion; controls from the old cohort are not copied. Removing a
member keeps shared resources alive until the final member releases them. Rejoining
releases retired outputs. Hosts can use several explicit source cohorts for phase
variation and detach actors for individual actions. Independent animation still
needs one palette/output per actor; there is no palette texture atlas or vertex-stage
skinning path for arbitrary independently animated instances.

Animation players and entity IDs belong to a scene generation. Extensions must
re-query IDs and reapply animation settings after scene/device reconstruction;
they must not retain an old player as a recovery source. The browser recovery
probe demonstrates a generation-aware hook, retained host phase and bounded
detach/rejoin cycles.

## Package cost and evidence

The manifest validator generator reuses `$defs` functions instead of duplicating
their implementations at every reference. Ajv remains build-time-only. A
differential test against the preceding inline strategy checks acceptance and
ordered user-facing failures over the complete shared manifest corpus. Private
`schemaPath` strings may differ at reference boundaries. No schema restriction,
public validation message or size budget is relaxed.

See [the implementation record](../../evidence/platform-step/animation-progress.md)
for final checks, screenshots, transfer counts and remaining acceptance work.
Synthetic correctness/transfer probes and the Three.js integration are not a
matched performance benchmark, a production character corpus or a multi-device
support claim.
