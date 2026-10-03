# nested_struct_in_array

`struct P { a: f32 }`, `struct Nested { items: array<P, 3>; tail: vec2 }`

`P`:

- layoutStruct(P): align 4, size 4
- UAlign(P) = roundUp(16, 4) = 16, USize(P) = 4

Array metrics for `array<P, 3>`:

- UStride(P) = roundUp(16, roundUp(16, 4)) = roundUp(16, 16) = 16
- UAlign(array) = roundUp(16, 16) = 16
- USize(array) = 3 * 16 = 48
- padded: natural stride roundUp(Align(P), Size(P)) = roundUp(4, 4) = 4, not a multiple of 16, so **padded = true** (P gets wrapped in a 16-byte `MtekPad16_` struct)

`Nested`:

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| items: array<P, 3> | 16 | 48 | 0 | 0 | 48 |
| tail: vec2 | 8 | 8 | 48 | roundUp(8, 48) = 48 | 56 |

- align = max(16, 8) = 16
- size = roundUp(16, 56) = 64

The array element node records `size 4` and `align 16` (UAlign of P) with its member at relative offset 0.
Result: **size 64, align 16**.
