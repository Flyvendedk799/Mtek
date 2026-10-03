# 0002. The initial use case

- Status: Accepted
- Date: 2026-10-03
- Blueprint origin: §1.2.

## Decision

v0.1 targets browser applications where visual behaviour matters more than a surrounding web application: interactive product scenes, procedural visualisations, physics playgrounds, small 3D games. Release readiness is judged on three demonstrations that require **different combinations** of the language:

| Demonstration | Directory | Primary pressure |
|---|---|---|
| Material configurator | `examples/material-configurator/` | host inputs, typed params across the CPU/GPU boundary, custom fragment logic, textures, a static GLB |
| Physics playground | `examples/physics-playground/` | rigid bodies, colliders, impulses, sensors, collision events, single pose ownership, spawn/destroy |
| Reusable multi-file scene | `examples/modular-scene/` | modules, prefabs, parameterised reuse, cross-file diagnostics |

`examples/pulse-cube/` drives M0–M3 and does not count as a release demonstration. Distinctness is **checked**: M7 requires a coverage matrix (derived from the compiled programs' IR, not from prose) in which each demonstration exercises at least one v0.1 feature no other does, and every v0.1 feature is exercised by a demonstration or a named fixture.

## Consequences

Features serving none of these are candidates for deferral. General web-app concerns (routing, forms) are out of scope; the host API embeds a scene, nothing more.
