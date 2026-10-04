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

struct MtekParams_e2cab98b_Spin {
    @size(16) u_angle: f32,
    @size(16) u_axis: vec3<f32>,
    u_base: vec4<f32>,
    u_tilt: vec3<f32>,
}

struct MtekObject {
    model: mat4x4<f32>,
    normal_matrix: mat4x4<f32>,
}

struct MtekVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) local_position: vec3<f32>,
    @location(2) world_normal: vec3<f32>,
}

struct MtekSurfaceInput {
    local_position: vec3<f32>,
    world_normal: vec3<f32>,
}

@group(0) @binding(0) var<uniform> mtek_frame: MtekFrame;
@group(1) @binding(0) var<uniform> mtek_params: MtekParams_e2cab98b_Spin;
@group(2) @binding(0) var<uniform> mtek_object: MtekObject;

fn mtek_srgb_channel(mtek_c: f32) -> f32 {
    if mtek_c <= 0.04045 {
        return mtek_c / 12.92;
    }
    return pow((mtek_c + 0.055) / 1.055, 2.4);
}

fn mtek_color_srgb(mtek_rgb: vec3<f32>, mtek_a: f32) -> vec4<f32> {
    return vec4<f32>(mtek_srgb_channel(mtek_rgb.x), mtek_srgb_channel(mtek_rgb.y), mtek_srgb_channel(mtek_rgb.z), mtek_a);
}

fn mtek_quat_mul(mtek_a: vec4<f32>, mtek_b: vec4<f32>) -> vec4<f32> {
    return vec4<f32>((((mtek_a.w * mtek_b.x) + (mtek_a.x * mtek_b.w)) + (mtek_a.y * mtek_b.z)) - (mtek_a.z * mtek_b.y), (((mtek_a.w * mtek_b.y) - (mtek_a.x * mtek_b.z)) + (mtek_a.y * mtek_b.w)) + (mtek_a.z * mtek_b.x), (((mtek_a.w * mtek_b.z) + (mtek_a.x * mtek_b.y)) - (mtek_a.y * mtek_b.x)) + (mtek_a.z * mtek_b.w), (((mtek_a.w * mtek_b.w) - (mtek_a.x * mtek_b.x)) - (mtek_a.y * mtek_b.y)) - (mtek_a.z * mtek_b.z));
}

fn mtek_quat_rotate(mtek_q: vec4<f32>, mtek_v: vec3<f32>) -> vec3<f32> {
    let mtek_t = 2.0 * cross(mtek_q.xyz, mtek_v);
    return (mtek_v + (mtek_q.w * mtek_t)) + cross(mtek_q.xyz, mtek_t);
}

fn mtek_quat_axis_angle(mtek_axis: vec3<f32>, mtek_angle: f32) -> vec4<f32> {
    let mtek_largest = max(max(abs(mtek_axis.x), abs(mtek_axis.y)), abs(mtek_axis.z));
    if mtek_largest == 0.0 {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    let mtek_scaled = mtek_axis / mtek_largest;
    let mtek_unit = mtek_scaled / sqrt(((mtek_scaled.x * mtek_scaled.x) + (mtek_scaled.y * mtek_scaled.y)) + (mtek_scaled.z * mtek_scaled.z));
    let mtek_half = mtek_angle * 0.5;
    return vec4<f32>(mtek_unit * sin(mtek_half), cos(mtek_half));
}

fn mtek_quat_euler(mtek_x: f32, mtek_y: f32, mtek_z: f32) -> vec4<f32> {
    return mtek_quat_mul(mtek_quat_mul(mtek_quat_axis_angle(vec3<f32>(0.0, 1.0, 0.0), mtek_y), mtek_quat_axis_angle(vec3<f32>(1.0, 0.0, 0.0), mtek_x)), mtek_quat_axis_angle(vec3<f32>(0.0, 0.0, 1.0), mtek_z));
}

fn mtek_mat4_translation(mtek_v: vec3<f32>) -> mat4x4<f32> {
    return mat4x4<f32>(vec4<f32>(1.0, 0.0, 0.0, 0.0), vec4<f32>(0.0, 1.0, 0.0, 0.0), vec4<f32>(0.0, 0.0, 1.0, 0.0), vec4<f32>(mtek_v, 1.0));
}

fn mtek_mat4_scale(mtek_v: vec3<f32>) -> mat4x4<f32> {
    return mat4x4<f32>(vec4<f32>(mtek_v.x, 0.0, 0.0, 0.0), vec4<f32>(0.0, mtek_v.y, 0.0, 0.0), vec4<f32>(0.0, 0.0, mtek_v.z, 0.0), vec4<f32>(0.0, 0.0, 0.0, 1.0));
}

fn mtek_mat4_rotation(mtek_q: vec4<f32>) -> mat4x4<f32> {
    let mtek_xx = mtek_q.x * mtek_q.x;
    let mtek_yy = mtek_q.y * mtek_q.y;
    let mtek_zz = mtek_q.z * mtek_q.z;
    let mtek_xy = mtek_q.x * mtek_q.y;
    let mtek_xz = mtek_q.x * mtek_q.z;
    let mtek_yz = mtek_q.y * mtek_q.z;
    let mtek_wx = mtek_q.w * mtek_q.x;
    let mtek_wy = mtek_q.w * mtek_q.y;
    let mtek_wz = mtek_q.w * mtek_q.z;
    return mat4x4<f32>(vec4<f32>(1.0 - (2.0 * (mtek_yy + mtek_zz)), 2.0 * (mtek_xy + mtek_wz), 2.0 * (mtek_xz - mtek_wy), 0.0), vec4<f32>(2.0 * (mtek_xy - mtek_wz), 1.0 - (2.0 * (mtek_xx + mtek_zz)), 2.0 * (mtek_yz + mtek_wx), 0.0), vec4<f32>(2.0 * (mtek_xz + mtek_wy), 2.0 * (mtek_yz - mtek_wx), 1.0 - (2.0 * (mtek_xx + mtek_yy)), 0.0), vec4<f32>(0.0, 0.0, 0.0, 1.0));
}

fn u_fn_e2cab98b_spin(u_p_q: vec4<f32>, u_p_v: vec3<f32>) -> vec3<f32> {
    return mtek_quat_rotate(u_p_q, u_p_v);
}

fn mtek_fragment(u_p_surface: MtekSurfaceInput) -> vec4<f32> {
    let u_l_q = mtek_quat_mul(mtek_quat_axis_angle(mtek_params.u_axis, mtek_params.u_angle), mtek_params.u_base);
    let u_l_e = mtek_quat_euler(mtek_params.u_tilt.x, mtek_params.u_tilt.y, mtek_params.u_tilt.z);
    let u_l_n = u_fn_e2cab98b_spin(mtek_quat_mul(u_l_q, u_l_e), u_p_surface.world_normal);
    let u_l_m = (mtek_mat4_rotation(u_l_q) * mtek_mat4_translation(mtek_params.u_tilt)) * mtek_mat4_scale(vec3<f32>(mtek_params.u_angle));
    let u_l_p = (u_l_m * vec4<f32>(u_p_surface.local_position, 1.0)).xyz;
    let u_l_c = mtek_color_srgb((abs(u_l_n) * 0.5) + (u_l_p * 0.1), 1.0);
    return vec4<f32>(u_l_c.xyz * u_l_q.w, 1.0);
}

@vertex
fn mtek_vs(@location(0) mtek_position: vec3<f32>, @location(1) mtek_normal: vec3<f32>) -> MtekVertexOutput {
    let mtek_world = mtek_object.model * vec4<f32>(mtek_position, 1.0);
    let mtek_world_normal = normalize((mtek_object.normal_matrix * vec4<f32>(mtek_normal, 0.0)).xyz);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_position, mtek_world_normal);
}

@fragment
fn mtek_fs(mtek_in: MtekVertexOutput) -> @location(0) vec4<f32> {
    let mtek_surface = MtekSurfaceInput(mtek_in.local_position, normalize(mtek_in.world_normal));
    let mtek_color = mtek_fragment(mtek_surface);
    return vec4<f32>(mtek_color.xyz, 1.0);
}
