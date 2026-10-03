struct MtekFixture_vec3 {
    u_value: vec3<f32>,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_vec3;
