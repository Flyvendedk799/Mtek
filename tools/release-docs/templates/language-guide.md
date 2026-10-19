# Mtek language guide (v0.1)

{{generated}}

- Status: generated from `tools/release-docs/templates/language-guide.md`; `npm run check:release` fails when this file is stale (decision 0100).
- Language version: {{language-version}}.
- Compiler: {{compiler-version-line}}.
- Every program below is a real file of this repository, copied by the generator. The compiler checks them in its own test suites, so the code on this page cannot drift from the language. The facts in the prose (counts, lists of names) are read from the compiler and the registry.

This guide is a tour. It teaches by showing programs; it does not repeat the rules. For the rules read the [language reference](language-reference.md); for what v0.1 does not do read [limitations](limitations.md); to run something first read [getting started](getting-started.md).

## 1. What a Mtek program is

A Mtek program describes one scene: its entities, its state, the shader stages of its materials and the resources they need, as one checked unit. `mtek build` turns it into JavaScript and WGSL for a runtime on browser WebGPU. The compiler has {{feature-count}} supported features, listed in Part C of the [reference](language-reference.md#part-c-features-of-this-build-{{feature-count}}).

The language has no `while`, no closures, no generics and no user-defined types other than `struct`; the full list of what is refused is in [limitations](limitations.md). The reserved words ({{reserved-count}} of them) cannot be used as names even though v0.1 does not use them.

## 2. A project

A project is a directory with an `mtek.toml` and the sources it names:

{{example examples/pulse-cube/mtek.toml}}

`entry` is the first file; `scene` is the scene the application mounts (one scene per application in v0.1). `[host.inputs]` exposes a piece of scene `state` to the page that embeds the program (section 7).

## 3. A scene

{{excerpt examples/pulse-cube/src/main.mtek :: ^scene Demo :: ^\}$}}

- `state` is mutable data of the scene.
- `camera Main { ... }` declares a camera. A scene needs exactly one active camera.
- `entity Cube { ... }` declares an entity: a mesh, a material and a transform. Fields are written `name: value;`. A descriptor such as `Box { size: ... }` builds a value of a registry schema.
- `update(dt: f32) { ... }` runs every frame. `self` is the entity.
- `on key_down(Key.Space) { ... }` is an event handler. The events of this build are {{features event:}}.

Meshes are generated from descriptors; the schemas of the category `mesh` are {{schemas mesh}}.

## 4. Types, values and functions

The types of the prelude are {{features type:}}. There is no implicit conversion between them: `f32(x)`, `i32(x)` and `u32(x)` convert explicitly. Integer arithmetic wraps and out-of-range array indices are clamped, identically on the CPU and the GPU; the rules are in the reference (sections 5 and 6 of Part A).

A function is a module item. `fn` is pure; `cpu fn` may also call the CPU-only intrinsics:

{{excerpt examples/pulse-cube/src/main.mtek :: ^fn pulse :: ^\}$}}

The intrinsic functions of this build are {{features function:}}.

## 5. Materials and shader code

A material is a typed parameter list and exactly one `fragment` function. The compiler turns the function and every pure function it calls into WGSL; nothing else is compiled to the GPU.

{{excerpt examples/pulse-cube/src/main.mtek :: ^material Pulse :: ^\}$}}

A material instance sets the parameters in the entity: `material: Pulse { tint: bind(tint); phase: bind(frame.time) };`. The lit built-in materials are {{schemas material}}; `lighting.pbr` is available in stage functions:

{{excerpt examples/material-configurator/src/materials.mtek :: ^export material Striped :: ^\}$}}

## 6. Binding

`bind(expression)` makes a field follow an expression every frame, without a handler. A value that changes at run time never creates a pipeline or a shader module: it is written into a uniform buffer (`spec/gpu-layout.md`).

{{excerpt examples/physics-playground/src/main.mtek :: ^    entity Meter :: ^    \}$}}

## 7. Host inputs

`[host.inputs]` of `mtek.toml` maps names to scene `state`. The host page sets them with `app.setInput(name, value)`; the runtime validates each value with a codec. The codecs of this build are {{codecs}}.

{{example examples/material-configurator/mtek.toml}}

## 8. Modules and prefabs

A file is a module. `export` makes an item importable; `import { A, B } from "./path.mtek";` imports by name. There are no wildcards, no aliases and no package imports.

{{example examples/modular-scene/src/theme.mtek}}

A `prefab` is a reusable entity with parameters and state. An entity can instantiate one (`entity Left: Pillar { ... }`) and a handler can create one at run time with `spawn`:

{{example examples/modular-scene/src/props/pillar.mtek}}

{{excerpt examples/modular-scene/src/main.mtek :: ^    on key_down\(Key.P\) :: ^    \}$}}

## 9. Physics

Entities with a `body` and a `collider` are simulated. Body kinds and collider shapes are registry schemas ({{schemas body}}; {{schemas collider}}); handlers command bodies with {{features body-command:}} and read {{features body-property:}}.

{{excerpt examples/physics-playground/src/main.mtek :: ^    entity Zone :: ^    \}$}}

The physics engine is a separate module that a program loads only if it uses a body. Its known limitations (no continuous collision detection) are on [limitations](limitations.md).

## 10. Assets

An asset is a compile-time dependency. `asset.glb("path")` opens a binary glTF file while the program is checked; its meshes, materials and node transforms are then read through name-checked accessors, so a misspelled name is a compile error and not a black canvas.

{{excerpt examples/material-configurator/src/model.mtek :: ^export const CHAIR :: ^export const FABRIC_ROUGHNESS}}

The glTF profile of v0.1 is strict (decision 0015): no extensions, no skinning, no animation, one material model. [Limitations](limitations.md) lists each restriction with its diagnostic.

## 11. The tools

The commands of the `mtek` executable are {{commands}}. `mtek check` needs no GPU; `mtek fmt` has one canonical layout and no options; `mtek context` prints this build's supported features for AI agents.

Every diagnostic has a stable code, a message, a span and, when the compiler can prove it, a suggested edit that is re-checked before it is offered. The ranges are in Part D of the reference.

## 12. Where to go next

- [Language reference](language-reference.md): the rules and the standard library.
- [Limitations](limitations.md): what v0.1 refuses, what it specifies but does not build, and why.
- [Coverage matrix](coverage-matrix.md): which program or fixture exercises each feature.
- [Getting started](getting-started.md): install, run, break, repair.
- [Preview hosting](preview-hosting.md): serving untrusted programs.
- [Release notes (draft)](release-notes-v0.1.md).
