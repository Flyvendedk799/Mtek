struct MtekFixture_all_types {
    b: u32,
    i: i32,
    u: u32,
    f: f32,
    @size(16) v2: vec2<f32>,
    @size(16) v3: vec3<f32>,
    v4: vec4<f32>,
    c: vec4<f32>,
    q: vec4<f32>,
    m: mat4x4<f32>,
}

@group(1) @binding(0) var<uniform> mtek_params: MtekFixture_all_types;
