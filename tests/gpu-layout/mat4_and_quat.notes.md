# mat4_and_quat

`struct Mat4AndQuat { m: mat4; q: quat; s: f32 }`

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| m: mat4 | 16 | 64 | 0 | 0 | 64 |
| q: quat (vec4) | 16 | 16 | 64 | 64 | 80 |
| s: f32 | 4 | 4 | 80 | 80 | 84 |

The matrix node is `columns 4, rows 4, columnStride 16` (column-major, each column a vec4).

- align = 16
- size = roundUp(16, 84) = 96

Result: **size 96, align 16**.
