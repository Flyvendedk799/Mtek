struct S_L {
    u_color: vec3<f32>,
    u_intensity: f32,
}

struct MtekFixture_array_of_structs {
    @align(16) u_lights: array<S_L, 2>,
    u_count: u32,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_array_of_structs;
