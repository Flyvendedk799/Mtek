# mixed

`struct Mixed { a: f32; b: vec3; c: u32; d: vec2; e: bool; f: color }` (spec/gpu-layout.md section 4.5 B).

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| a: f32 | 4 | 4 | 0 | roundUp(4, 0) = 0 | 4 |
| b: vec3 | 16 | 12 | 4 | roundUp(16, 4) = 16 | 28 |
| c: u32 | 4 | 4 | 28 | roundUp(4, 28) = 28 | 32 |
| d: vec2 | 8 | 8 | 32 | roundUp(8, 32) = 32 | 40 |
| e: bool (stored as u32, `bool32`) | 4 | 4 | 40 | roundUp(4, 40) = 40 | 44 |
| f: color (vec4) | 16 | 16 | 44 | roundUp(16, 44) = 48 | 64 |

Padding bytes: 4 to 15 (before b) and 44 to 47 (before f).

- align = max(4, 16, 4, 8, 4, 16) = 16
- size = roundUp(16, max(64, 64)) = 64

Result: **size 64, align 16**.
