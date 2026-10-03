# struct_then_scalar

`struct Inner { k: f32 }`, `struct Outer { inner: Inner; after: f32 }` (spec/gpu-layout.md section 4.5 C).

`Inner` on its own:

| Member | UAlign | USize | offset |
|---|---|---|---|
| k: f32 | 4 | 4 | 0 |

- layoutStruct(Inner): align 4, size roundUp(4, 4) = 4
- UAlign(Inner) = roundUp(16, 4) = 16, USize(Inner) = 4

`Outer`:

| Member | UAlign | USize | cursor before | minNext before | offset | cursor after | minNext after |
|---|---|---|---|---|---|---|---|
| inner: Inner | 16 | 4 | 0 | 0 | roundUp(16, max(0, 0)) = 0 | 4 | 0 + roundUp(16, 4) = 16 (struct-typed member rule) |
| after: f32 | 4 | 4 | 4 | 16 | roundUp(4, max(4, 16)) = 16 | 20 | 20 |

- align = max(16, 4) = 16
- size = roundUp(16, max(20, 20)) = 32

Without the struct rule `after` would sit at 4, which WGSL rejects in the uniform address space. Result: **size 32, align 16**.
The nested `inner` node records `size 4` and `align 16` (its UAlign).
