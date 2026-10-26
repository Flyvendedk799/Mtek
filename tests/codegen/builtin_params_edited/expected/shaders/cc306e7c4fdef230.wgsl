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
    exposure: f32,
    @align(16) lights: array<MtekLight, 4>,
}

struct MtekParams_2b212d15_Pbr {
    u_base_color: vec4<f32>,
    u_metallic: f32,
    u_roughness: f32,
    u_normal_scale: f32,
    u_occlusion_strength: f32,
    u_emissive: vec4<f32>,
}

struct MtekSceneLighting {
    shadow_matrix: mat4x4<f32>,
    shadow_params: vec4<f32>,
    shadow_filter: vec4<f32>,
    environment: vec4<f32>,
    sh: array<vec4<f32>, 9>,
}

struct MtekObject {
    model: mat4x4<f32>,
    normal_matrix: mat4x4<f32>,
}

struct MtekVertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(1) world_position: vec3<f32>,
    @location(2) world_normal: vec3<f32>,
    @location(3) uv: vec2<f32>,
}

struct MtekSurfaceInput {
    world_position: vec3<f32>,
    world_normal: vec3<f32>,
    uv: vec2<f32>,
}

@group(0) @binding(0) var<uniform> mtek_frame: MtekFrame;
@group(1) @binding(0) var<uniform> mtek_params: MtekParams_2b212d15_Pbr;
@group(1) @binding(1) var mtek_texture_base_color_texture: texture_2d<f32>;
@group(1) @binding(2) var mtek_sampler_base_color_sampler: sampler;
@group(1) @binding(3) var mtek_texture_metallic_roughness_texture: texture_2d<f32>;
@group(1) @binding(4) var mtek_sampler_metallic_roughness_sampler: sampler;
@group(1) @binding(5) var mtek_texture_normal_texture: texture_2d<f32>;
@group(1) @binding(6) var mtek_sampler_normal_sampler: sampler;
@group(1) @binding(7) var mtek_texture_occlusion_texture: texture_2d<f32>;
@group(1) @binding(8) var mtek_sampler_occlusion_sampler: sampler;
@group(1) @binding(9) var mtek_texture_emissive_texture: texture_2d<f32>;
@group(1) @binding(10) var mtek_sampler_emissive_sampler: sampler;
@group(3) @binding(0) var<uniform> mtek_scene_lighting: MtekSceneLighting;
@group(3) @binding(1) var mtek_shadow_map: texture_depth_2d;
@group(3) @binding(2) var mtek_shadow_sampler: sampler_comparison;
@group(3) @binding(3) var mtek_environment_map: texture_cube<f32>;
@group(3) @binding(4) var mtek_environment_sampler: sampler;
@group(3) @binding(5) var mtek_environment_brdf: texture_2d<f32>;
@group(2) @binding(0) var<uniform> mtek_object: MtekObject;

fn mtek_shadow_visibility(mtek_position: vec3<f32>, mtek_normal: vec3<f32>, mtek_light_index: u32) -> f32 {
    if mtek_scene_lighting.shadow_params.x != f32(mtek_light_index + 1u) {
        return 1.0;
    }
    let mtek_shadow_clip = mtek_scene_lighting.shadow_matrix * vec4<f32>(mtek_position + (mtek_normal * mtek_scene_lighting.shadow_params.z), 1.0);
    let mtek_shadow_ndc = mtek_shadow_clip.xyz / mtek_shadow_clip.w;
    let mtek_shadow_uv = vec2<f32>((mtek_shadow_ndc.x * 0.5) + 0.5, (mtek_shadow_ndc.y * (-0.5)) + 0.5);
    if (mtek_shadow_uv.x < 0.0) || (mtek_shadow_uv.x > 1.0) {
        return 1.0;
    }
    if (mtek_shadow_uv.y < 0.0) || (mtek_shadow_uv.y > 1.0) {
        return 1.0;
    }
    if (mtek_shadow_ndc.z < 0.0) || (mtek_shadow_ndc.z > 1.0) {
        return 1.0;
    }
    var mtek_shadow_sum = 0.0;
    var mtek_shadow_count = 0.0;
    for (var mtek_shadow_y = 0u; mtek_shadow_y < 5u; mtek_shadow_y++) {
        for (var mtek_shadow_x = 0u; mtek_shadow_x < 5u; mtek_shadow_x++) {
            if mtek_scene_lighting.shadow_filter.y >= max(abs(f32(mtek_shadow_x) - 2.0), abs(f32(mtek_shadow_y) - 2.0)) {
                mtek_shadow_sum = mtek_shadow_sum + textureSampleCompareLevel(mtek_shadow_map, mtek_shadow_sampler, mtek_shadow_uv + (vec2<f32>(f32(mtek_shadow_x) - 2.0, f32(mtek_shadow_y) - 2.0) * mtek_scene_lighting.shadow_filter.x), mtek_shadow_ndc.z - mtek_scene_lighting.shadow_params.y);
                mtek_shadow_count = mtek_shadow_count + 1.0;
            }
        }
    }
    return mtek_shadow_sum / mtek_shadow_count;
}

fn mtek_environment_light(mtek_n: vec3<f32>, mtek_v: vec3<f32>, mtek_c: vec3<f32>, mtek_m: f32, mtek_r: f32, mtek_f0: vec3<f32>, mtek_nv: f32) -> vec3<f32> {
    if mtek_scene_lighting.environment.x <= 0.0 {
        return vec3<f32>(0.0);
    }
    let mtek_environment_n = vec3<f32>((mtek_scene_lighting.environment.y * mtek_n.x) + (mtek_scene_lighting.environment.z * mtek_n.z), mtek_n.y, (mtek_scene_lighting.environment.y * mtek_n.z) - (mtek_scene_lighting.environment.z * mtek_n.x));
    let mtek_environment_r = vec3<f32>((mtek_scene_lighting.environment.y * reflect(-mtek_v, mtek_n).x) + (mtek_scene_lighting.environment.z * reflect(-mtek_v, mtek_n).z), reflect(-mtek_v, mtek_n).y, (mtek_scene_lighting.environment.y * reflect(-mtek_v, mtek_n).z) - (mtek_scene_lighting.environment.z * reflect(-mtek_v, mtek_n).x));
    let mtek_irradiance = max(((((((((vec3<f32>(0.0) + (mtek_scene_lighting.sh[0u].xyz * 0.282095)) + (mtek_scene_lighting.sh[1u].xyz * (0.488603 * mtek_environment_n.y))) + (mtek_scene_lighting.sh[2u].xyz * (0.488603 * mtek_environment_n.z))) + (mtek_scene_lighting.sh[3u].xyz * (0.488603 * mtek_environment_n.x))) + (mtek_scene_lighting.sh[4u].xyz * (1.092548 * (mtek_environment_n.x * mtek_environment_n.y)))) + (mtek_scene_lighting.sh[5u].xyz * (1.092548 * (mtek_environment_n.y * mtek_environment_n.z)))) + (mtek_scene_lighting.sh[6u].xyz * (0.315392 * ((3.0 * (mtek_environment_n.z * mtek_environment_n.z)) - 1.0)))) + (mtek_scene_lighting.sh[7u].xyz * (1.092548 * (mtek_environment_n.x * mtek_environment_n.z)))) + (mtek_scene_lighting.sh[8u].xyz * (0.546274 * ((mtek_environment_n.x * mtek_environment_n.x) - (mtek_environment_n.y * mtek_environment_n.y)))), vec3<f32>(0.0));
    let mtek_environment_texel = textureSampleLevel(mtek_environment_map, mtek_environment_sampler, mtek_environment_r, mtek_r * mtek_scene_lighting.environment.w).xyz;
    let mtek_brdf = textureSampleLevel(mtek_environment_brdf, mtek_environment_sampler, vec2<f32>(mtek_nv, mtek_r), 0.0);
    let mtek_fresnel_power = pow(max(1.0 - mtek_nv, 0.0), 5.0);
    let mtek_environment_fresnel = mtek_f0 + ((max(vec3<f32>(1.0 - mtek_r), mtek_f0) - mtek_f0) * mtek_fresnel_power);
    let mtek_environment_diffuse = (((vec3<f32>(1.0) - mtek_environment_fresnel) * mtek_c) * (1.0 - mtek_m)) * mtek_irradiance;
    let mtek_environment_specular = mtek_environment_texel * ((mtek_f0 * mtek_brdf.x) + vec3<f32>(mtek_brdf.y));
    return (mtek_environment_diffuse + mtek_environment_specular) * mtek_scene_lighting.environment.x;
}

fn mtek_mapped_normal(mtek_surface: MtekSurfaceInput, mtek_texel: vec3<f32>, mtek_scale: f32) -> vec3<f32> {
    let mtek_n = mtek_surface.world_normal;
    let mtek_q0 = dpdx(mtek_surface.world_position);
    let mtek_q1 = dpdy(mtek_surface.world_position);
    let mtek_st0 = dpdx(mtek_surface.uv);
    let mtek_st1 = dpdy(mtek_surface.uv);
    let mtek_q1perp = cross(mtek_q1, mtek_n);
    let mtek_q0perp = cross(mtek_n, mtek_q0);
    let mtek_t = (mtek_q1perp * mtek_st0.x) + (mtek_q0perp * mtek_st1.x);
    let mtek_b = (mtek_q1perp * mtek_st0.y) + (mtek_q0perp * mtek_st1.y);
    let mtek_area2 = max(dot(mtek_t, mtek_t), dot(mtek_b, mtek_b));
    let mtek_inv = sign(dot(cross(mtek_q0, mtek_q1), mtek_n)) * inverseSqrt(max(mtek_area2, 1e-20));
    let mtek_map = (mtek_texel * 2.0) - vec3<f32>(1.0);
    let mtek_result = (((mtek_t * mtek_map.x) + (mtek_b * mtek_map.y)) * (mtek_scale * mtek_inv)) + (mtek_n * mtek_map.z);
    let mtek_len2 = dot(mtek_result, mtek_result);
    return select(mtek_n, mtek_result * inverseSqrt(max(mtek_len2, 1e-20)), (mtek_len2 > 1e-16) && (mtek_area2 > 1e-20));
}

fn mtek_lighting_pbr_mapped(mtek_surface: MtekSurfaceInput, mtek_base_color: vec4<f32>, mtek_metallic: f32, mtek_roughness: f32, mtek_normal_texel: vec3<f32>, mtek_normal_scale: f32, mtek_occlusion: f32, mtek_emissive: vec3<f32>) -> vec4<f32> {
    let mtek_c = mtek_base_color.xyz;
    let mtek_r = clamp(mtek_roughness, 0.045, 1.0);
    let mtek_alpha = mtek_r * mtek_r;
    let mtek_a2 = mtek_alpha * mtek_alpha;
    let mtek_m = clamp(mtek_metallic, 0.0, 1.0);
    let mtek_f0 = (vec3<f32>(0.04) * (1.0 - mtek_m)) + (mtek_c * mtek_m);
    let mtek_n = mtek_mapped_normal(mtek_surface, mtek_normal_texel, mtek_normal_scale);
    let mtek_v = normalize(mtek_frame.camera_position - mtek_surface.world_position);
    let mtek_nv = max(dot(mtek_n, mtek_v), 0.0001);
    var mtek_rgb = vec3<f32>(0.0);
    for (var mtek_i = 0u; mtek_i < min(mtek_frame.light_count, 4u); mtek_i++) {
        let mtek_light = mtek_frame.lights[mtek_i];
        let mtek_range = mtek_light.range;
        let mtek_is_point = mtek_light.kind == 1u;
        let mtek_to_light = mtek_light.position - mtek_surface.world_position;
        let mtek_distance2 = dot(mtek_to_light, mtek_to_light);
        let mtek_l = normalize(select(-mtek_light.direction, mtek_to_light, mtek_is_point));
        let mtek_nl = max(dot(mtek_n, mtek_l), 0.0);
        let mtek_ratio = sqrt(mtek_distance2) / select(mtek_range, 1.0, mtek_range == 0.0);
        let mtek_ratio2 = mtek_ratio * mtek_ratio;
        let mtek_falloff = clamp(1.0 - (mtek_ratio2 * mtek_ratio2), 0.0, 1.0);
        let mtek_window = select(mtek_falloff, 1.0, mtek_range == 0.0);
        let mtek_radiance = select(mtek_light.color, mtek_light.color * (mtek_window / max(mtek_distance2, 0.0001)), mtek_is_point);
        if mtek_nl > 0.0 {
            let mtek_lv = mtek_l + mtek_v;
            if dot(mtek_lv, mtek_lv) > 0.0 {
                let mtek_h = normalize(mtek_lv);
                let mtek_nh = max(dot(mtek_n, mtek_h), 0.0);
                let mtek_vh = max(dot(mtek_v, mtek_h), 0.0);
                let mtek_nh2 = mtek_nh * mtek_nh;
                let mtek_spread = (1.0 - mtek_nh2) + (mtek_nh2 * mtek_a2);
                let mtek_d = mtek_a2 / ((3.1415927 * mtek_spread) * mtek_spread);
                let mtek_denominator = (mtek_nl * sqrt(((mtek_nv * mtek_nv) * (1.0 - mtek_a2)) + mtek_a2)) + (mtek_nv * sqrt(((mtek_nl * mtek_nl) * (1.0 - mtek_a2)) + mtek_a2));
                let mtek_vis = select(0.5 / mtek_denominator, 0.0, mtek_denominator == 0.0);
                let mtek_t = 1.0 - mtek_vh;
                let mtek_t5 = ((mtek_t * mtek_t) * (mtek_t * mtek_t)) * mtek_t;
                let mtek_fresnel = mtek_f0 + ((vec3<f32>(1.0) - mtek_f0) * mtek_t5);
                let mtek_fresnel_d = 0.04 + (0.96 * mtek_t5);
                let mtek_specular = mtek_fresnel * (mtek_d * mtek_vis);
                let mtek_diffuse = mtek_c * (((1.0 - mtek_m) * (1.0 - mtek_fresnel_d)) / 3.1415927);
                mtek_rgb = mtek_rgb + ((((mtek_diffuse + mtek_specular) * mtek_radiance) * mtek_shadow_visibility(mtek_surface.world_position, mtek_surface.world_normal, mtek_i)) * mtek_nl);
            }
        }
    }
    return vec4<f32>((mtek_rgb + (((((mtek_c * (1.0 - mtek_m)) * mtek_frame.ambient) + mtek_environment_light(mtek_n, mtek_v, mtek_c, mtek_m, mtek_r, mtek_f0, mtek_nv)) * clamp(mtek_occlusion, 0.0, 1.0)) + mtek_emissive)) * mtek_frame.exposure, 1.0);
}

fn mtek_fragment(u_p_surface: MtekSurfaceInput) -> vec4<f32> {
    let u_l_texel = textureSample(mtek_texture_base_color_texture, mtek_sampler_base_color_sampler, u_p_surface.uv);
    let u_l_albedo = vec4<f32>(mtek_params.u_base_color.xyz * u_l_texel.xyz, 1.0);
    let u_l_mr = textureSample(mtek_texture_metallic_roughness_texture, mtek_sampler_metallic_roughness_sampler, u_p_surface.uv);
    let u_l_normal = textureSample(mtek_texture_normal_texture, mtek_sampler_normal_sampler, u_p_surface.uv).xyz;
    let u_l_ao = textureSample(mtek_texture_occlusion_texture, mtek_sampler_occlusion_sampler, u_p_surface.uv).x;
    let u_l_emissive_texel = textureSample(mtek_texture_emissive_texture, mtek_sampler_emissive_sampler, u_p_surface.uv).xyz;
    let u_l_emission = mtek_params.u_emissive.xyz * u_l_emissive_texel;
    return mtek_lighting_pbr_mapped(u_p_surface, u_l_albedo, mtek_params.u_metallic * u_l_mr.z, mtek_params.u_roughness * u_l_mr.y, u_l_normal, mtek_params.u_normal_scale, 1.0 + (clamp(mtek_params.u_occlusion_strength, 0.0, 1.0) * (u_l_ao - 1.0)), u_l_emission);
}

@vertex
fn mtek_vs(@location(0) mtek_position: vec3<f32>, @location(1) mtek_normal: vec3<f32>, @location(2) mtek_uv: vec2<f32>) -> MtekVertexOutput {
    let mtek_world = mtek_object.model * vec4<f32>(mtek_position, 1.0);
    let mtek_world_normal = normalize((mtek_object.normal_matrix * vec4<f32>(mtek_normal, 0.0)).xyz);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_world.xyz, mtek_world_normal, mtek_uv);
}

@vertex
fn mtek_vs_instanced(@location(0) mtek_position: vec3<f32>, @location(1) mtek_normal: vec3<f32>, @location(2) mtek_uv: vec2<f32>, @location(3) mtek_model_c0: vec4<f32>, @location(4) mtek_model_c1: vec4<f32>, @location(5) mtek_model_c2: vec4<f32>, @location(6) mtek_model_c3: vec4<f32>, @location(7) mtek_normal_c0: vec4<f32>, @location(8) mtek_normal_c1: vec4<f32>, @location(9) mtek_normal_c2: vec4<f32>, @location(10) mtek_normal_c3: vec4<f32>) -> MtekVertexOutput {
    let mtek_world = mat4x4<f32>(mtek_model_c0, mtek_model_c1, mtek_model_c2, mtek_model_c3) * vec4<f32>(mtek_position, 1.0);
    let mtek_world_normal = normalize((mat4x4<f32>(mtek_normal_c0, mtek_normal_c1, mtek_normal_c2, mtek_normal_c3) * vec4<f32>(mtek_normal, 0.0)).xyz);
    return MtekVertexOutput(mtek_frame.view_proj * mtek_world, mtek_world.xyz, mtek_world_normal, mtek_uv);
}

@fragment
fn mtek_fs(mtek_in: MtekVertexOutput) -> @location(0) vec4<f32> {
    let mtek_surface = MtekSurfaceInput(mtek_in.world_position, normalize(mtek_in.world_normal), mtek_in.uv);
    let mtek_color = mtek_fragment(mtek_surface);
    return mtek_color;
}
