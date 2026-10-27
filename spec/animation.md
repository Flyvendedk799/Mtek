# Animation: composition, adaptation and measured behaviour

- Repository path: `spec/animation.md`
- Status: Normative for the composable-animation area (decision 0219). Earlier
  behaviour (clips, skeletal playback, layers, 1D locomotion, IK, retarget frames)
  is specified by decisions 0190, 0191, 0192, 0196 and 0209.

## 1. Blend spaces and layer fades (decision 0220)

<!-- 0220 writes this section. -->

## 2. Automatic humanoid mapping and retargeting (decision 0221)

<!-- 0221 writes this section, including its generated measurement table. -->

## 3. Anatomical limb solving (decision 0222)

<!-- limb-solving:begin -->
| Measurement | Result | Bound |
|---|---|---|
| Reach error, reachable targets (relative to full reach) | 32000 targets, 4 rigs x 4 limbs: at most 1e-6 | 1e-5 |
| Beyond reach: end-joint distance / full reach | 77760 targets: at most 1 | <= 1.000001 |
| Beyond reach: monotone in target distance | 0 violations | 0 |
| Beyond reach: direction error | at most 1e-6 rad | 1e-5 rad |
| Soft reach profile, upright left leg (end / reach at target 0.95, 1.0, 1.1, 2.0 x reach) | 0.95, 0.9864, 0.9991, 1 | monotone, <= 1 |
| Middle joint outside its range | 0 of 153600 targets; flexion seen 0.264 to 150 deg | 0 (knee 0-150, elbow 0-145 deg) |
| Reverse bends (negative flexion about the bind hinge) | 0 | 0 |
| Knees behind the hip-ankle line (legs, lower hemisphere) | 0 | 0 |
| Non-finite poses (sweeps and degenerate targets) | 0 of 154304 | 0 |
| Continuity: largest joint rotation per unit of target travel / reach (soft 0.05) | 8.77 rad | 12 rad |
| Continuity: same paths with a hard clamp (softness 0) | 99.7 rad | reference only |
| Foot placement: hips drop vs independent minimum | 86 steps/slopes, 2 rigs: at most 1e-6 | 1e-5 |
| Foot placement: foot joint to target | at most 1e-6 | 1e-5 |
| Foot placement: hips raised above the animated pose | 0 cases (largest drop 0.294 units) | 0 |
| Foot placement: foot orientation vs tilted animation | at most 1e-6 rad | 1e-5 rad |
| Foot placement: flat ground in reach leaves the pose unchanged | pose difference at most 1e-15, drop 0 | 1e-9 |
| Foot placement: smoothing follows D (1 - exp(-t / tau)) | 90 frames: deviation at most 1e-16, monotone | 1e-9 |
<!-- limb-solving:end -->

## 4. Composition in Mtek programs (decision 0223)

<!-- 0223 writes this section. -->
