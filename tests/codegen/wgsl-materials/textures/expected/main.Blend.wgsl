struct MtekLight {
    color: vec3<f32>,
    kind: u32,
    position: vec3<f32>,
    range: f32,
    direction: vec3<f32>,
    reserved: f32,
}

struct MtekFrame {
    view_proj: mat4x4<f32>,
    camera_position: vec3<f32>,
    light_count: u32,
    ambient: vec3<f32>,
    reserved0: f32,
    @align(16) lights: array<MtekLight, 4>,
}

struct MtekParams_e2cab98b_Blend {
    @size(8) u_strength: f32,
    u_offset: vec2<f32>,
}

struct MtekObject {
    model: mat4x4<f32>,
    normal_matrix: mat4x4<f32>,
}

struct MtekVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(3) uv: vec2<f32>,
}

struct MtekSurfaceInput {
    uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> mtek_frame: MtekFrame;
@group(1) @binding(0) var<uniform> mtek_params: MtekParams_e2cab98b_Blend;
@group(1) @binding(1) var mtek_texture_base: texture_2d<f32>;
@group(1) @binding(2) var mtek_sampler_filter: sampler;
@group(1) @binding(3) var mtek_texture_overlay: texture_2d<f32>;
@group(1) @binding(4) var mtek_sampler_flat: sampler;
@group(2) @binding(0) var<uniform> mtek_object: MtekObject;

fn u_fn_e2cab98b_tint_of(u_p_texel: vec4<f32>, u_p_strength: f32) -> vec3<f32> {
    return u_p_texel.xyz * u_p_strength;
}

fn mtek_fragment(u_p_input: MtekSurfaceInput) -> vec4<f32> {
    var u_l_sum = vec3<f32>(0.0, 0.0, 0.0);
    if u_p_input.uv.x > mtek_params.u_offset.x {
        u_l_sum = u_l_sum + u_fn_e2cab98b_tint_of(textureSampleLevel(mtek_texture_overlay, mtek_sampler_flat, u_p_input.uv - mtek_params.u_offset, 0.0), mtek_params.u_strength);
    }
    for (var u_l_i = 0i; u_l_i < 3i; u_l_i++) {
        u_l_sum = u_l_sum + (textureSampleLevel(mtek_texture_base, mtek_sampler_filter, u_p_input.uv * f32(u_l_i + 1i), 0.0).xyz * 0.25);
    }
    return vec4<f32>(u_l_sum, 1.0);
}

@vertex
fn mtek_vs(@location(0) mtek_position: vec3<f32>, @location(2) mtek_uv: vec2<f32>) -> MtekVertexOutput {
    let mtek_world = mtek_object.model * vec4<f32>(mtek_position, 1.0);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_uv);
}

@vertex
fn mtek_vs_instanced(@location(0) mtek_position: vec3<f32>, @location(2) mtek_uv: vec2<f32>, @location(3) mtek_model_c0: vec4<f32>, @location(4) mtek_model_c1: vec4<f32>, @location(5) mtek_model_c2: vec4<f32>, @location(6) mtek_model_c3: vec4<f32>, @location(7) mtek_normal_c0: vec4<f32>, @location(8) mtek_normal_c1: vec4<f32>, @location(9) mtek_normal_c2: vec4<f32>, @location(10) mtek_normal_c3: vec4<f32>) -> MtekVertexOutput {
    let mtek_world = mat4x4<f32>(mtek_model_c0, mtek_model_c1, mtek_model_c2, mtek_model_c3) * vec4<f32>(mtek_position, 1.0);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_uv);
}

@fragment
fn mtek_fs(mtek_in: MtekVertexOutput) -> @location(0) vec4<f32> {
    let mtek_surface = MtekSurfaceInput(mtek_in.uv);
    let mtek_color = mtek_fragment(mtek_surface);
    return vec4<f32>(mtek_color.xyz, 1.0);
}
