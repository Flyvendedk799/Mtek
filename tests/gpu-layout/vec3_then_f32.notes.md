# vec3_then_f32

`struct A { position: vec3; intensity: f32 }` (spec/gpu-layout.md section 4.5 A, blueprint 6.2).

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| position: vec3 | 16 | 12 | 0 | roundUp(16, 0) = 0 | 12 |
| intensity: f32 | 4 | 4 | 12 | roundUp(4, 12) = 12 | 16 |

The f32 fills the vec3's tail padding slot, so nothing is wasted.

- align = max(16, 4) = 16
- size = roundUp(16, max(16, 16)) = 16

Result: **size 16, align 16**.
