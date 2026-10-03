struct S_P {
    a: f32,
}

struct MtekPad16_S_P {
    @size(16) value: S_P,
}

struct MtekFixture_nested_struct_in_array {
    @align(16) items: array<MtekPad16_S_P, 3>,
    tail: vec2<f32>,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_nested_struct_in_array;
