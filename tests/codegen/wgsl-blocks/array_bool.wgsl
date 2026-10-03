struct MtekPad16_u32 {
    @size(16) value: u32,
}

struct MtekFixture_array_bool {
    @align(16) u_flags: array<MtekPad16_u32, 2>,
    u_after: u32,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_array_bool;
