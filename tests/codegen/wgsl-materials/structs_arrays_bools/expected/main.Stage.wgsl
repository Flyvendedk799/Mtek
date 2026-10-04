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

struct MtekPad16_f32 {
    @size(16) value: f32,
}

struct S_e2cab98b_Light {
    u_color: vec3<f32>,
    u_active: u32,
    @align(16) u_weights: array<MtekPad16_f32, 3>,
}

struct MtekPad16_u32 {
    @size(16) value: u32,
}

struct S_e2cab98b_Rig {
    @align(16) u_lights: array<S_e2cab98b_Light, 2>,
    @align(16) u_flags: array<MtekPad16_u32, 4>,
    u_offset: vec2<f32>,
}

struct MtekParams_e2cab98b_Stage {
    @align(16) u_rig: S_e2cab98b_Rig,
    @align(16) u_mask: array<MtekPad16_u32, 4>,
    u_index: i32,
    u_slot: u32,
    u_enabled: u32,
}

struct MtekObject {
    model: mat4x4<f32>,
    normal_matrix: mat4x4<f32>,
}

struct MtekVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(2) world_normal: vec3<f32>,
}

struct MtekSurfaceInput {
    world_normal: vec3<f32>,
}

@group(0) @binding(0) var<uniform> mtek_frame: MtekFrame;
@group(1) @binding(0) var<uniform> mtek_params: MtekParams_e2cab98b_Stage;
@group(2) @binding(0) var<uniform> mtek_object: MtekObject;

fn u_fn_e2cab98b_pick(u_p_flags: array<MtekPad16_u32, 4>, u_p_i: u32) -> bool {
    return (u_p_flags[min(u_p_i, 3u)].value != 0u);
}

fn u_fn_e2cab98b_brightness(u_p_light: S_e2cab98b_Light, u_p_k: i32) -> f32 {
    if !(u_p_light.u_active != 0u) {
        return 0.0;
    }
    return u_p_light.u_weights[clamp(u_p_k, 0i, 2i)].value * length(u_p_light.u_color);
}

fn mtek_fragment(u_p_surface: MtekSurfaceInput) -> vec4<f32> {
    let u_l_local = S_e2cab98b_Light(u_p_surface.world_normal, select(0u, 1u, (mtek_params.u_enabled != 0u) && u_fn_e2cab98b_pick(mtek_params.u_mask, mtek_params.u_slot)), array<MtekPad16_f32, 3>(MtekPad16_f32(0.25), MtekPad16_f32(0.5), MtekPad16_f32(0.25)));
    let u_l_lit = array<S_e2cab98b_Light, 2>(mtek_params.u_rig.u_lights[0i], u_l_local);
    var u_l_total = u_fn_e2cab98b_brightness(u_l_lit[clamp(mtek_params.u_index, 0i, 1i)], mtek_params.u_index) + u_fn_e2cab98b_brightness(mtek_params.u_rig.u_lights[clamp(mtek_params.u_index, 0i, 1i)], 2i);
    if (mtek_params.u_rig.u_flags[min(mtek_params.u_slot, 3u)].value != 0u) && (mtek_params.u_mask[3i].value != 0u) {
        u_l_total = u_l_total + mtek_params.u_rig.u_offset.x;
    }
    let u_l_w = u_l_local.u_weights;
    u_l_total = u_l_total * u_l_w[min(mtek_params.u_slot, 2u)].value;
    return vec4<f32>(vec3<f32>(u_l_total), 1.0);
}

@vertex
fn mtek_vs(@location(0) mtek_position: vec3<f32>, @location(1) mtek_normal: vec3<f32>) -> MtekVertexOutput {
    let mtek_world = mtek_object.model * vec4<f32>(mtek_position, 1.0);
    let mtek_world_normal = normalize((mtek_object.normal_matrix * vec4<f32>(mtek_normal, 0.0)).xyz);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_world_normal);
}

@fragment
fn mtek_fs(mtek_in: MtekVertexOutput) -> @location(0) vec4<f32> {
    let mtek_surface = MtekSurfaceInput(normalize(mtek_in.world_normal));
    let mtek_color = mtek_fragment(mtek_surface);
    return vec4<f32>(mtek_color.xyz, 1.0);
}
