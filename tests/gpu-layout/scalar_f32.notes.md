# scalar_f32

`struct ScalarF32 { value: f32 }` (spec/gpu-layout.md section 4.3; fixture list in spec/testing.md section 4.2).

| Member | UAlign | USize | cursor before | offset = roundUp(UAlign, max(cursor, minNext)) | cursor after |
|---|---|---|---|---|---|
| value: f32 | 4 | 4 | 0 | roundUp(4, 0) = 0 | 4 |

- align = max UAlign = 4
- size = roundUp(4, max(4, 4)) = 4

A block made only of 4-byte scalars is itself only 4-aligned. Result: **size 4, align 4**.
