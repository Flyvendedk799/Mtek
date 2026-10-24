# 0187. Compatible material replacement

- Status: Accepted
- Date: 2026-10-24

`Speaker.material = Unlit { color: #d03030 };` replaces the material value at
runtime. Replacement preserves the declared nominal material type and compiled
shader; swapping shader types remains a type error. The initial implementation
supports value-only materials such as Unlit and custom materials without texture
or sampler params. Resource-bearing instances continue to use individual value
parameter writes; replacing their resource bindings needs a separate design.

Replacing an instance records writes to all its parameters, so it conflicts with
any bound parameter through the existing single-writer checks. Generated code
uses `ctx.setMaterial(record, params)`, which validates every parameter before
writing through the normal parameter store, preserving shared-block copy-on-write
and alpha tracking. Material reads copy the current parameter values, so a local
saved before replacement can restore the old value without aliasing the instance.

Arcade Audio now has one Speaker entity and switches its material value between
green and red, removing duplicate geometry and visibility bindings.
