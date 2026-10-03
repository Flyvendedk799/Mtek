struct MtekPad16_vec2f {
    @size(16) value: vec2<f32>,
}

struct MtekFixture_array_vec2 {
    @align(16) items: array<MtekPad16_vec2f, 3>,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_array_vec2;
