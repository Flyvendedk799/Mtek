struct MtekFixture_vec3_then_f32 {
    position: vec3<f32>,
    intensity: f32,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_vec3_then_f32;
