# Animation: composition, adaptation and measured behaviour

- Repository path: `spec/animation.md`
- Status: Normative for the composable-animation area (decision 0219). Earlier
  behaviour (clips, skeletal playback, layers, 1D locomotion, IK, retarget frames)
  is specified by decisions 0190, 0191, 0192, 0196 and 0209.

## 1. Blend spaces and layer fades (decision 0220)

<!-- 0220 writes this section. -->

## 2. Automatic humanoid mapping and retargeting (decision 0221)

SECTION2_BODY

<!-- humanoid-retarget:begin -->
Mapping (generated; `npm run humanoid:check` verifies it). Required bones correct (of 15), optional bones found, evidence counts and confidence:

| Skeleton | Required | Optional found | Not found | Name / structure | Confidence |
| --- | --- | --- | --- | --- | --- |
| mixamo (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 0.973 |
| unreal (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| unity (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| vrm (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| rigify (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 20 / 2 | 0.977 |
| plain (synthetic) | 15/15 | chest, neck | upperChest, leftShoulder, rightShoulder, leftToes, rightToes | 17 / 0 | 0.973 |
| bip (synthetic) | 15/15 | chest, neck, leftShoulder, rightShoulder, leftToes, rightToes | upperChest | 21 / 0 | 1.000 |
| snake (synthetic) | 15/15 | chest, neck, leftShoulder, rightShoulder, leftToes, rightToes | upperChest | 21 / 0 | 0.973 |
| short (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 22 / 0 | 1.000 |
| scrambled (synthetic) | 15/15 | chest, upperChest, neck, leftShoulder, rightShoulder, leftToes, rightToes | none | 0 / 22 | 0.750 |
| CesiumMan | 15/15 | chest, neck, leftToes, rightToes | upperChest, leftShoulder, rightShoulder | 19 / 0 | 0.907 |
| CesiumMan, legs x1.2 arms x0.9 | 15/15 | chest, neck, leftToes, rightToes | upperChest, leftShoulder, rightShoulder | 19 / 0 | 0.907 |
| Fox | rejected: the spine is not opposed to the legs (not an upright biped) | | | | |

Variant matrix: 180 of 180 synthetic skeletons (10 naming conventions x 3 rest poses x 3 mesh frames x 2 bone-axis conventions, with props, twist bones, a tail, fingers and face bones) map all 15 required bones correctly, 180 of 180 map every bone of the fixture and nothing else. Proportion and unit variants: 80 of 80.

Retargeting (generated). Limb error: the largest angle between corresponding limb segments (both upper and lower arm and leg), over all frames, in degrees; uncorrected: the same with `restCorrection: false`. Hips ratio: mean height of the hip joints above the lower ankle, target over source, against the leg-length ratio. Foot height error: in stance, the target ankle height above its bind ankle plane against the source's scaled by the leg ratio, in leg lengths. Slide: target foot speed beyond the source's scaled by the leg ratio while the source foot is planted, in leg lengths per second.

| Scenario | Clip | Limb error | Uncorrected | Hips ratio / leg ratio | Stance frames | Foot height error | Max slide | Mean slide |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mixamo T-pose to Unreal A-pose | walk | 0 | 45 | 1 / 1 | 69 | 0 | 0 | 0 |
| Mixamo T-pose to Unreal A-pose | wave | 0 | 45 | 1 / 1 | 238 | 0 | 0 | 0 |
| Unreal A-pose to Mixamo T-pose | walk | 0 | 45 | 1 / 1 | 69 | 0 | 0 | 0 |
| Unreal A-pose to Mixamo T-pose | wave | 0 | 45 | 1 / 1 | 238 | 0 | 0 | 0 |
| VRM T-pose legs x1.2 to Rigify bent-knee A-pose arms x0.8 | walk | 0 | 45 | 0.833 / 0.833 | 69 | 0 | 0.011 | 0.007 |
| VRM T-pose legs x1.2 to Rigify bent-knee A-pose arms x0.8 | wave | 0 | 45 | 0.833 / 0.833 | 238 | 0 | 0 | 0 |
| Unity T-pose Z-up to plain A-pose, spine x1.2, centimetres, bone axes | walk | 0.006 | 45 | 100 / 100 | 69 | 0 | 0 | 0 |
| Unity T-pose Z-up to plain A-pose, spine x1.2, centimetres, bone axes | wave | 0 | 45 | 100 / 100 | 238 | 0 | 0 | 0 |
| Scrambled names A-pose facing back to VRM T-pose legs x0.85 | walk | 0 | 45 | 0.85 / 0.85 | 69 | 0 | 0.011 | 0.008 |
| Scrambled names A-pose facing back to VRM T-pose legs x0.85 | wave | 0 | 45 | 0.85 / 0.85 | 238 | 0 | 0 | 0 |
| CesiumMan to CesiumMan with legs x1.2, arms x0.9 | clip0 | 0 | 0 | 1.2 / 1.2 | 11 | 0.001 | 0.006 | 0.002 |
| CesiumMan to Mixamo T-pose (Z-up) | clip0 | 0 | 40.4 | 1.605 / 1.605 | 11 | 0.001 | 0.021 | 0.013 |
| Mixamo A-pose walk to CesiumMan | walk | 0.007 | 29.5 | 0.623 / 0.623 | 69 | 0.003 | 0.037 | 0.026 |

Asserted bounds: limb error at most 0.02 degrees; uncorrected at least 25 degrees where rest poses differ; hip-joint height ratio within 2 % of the leg ratio; stance foot height error at most 0.01 leg lengths; slide at most 0.02 (synthetic) or 0.05 (real rigs) leg lengths per second.
<!-- humanoid-retarget:end -->

## 3. Anatomical limb solving (decision 0222)

<!-- 0222 writes this section, including its generated measurement table. -->

## 4. Composition in Mtek programs (decision 0223)

<!-- 0223 writes this section. -->
