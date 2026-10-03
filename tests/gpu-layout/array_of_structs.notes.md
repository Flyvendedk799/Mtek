# array_of_structs

`struct L { color: vec3; intensity: f32 }`, `struct Lights { lights: array<L, 2>; count: u32 }`

`L`:

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| color: vec3 | 16 | 12 | 0 | 0 | 12 |
| intensity: f32 | 4 | 4 | 12 | 12 | 16 |

- layoutStruct(L): align 16, size roundUp(16, 16) = 16
- UAlign(L) = roundUp(16, 16) = 16, USize(L) = 16

Array metrics for `array<L, 2>`:

- UStride(L) = roundUp(16, roundUp(16, 16)) = 16
- UAlign(array) = roundUp(16, 16) = 16
- USize(array) = 2 * 16 = 32
- padded: natural stride roundUp(Align(L), Size(L)) = roundUp(16, 16) = 16, a multiple of 16, so **padded = false**

`Lights`:

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| lights: array<L, 2> | 16 | 32 | 0 | 0 | 32 |
| count: u32 | 4 | 4 | 32 | roundUp(4, 32) = 32 | 36 |

An array is not a struct-typed member, so the 16-byte struct rule does not apply to it (minNext = cursor).

- align = 16
- size = roundUp(16, 36) = 48

Result: **size 48, align 16**.
