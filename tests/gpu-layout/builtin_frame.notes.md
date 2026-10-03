# builtin_frame

`MtekFrame` and its element type `MtekLight` (spec/gpu-layout.md section 6.1).

`MtekLight`:

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| color: vec3 | 16 | 12 | 0 | 0 | 12 |
| kind: u32 | 4 | 4 | 12 | 12 | 16 |
| position: vec3 | 16 | 12 | 16 | 16 | 28 |
| range: f32 | 4 | 4 | 28 | 28 | 32 |
| direction: vec3 | 16 | 12 | 32 | 32 | 44 |
| reserved: f32 | 4 | 4 | 44 | 44 | 48 |

- layoutStruct(MtekLight): align 16, size roundUp(16, 48) = 48
- UAlign = 16, USize = 48, UStride = roundUp(16, roundUp(16, 48)) = 48
- array<MtekLight, 4>: size 4 * 48 = 192; natural stride roundUp(16, 48) = 48, a multiple of 16, so **padded = false**

`MtekFrame`:

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| view_proj: mat4 | 16 | 64 | 0 | 0 | 64 |
| camera_position: vec3 | 16 | 12 | 64 | 64 | 76 |
| light_count: u32 | 4 | 4 | 76 | 76 | 80 |
| ambient: vec3 | 16 | 12 | 80 | 80 | 92 |
| reserved0: f32 | 4 | 4 | 92 | 92 | 96 |
| lights: array<MtekLight, 4> | 16 | 192 | 96 | 96 | 288 |

Members of a light inside the frame are recorded relative to the element start (0, 12, 16, 28, 32, 44); light `i` starts at 96 + 48 * i.

- align = 16
- size = roundUp(16, 288) = 288

Result: **size 288, align 16** (matches the specification). Record id `builtin:frame`, WGSL struct `MtekFrame`.
