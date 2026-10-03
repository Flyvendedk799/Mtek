# array_bool

`struct Flags { flags: array<bool, 2>; after: u32 }`

A bool inside an array is stored as `u32` (`bool32`).

Array metrics for `array<bool, 2>`:

- UAlign(bool) = 4, USize(bool) = 4
- UStride(bool) = roundUp(16, roundUp(4, 4)) = 16
- UAlign(array) = roundUp(16, 4) = 16
- USize(array) = 2 * 16 = 32
- padded: natural stride roundUp(4, 4) = 4, not a multiple of 16, so **padded = true**

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| flags: array<bool, 2> | 16 | 32 | 0 | roundUp(16, 0) = 0 | 32 |
| after: u32 | 4 | 4 | 32 | roundUp(4, 32) = 32 | 36 |

- align = max(16, 4) = 16
- size = roundUp(16, 36) = 48

Result: **size 48, align 16**.
