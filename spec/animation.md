# Animation: composition, adaptation and measured behaviour

- Repository path: `spec/animation.md`
- Status: Normative for the composable-animation area (decision 0219). Earlier
  behaviour (clips, skeletal playback, layers, 1D locomotion, IK, retarget frames)
  is specified by decisions 0190, 0191, 0192, 0196 and 0209.

## 1. Blend spaces and layer fades (decision 0220)

Host API of `AnimationPlayer` and `AnimationController` (extension API 1; no new
runtime ABI and no Mtek syntax; the source surface is section 4).

### 1.1 Blend spaces

`player.blend` plays a **blend space**: 1 to 32 samples `{clip, x, y}` and a
parameter `(x, y)`. While it is active it replaces the base clip, exactly where
the 1D locomotion blend of decision 0196 does (before layers, procedural
overrides and IK; base weight and fade still apply). `player.locomotion` is the
same object seen in one dimension: thresholds are `x`, `y` is `0`. Setting either
configures the other, `locomotion.set` keeps its strict ordering rules, and the
earlier behaviour is unchanged.

```ts
player.blend.set({ samples, parameter?, phase?, speed?, looping? } | undefined): void
player.blend.setParameter(x: number, y?: number): void   // y defaults to 0
player.blend.seek(phase: number): void                    // [0, 1]; no crossings, no root motion
player.blend.play(looping?: boolean, speed?: number): boolean
player.blend.pause(): boolean;  player.blend.resume(): boolean
player.blend.crossedPhase(phase: number): boolean
player.blend.crossed(clip: string, seconds: number): boolean
// readable: active, phase, parameter {x, y}, playing, finished, duration, revision
controller.setBlendSpace(options | undefined);  controller.setBlendParameter(x, y);
```

`set` validates everything before changing anything. It throws `RangeError` for
no or more than 32 samples, a missing or zero-length clip, a non-finite point,
parameter, speed or phase, and **two samples at the same point**. The parameter
defaults to the first sample. Unlike `locomotion.set`, one sample is allowed (its
weight is always one). The same clip may appear at several points.

**Weights.** For a parameter `p` the weights `w_i` of the samples are:

1. *Inside the convex hull*: the barycentric coordinates of `p` in the triangle of
   the Delaunay triangulation of the sample points that contains it.
2. *Outside the hull*: the weights of the nearest point of the hull boundary
   (Euclidean distance in the unscaled `(x, y)` plane), linear on the hull edge
   that holds it. Pick axes with commensurable scales; the host may scale an axis.
3. *Collinear samples* (including every 1D case, any direction, and one or two
   samples): piecewise-linear interpolation of the orthogonal projection of `p`
   onto the line, clamped to its end points.

Properties, asserted for fixed layouts (triangle, grids, hexagon with centre,
collinear hull edges, scattered sets up to 32 samples) and 40 random lattice
subsets: the weights are nonnegative and sum to one (to 1e-12); weight one at
every sample, zero elsewhere; deterministic; and continuous in `p`, including
across triangle edges, through vertices, onto the hull and beyond (a tenfold
smaller parameter step gives a tenfold smaller weight change). At most three
samples are nonzero away from the collinear case, so at most three clips are sampled.

The triangulation takes each sample triple with a non-degenerate area (relative
tolerance 1e-12) whose circumcircle holds no other sample strictly (relative
tolerance 1e-11). Exactly cocircular quadruples, as in every grid cell, are
resolved by lifting the points onto a paraboloid with a fixed integer-hash
perturbation (the regular triangulation of that lifted set), so the choice of
diagonal is consistent and depends only on the sample order. The solver is
rebuilt only when the point list changes, so calling `set` every frame with the
same layout is cheap; a change of layout costs at most `C(32,3) * 32` circle tests.
Samples that are nearly but not exactly collinear can form thin triangles with a
steep but finite weight slope; this is a property of the layout, not smoothing.

**Cycles.** All active clips share one normalized phase in [0, 1). Its rate in
cycles per second is `speed * sum(w_i / duration_i)` (the weighted harmonic mean
of the durations, as `duration` reports it), evaluated with the weights at the
start of the advance. Changing the parameter therefore never moves the phase, and
the pose is continuous with the parameter. Clips that should step in unison must
have aligned cycles; the blend does not time-warp them. Clips are blended in
sample order, each by its share of the weight so far (lerp for translation and
scale, shortest-arc SLERP for rotation); channels a clip lacks use the bind
value. Playback loops by default; a non-looping blend holds phase one and
finishes. `crossedPhase` and `crossed` describe the most recent advance with the
weights that advanced it, retain multiple wraps and are unaffected by pose
throttling. With root motion owned by the host, the weighted translation delta
of the root node accumulates over every wrap on each advance; the displayed root
stays at bind. Layers (section 1.2), procedural overrides and IK compose on top
unchanged. A named `transition` or `copyPose` clears the blend, as for locomotion.

**Inspection.** `AnimationInspection.blend` is `{phase, parameter, samples[{clip,
x, y, weight}]}` with the current weights, or `null`. `mode` stays `"locomotion"`
while any blend space is active (the inspector panel and controller already
treat that mode as "phase-synchronized blend"). `AnimationInspection.locomotion`
keeps its 1D shape and is non-null only when every sample has `y = 0`.

### 1.2 Layer fades

```ts
player.layers.fade(id: string, weight: number, seconds: number): boolean
controller.fadeLayer(id, weight, seconds): boolean
```

The layer's weight moves from its current weight to `weight` along a smoothstep
(`3t^2 - 2t^3`, the curve of clip transitions) over `seconds`, advanced by
`advance` independently of the layer clock, so the result depends only on the
total time and not on the frame partition, and a hitch past the end lands exactly
on the target. Fades are continuous and interruptible: a new `fade` starts from
the weight the layer has at that moment and replaces the fade in progress; `set`
cancels a fade and applies its own weight at once (retarget with `fade` for a
smooth change). The layer keeps its clock, speed and phase throughout. Zero
seconds applies the weight immediately. A layer faded to zero stays registered and
keeps playing; only `remove`/`clear` delete it. It returns `false` for an unknown
layer and throws `RangeError` for a weight outside [0, 1] or a negative or
non-finite duration.

`AnimationLayerInspection` gains `targetWeight` (the fade target, or the weight
when none) and `fadeRemaining` (seconds left, `0` when none); `weight` is the
weight applied now.

## 2. Automatic humanoid mapping and retargeting (decision 0221)

<!-- 0221 writes this section, including its generated measurement table. -->

## 3. Anatomical limb solving (decision 0222)

<!-- 0222 writes this section, including its generated measurement table. -->

## 4. Composition in Mtek programs (decision 0223)

<!-- 0223 writes this section. -->
