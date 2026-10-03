struct MtekFixture_mat4_and_quat {
    u_m: mat4x4<f32>,
    u_q: vec4<f32>,
    u_s: f32,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_mat4_and_quat;
