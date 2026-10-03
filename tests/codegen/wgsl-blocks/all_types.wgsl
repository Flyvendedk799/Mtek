struct MtekFixture_all_types {
    u_b: u32,
    u_i: i32,
    u_u: u32,
    u_f: f32,
    @size(16) u_v2: vec2<f32>,
    @size(16) u_v3: vec3<f32>,
    u_v4: vec4<f32>,
    u_c: vec4<f32>,
    u_q: vec4<f32>,
    u_m: mat4x4<f32>,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_all_types;
