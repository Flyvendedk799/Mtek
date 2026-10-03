# array_vec2

`struct V { items: array<vec2, 3> }`

Array metrics for `array<vec2, 3>`:

- UAlign(vec2) = 8, USize(vec2) = 8
- UStride(vec2) = roundUp(16, roundUp(8, 8)) = 16
- UAlign(array) = roundUp(16, 8) = 16
- USize(array) = 3 * 16 = 48
- padded: natural stride roundUp(8, 8) = 8, not a multiple of 16, so **padded = true**

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| items: array<vec2, 3> | 16 | 48 | 0 | roundUp(16, 0) = 0 | 48 |

- align = 16
- size = roundUp(16, 48) = 48

Result: **size 48, align 16**.
