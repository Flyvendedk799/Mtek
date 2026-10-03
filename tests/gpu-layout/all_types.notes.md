# all_types

`struct AllTypes { b: bool; i: i32; u: u32; f: f32; v2: vec2; v3: vec3; v4: vec4; c: color; q: quat; m: mat4 }`

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| b: bool (`bool32`) | 4 | 4 | 0 | 0 | 4 |
| i: i32 | 4 | 4 | 4 | 4 | 8 |
| u: u32 | 4 | 4 | 8 | 8 | 12 |
| f: f32 | 4 | 4 | 12 | 12 | 16 |
| v2: vec2 | 8 | 8 | 16 | roundUp(8, 16) = 16 | 24 |
| v3: vec3 | 16 | 12 | 24 | roundUp(16, 24) = 32 | 44 |
| v4: vec4 | 16 | 16 | 44 | roundUp(16, 44) = 48 | 64 |
| c: color | 16 | 16 | 64 | 64 | 80 |
| q: quat | 16 | 16 | 80 | 80 | 96 |
| m: mat4 | 16 | 64 | 96 | 96 | 160 |

Padding bytes: 24 to 31 (before v3) and 44 to 47 (before v4).

- align = 16
- size = roundUp(16, 160) = 160

Result: **size 160, align 16**.
