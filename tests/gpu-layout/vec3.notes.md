# vec3

`struct Vec3Block { value: vec3 }`

| Member | UAlign | USize | cursor before | offset | cursor after |
|---|---|---|---|---|---|
| value: vec3 | 16 | 12 | 0 | roundUp(16, 0) = 0 | 12 |

- align = 16
- size = roundUp(16, max(12, 12)) = 16

The vec3 occupies 12 bytes but forces 16-byte alignment, so the block is padded to 16 (bytes 12 to 15 are padding).
Result: **size 16, align 16**.
