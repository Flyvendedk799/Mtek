struct S_P {
    u_a: f32,
}

struct MtekPad16_S_P {
    @size(16) value: S_P,
}

struct MtekFixture_nested_struct_in_array {
    @align(16) u_items: array<MtekPad16_S_P, 3>,
    u_tail: vec2<f32>,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_nested_struct_in_array;
