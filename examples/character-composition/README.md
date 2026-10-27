# Character composition workshop

Run from the repository root after `npm install` and the normal runtime/CLI build:

```powershell
node examples/character-composition/serve.mjs
```

Open <http://127.0.0.1:5189/>. Preparation uses the real compiler, the public
`retargetSkin` API and the separately packaged inspector. The example's host uses
public animation/extension APIs; Three.js supplies matrix math, without a renderer.
Generated GLBs, compiled packages and the browser bundle are ignored outputs.

The original CesiumMan and a generated compatible variant combine:

- Synchronized Idle/Walk/Run locomotion and interruptible clip transitions.
- A masked upper-body action in override or additive mode, an additive neck
  motion and a procedural neck adjustment.
- Explicit rig adaptation: a bounded pelvis crouch, positive knee hinge limits,
  planted world-space feet, rigid toe effectors and a 12 cm swing lift. The left
  foot follows the 15 cm raised track; the right follows the floor.
- Two hands constrained to the opposite ends of each carried prop, with
  orientation targets in the mesh frame.
- Optional extracted root travel owned by the host. A separate `MotionRoot`
  trajectory node leaves the pelvis free to adapt. The host also owns the props.
- Authored position/normal/UV/payload deformation, finite bounds, directional
  shadows and optional world-space skeleton/IK overlays.

Use the sliders and constraint toggles to isolate each contribution. Run/Idle
interrupt the current base motion; Resume locomotion reselects the blend.
Host-owned travel selects the generated Travel clip. To return to that trajectory
after an interruption, turn Host-owned travel off and on. Reset recreates the
application at its original positions while retaining the current controls.
Pause/Resume controls the whole application. The inspector's transform edits can
be overwritten by the host on the next frame, as indicated by the panel.

## Content, mapping and operating bounds

This is **one original production asset and a generated compatible proportion
variant**, not two unrelated artist-authored humanoids. Original provenance is
in [`assets/provenance.json`](../../benchmarks/runtime/animation/assets/provenance.json).
The original file remains unchanged, with SHA-256
`b7001eaeea8254bd44773bcd247e78696d94169388fbb2a1800fc69434e777d9`.

Walk keeps the original channels, keys and texture bytes. Idle holds the first
keys; Run shortens their times; Travel adds a linear trajectory; UpperAction and
Nod are generated demonstration rotations. These additional motions are labelled
as derivatives. The proportion variant lengthens the named leg segments by 20%,
shortens the mapped arm segments by 10%, lifts the pelvis by 0.108 model units,
rebinds the geometry/inverse bind matrices, and retargets every clip through the
public API. It retains the original topology, weights, joint axes and texture.
The generated derivation record lists every mapping and translation multiplier.

The controller explicitly names this hierarchy; it is an example of authoring a
compatible-rig workflow, not automatic humanoid recognition or general terrain
adaptation. Knee seeds, foot geometry profiles, a crouch cap of 0.18 model units,
the track, prop dimensions and travel prediction are deliberately specific to this
scene. Foot profiles use the original weighted geometry to calibrate ankle-to-sole
offsets. The endpoint and actual deformed foot vertices are checked separately.
The affine material stretch is also inverted when converting world-space targets.
The fixed stage and straight trajectory are suitable for the demonstrated short
sequence; this example does not add navigation, ground queries or an infinite track.

Device recovery retains the CPU world and preserves both steady compositions and
unfinished crossfades at the same clock time. The controller also demonstrates
explicit host-state capture/restore for a newly created player: steady modes are
checked, while restoring an unfinished fade to a new player resumes at its target
clip/time because the public diagnostic snapshot does not serialize its source
pose. That separate fallback does not claim seamless transition reconstruction.

Imported positive scales with bounded float32 round-off can participate in
orientation/retarget frames under [decision 0209](../../spec/decisions/0209-skeletal-scale-round-off.md).
Their actual values remain unchanged; genuinely nonuniform frames remain rejected.

## Verification

After building the runtime and CLI, run these commands serially. Each refuses to
overwrite its result file; choose a fresh output directory for each new run.

```powershell
node examples/character-composition/verify-assets.mjs .out/composition-assets
node examples/character-composition/verify-cpu.mjs .out/composition-cpu
node examples/character-composition/verify-gpu.mjs hardware .out/composition-hardware
node examples/character-composition/verify-gpu.mjs software .out/composition-software
npx tsc --noEmit -p examples/character-composition/tsconfig.json
```

The CPU matrix covers both proportions, override/additive action, root ownership
on/off and 30/60/144 fps plus uneven deltas: 32 six-second cases, phase markers,
four steady-mode restorations and two interrupted fades. Fixed limits are 2 mm
for actual endpoint error, 0.1 mrad for orientation and 3 mm for deformed foot
geometry relative to its planned surface/lift. Root extraction has an independent
analytic distance check. These are correctness gates, not performance timings.
The numeric matrix uses the default speed/action/neck controls with both foot
and grip constraints enabled. Other slider endpoints and constraint toggles have
UI smoke coverage; the matrix does not claim every possible control combination.

Each GPU backend compares five composed poses/shadows against independently
CPU-skinned, affine-deformed geometry using a fragment-only compiled material.
No GPU output is read to construct reference geometry. The fixed pixel gate is
two channel values with zero pixels beyond it. Visible controls, partial-fade and
steady recovery, repeated resets, native canvas screenshots and zero retained
tracked resources are also checked. Software rendering on the same PC is a second
backend, not another physical-device tier. Reports hash sources and actual served
artifacts. Earlier animation benchmark assets and workload definitions are frozen.

## Attribution

Cesium Man is by Cesium, provided through Khronos glTF Sample Assets at commit
`8f492390ddc7a2ae221a1369ef560589cf8c70fb`. Model content and these generated
content derivatives use CC BY 4.0; see the original
[model licence](../../benchmarks/runtime/animation/assets/CesiumMan/LICENSE.md)
and [full licence text](../../benchmarks/runtime/animation/assets/licenses/CC-BY-4.0.txt).
Cesium marks remain subject to the original
[trademark terms](../../benchmarks/runtime/animation/assets/licenses/LicenseRef-LegalMark-Cesium.txt).
The changes are the generated clips, trajectory helper, proportions, rebind and
retargeting described above. No additional artist-authored motion is implied.
