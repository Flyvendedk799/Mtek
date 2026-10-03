# array_f32

`struct W { weights: array<f32, 3>; bias: f32 }` (spec/gpu-layout.md section 4.5 D).

Array metrics for `array<f32, 3>`:

- UAlign(f32) = 4, USize(f32) = 4
- UStride(f32) = roundUp(16, roundUp(4, 4)) = 16
- UAlign(array) = roundUp(16, 4) = 16
- USize(array) = 3 * 16 = 48
- padded: natural stride roundUp(Align(f32), Size(f32)) = roundUp(4, 4) = 4, not a multiple of 16, so **padded = true** (elements are wrapped in `MtekPad16_f32`)

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| weights: array<f32, 3> | 16 | 48 | 0 | roundUp(16, 0) = 0 | 48 |
| bias: f32 | 4 | 4 | 48 | roundUp(4, 48) = 48 | 52 |

- align = max(16, 4) = 16
- size = roundUp(16, 52) = 64

Result: **size 64, align 16**.
