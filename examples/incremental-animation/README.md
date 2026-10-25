# Mtek animation inside an existing Three.js application

From the repository root, run `node examples/incremental-animation/serve.mjs` and open
`http://127.0.0.1:5183`. Dependencies come from the locked workspace installation.

This is an ordinary TypeScript/Three.js host. It imports only Mtek's independent
animation module: no Mtek compiler or Mtek renderer. The procedural assets are
generated locally and no network capability is needed.

The green character combines a locomotion clip with a masked upper-body action.
The blue character has relatively longer legs and shorter arms and uses the validated bind-relative retarget
workflow. Toggle foot IK, two independent hand grips, skeleton inspection and a
15 Hz pose evaluation rate. The clocks and marker queries keep advancing while
pose evaluation is throttled. The displayed p95 measures pose CPU work in this
demo; it is not a rendering benchmark or a comparison with Three.js animation.

IK is bounded CCD positional solving. It can leave a residual at full extension
or unreachable targets, does not solve joint limits or orientation constraints,
and does not implement automatic moving-platform movement. Inspect the bones
and tune chain/target settings for a real character.
