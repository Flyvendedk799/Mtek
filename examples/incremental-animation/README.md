# Mtek animation inside an existing Three.js application

From the repository root, run `node examples/incremental-animation/serve.mjs` and open
`http://127.0.0.1:5183`. Dependencies come from the locked workspace installation.

This is an ordinary TypeScript/Three.js host. It imports only Mtek's independent
animation module: no Mtek compiler or Mtek renderer. The procedural assets are
generated locally and no network capability is needed.

Both characters blend synchronized walk/run clips with a masked upper-body action.
The blue character has relatively longer legs and shorter arms and uses the validated bind-relative retarget
workflow, including explicit bind-frame rotation transfer. Toggle oriented foot IK,
two independent oriented hand grips, skeleton inspection and distance-based pose
rates for the blue rig (15 Hz from 9 units, 8 Hz from 16). The clocks and marker queries keep advancing while
pose evaluation is throttled. The displayed p95 measures pose CPU work in this
demo; it is not a rendering benchmark or a comparison with Three.js animation.

IK uses bounded positional CCD, bind-relative knee hinges and mesh-local foot/hand
orientation targets. It can leave a residual at full extension or unreachable
targets and does not implement automatic moving-platform movement. Inspect the
bones and tune chain/target settings for a real character. The assets are procedural;
this example does not establish compatibility with an arbitrary production humanoid.

Walk/run weights preserve normalized cycle phase; pause and change the slider to
inspect the blend at one phase. Details and mounted crowd APIs are in
[decision 0196](../../spec/decisions/0196-animation-blends-and-crowds.md).
