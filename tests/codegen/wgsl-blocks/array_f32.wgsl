struct MtekPad16_f32 {
    @size(16) value: f32,
}

struct MtekFixture_array_f32 {
    @align(16) u_weights: array<MtekPad16_f32, 3>,
    u_bias: f32,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_array_f32;
