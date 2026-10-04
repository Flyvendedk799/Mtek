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

struct MtekParams_e2cab98b_Stage {
    u_index: i32,
    u_slot: u32,
    u_gain: f32,
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

struct MtekObject {
    model: mat4x4<f32>,
    normal_matrix: mat4x4<f32>,
}

struct MtekVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(2) world_normal: vec3<f32>,
    @location(3) uv: vec2<f32>,
}

struct MtekSurfaceInput {
    world_normal: vec3<f32>,
    uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> mtek_frame: MtekFrame;
@group(1) @binding(0) var<uniform> mtek_params: MtekParams_e2cab98b_Stage;
@group(2) @binding(0) var<uniform> mtek_object: MtekObject;

fn u_fn_e2cab98b_dimmed(u_p_light: S_e2cab98b_Light, u_p_k: i32, u_p_by: f32) -> S_e2cab98b_Light {
    var u_l_out = u_p_light;
    {
        let mtek_index_0 = clamp(u_p_k, 0i, 2i);
        u_l_out.u_weights[mtek_index_0].value = u_l_out.u_weights[mtek_index_0].value * u_p_by;
    }
    u_l_out.u_color.y = 0.5;
    u_l_out.u_active = select(0u, 1u, u_p_by > 0.0);
    return u_l_out;
}

fn mtek_fragment(u_p_surface: MtekSurfaceInput) -> vec4<f32> {
    var u_l_rig = S_e2cab98b_Rig(array<S_e2cab98b_Light, 2>(S_e2cab98b_Light(vec3<f32>(1.0, 1.0, 1.0), 1u, array<MtekPad16_f32, 3>(MtekPad16_f32(0.5), MtekPad16_f32(0.25), MtekPad16_f32(0.25))), S_e2cab98b_Light(u_p_surface.world_normal, select(0u, 1u, false), array<MtekPad16_f32, 3>(MtekPad16_f32(1.0), MtekPad16_f32(0.0), MtekPad16_f32(0.0)))), array<MtekPad16_u32, 4>(MtekPad16_u32(0u), MtekPad16_u32(0u), MtekPad16_u32(0u), MtekPad16_u32(0u)), vec2<f32>(0.0, 0.0));
    u_l_rig.u_offset = u_p_surface.uv;
    u_l_rig.u_offset.x = u_l_rig.u_offset.x + mtek_params.u_gain;
    u_l_rig.u_flags[min(mtek_params.u_slot, 3u)].value = select(0u, 1u, u_p_surface.uv.y > 0.5);
    u_l_rig.u_flags[2i].value = select(0u, 1u, true);
    u_l_rig.u_lights[clamp(mtek_params.u_index, 0i, 1i)].u_active = select(0u, 1u, (u_l_rig.u_flags[min(mtek_params.u_slot, 3u)].value != 0u));
    u_l_rig.u_lights[clamp(mtek_params.u_index, 0i, 1i)].u_weights[min(mtek_params.u_slot, 2u)].value = mtek_params.u_gain;
    {
        let mtek_index_0 = clamp(mtek_params.u_index, 0i, 1i);
        let mtek_index_1 = min(mtek_params.u_slot, 2u);
        u_l_rig.u_lights[mtek_index_0].u_weights[mtek_index_1].value = u_l_rig.u_lights[mtek_index_0].u_weights[mtek_index_1].value + 0.125;
    }
    u_l_rig.u_lights[1i].u_color.z = u_l_rig.u_lights[1i].u_color.z - mtek_params.u_gain;
    u_l_rig.u_lights[0i] = u_fn_e2cab98b_dimmed(u_l_rig.u_lights[clamp(mtek_params.u_index, 0i, 1i)], mtek_params.u_index, mtek_params.u_gain);
    var u_l_ws = array<MtekPad16_f32, 4>(MtekPad16_f32(0.0), MtekPad16_f32(0.0), MtekPad16_f32(0.0), MtekPad16_f32(0.0));
    u_l_ws[clamp(mtek_params.u_index, 0i, 3i)].value = 1.0;
    {
        let mtek_index_0 = min(mtek_params.u_slot, 3u);
        u_l_ws[mtek_index_0].value = u_l_ws[mtek_index_0].value / 2.0;
    }
    var u_l_total = (u_l_ws[0i].value + u_l_rig.u_offset.x) + u_l_rig.u_lights[0i].u_weights[1i].value;
    if (u_l_rig.u_lights[clamp(mtek_params.u_index, 0i, 1i)].u_active != 0u) && (u_l_rig.u_flags[2i].value != 0u) {
        u_l_total = u_l_total + u_l_rig.u_lights[1i].u_color.z;
    }
    return vec4<f32>(vec3<f32>(u_l_total), 1.0);
}

@vertex
fn mtek_vs(@location(0) mtek_position: vec3<f32>, @location(1) mtek_normal: vec3<f32>, @location(2) mtek_uv: vec2<f32>) -> MtekVertexOutput {
    let mtek_world = mtek_object.model * vec4<f32>(mtek_position, 1.0);
    let mtek_world_normal = normalize((mtek_object.normal_matrix * vec4<f32>(mtek_normal, 0.0)).xyz);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_world_normal, mtek_uv);
}

@fragment
fn mtek_fs(mtek_in: MtekVertexOutput) -> @location(0) vec4<f32> {
    let mtek_surface = MtekSurfaceInput(normalize(mtek_in.world_normal), mtek_in.uv);
    let mtek_color = mtek_fragment(mtek_surface);
    return vec4<f32>(mtek_color.xyz, 1.0);
}
