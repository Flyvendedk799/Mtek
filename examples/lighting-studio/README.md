# Lighting studio

A compiled Mtek scene hosted by a small JavaScript application: copper, ceramic
and chrome materials, a rotating caster, configurable directional shadows and a
linear HDR environment. There are no downloaded assets or external services.

From this directory:

```sh
npm run dev
```

This builds the runtime, builds the local CLI with at most two Cargo jobs, compiles
`scene/` into ignored `.out/`, and serves [the studio](http://127.0.0.1:5184/).
It uses the same content-addressed runtime module for mounting and RGBE decoding.
It also builds the separately packaged inspector for the opt-in **Scene inspector**
control; that inspector consumes extension API 1 without renderer internals.
Node and Cargo must be installed, with the repository dependencies already installed.

The controls change camera/light direction and roughness live. Shadow resolution,
environment rotation/intensity and prefilter quality rebuild the scene's lighting
resources. The default panorama is procedural; load a local Radiance `.hdr` file
to inspect another environment. Pause/resume freezes the rotating box.

Rendering options are passed to `mountMtek`, not declared in `mtek.toml`. The HDR
panorama is copied at mount and survives device recovery. Output remains LDR,
encoded once to sRGB; bright values clip, and no sky background is drawn. The
supported shadow volume, colour assumptions, input limits and quality levels are
specified in [decision 0195](../../spec/decisions/0195-shadows-and-environment-lighting.md).

The studio is a visual demonstration, not a matched-engine performance benchmark.

Enable **Scene inspector** under View & materials to select entities, edit local
transforms, undo/redo and inspect optional host counters. Toggling it rebuilds the
mount. Edits wait for the next frame; resume the application if it is paused.
Bindings can overwrite edits. The panel/controller clean up when the scene rebuilds
or the page closes. The rendered studio check now passes on Radeon and SwiftShader:
it applies a transform, exercises undo/redo, resets the mount and removes the
panel without browser errors. The browser setup serves the separately built
inspector package, matching the standalone dev server. See the
[inspector documentation](../../packages/inspector/README.md).

With the inspector enabled, **World overlays** draws the selected entity's current
world bounds and any available skeleton/IK/collider/contact diagnostics. It uses
the separate public inspector package and disposes its canvas/subscription when
disabled or rebuilt. The dedicated [inspection studio](../inspection-studio/README.md)
adds an original animated character and physics/IK controls.
