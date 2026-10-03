# builtin_object

`MtekObject` (spec/gpu-layout.md section 6.2): `model: mat4; normal_matrix: mat4`.

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| model: mat4 | 16 | 64 | 0 | 0 | 64 |
| normal_matrix: mat4 | 16 | 64 | 64 | 64 | 128 |

- align = 16
- size = roundUp(16, 128) = 128

Result: **size 128, align 16** (matches the specification). Record id `builtin:object`, WGSL struct `MtekObject`.
