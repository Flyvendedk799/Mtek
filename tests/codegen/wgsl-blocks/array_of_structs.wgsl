struct S_L {
    color: vec3<f32>,
    intensity: f32,
}

struct MtekFixture_array_of_structs {
    @align(16) lights: array<S_L, 2>,
    count: u32,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_array_of_structs;
