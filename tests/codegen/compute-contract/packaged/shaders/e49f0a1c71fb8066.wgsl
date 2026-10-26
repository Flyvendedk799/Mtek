struct MtekComputeInput {
    index: u32,
    global_x: u32,
    global_y: u32,
    global_z: u32,
    local_x: u32,
    local_y: u32,
    local_z: u32,
    group_x: u32,
    group_y: u32,
    group_z: u32,
    group_count_x: u32,
    group_count_y: u32,
    group_count_z: u32,
    local_index: u32,
}

struct MtekPad16_f32 {
    @size(16) value: f32,
}

struct S_e2cab98b_Small {
    u_value: f32,
}

struct S_e2cab98b_Record {
    u_position: vec3<f32>,
    u_enabled: u32,
    @align(16) u_samples: array<MtekPad16_f32, 3>,
    @align(16) @size(16) u_small: S_e2cab98b_Small,
    u_tint: vec4<f32>,
}

struct MtekComputeDispatch {
    x: u32,
    y: u32,
    z: u32,
}

struct MtekComputeParams_e2cab98b_Transform {
    u_gain: f32,
    @size(12) u_enabled: u32,
    @size(16) u_offset: vec3<f32>,
    @align(16) u_table: array<MtekPad16_f32, 2>,
    u_matrix: mat4x4<f32>,
    @align(16) u_settings: S_e2cab98b_Small,
}

@group(0) @binding(0) var<uniform> mtek_dispatch: MtekComputeDispatch;
@group(0) @binding(1) var<uniform> mtek_params: MtekComputeParams_e2cab98b_Transform;
@group(0) @binding(2) var<storage, read> mtek_input_0: array<f32, 17>;
@group(0) @binding(3) var<storage, read> mtek_input_1: array<S_e2cab98b_Small, 17>;
@group(0) @binding(4) var<storage, read> mtek_input_2: array<S_e2cab98b_Record, 17>;
@group(0) @binding(5) var<storage, read> mtek_input_3: array<mat4x4<f32>, 17>;
@group(0) @binding(6) var<storage, read_write> mtek_output: array<S_e2cab98b_Record, 17>;

fn mtek_kernel(u_p_input: MtekComputeInput) -> S_e2cab98b_Record {
    var u_l_value = mtek_input_2[min(u_p_input.index, 16u)];
    u_l_value.u_position = u_l_value.u_position + (mtek_params.u_offset * mtek_params.u_gain);
    u_l_value.u_enabled = select(0u, 1u, (mtek_params.u_enabled != 0u));
    u_l_value.u_samples[1i].value = (mtek_input_0[min(u_p_input.index, 16u)] + mtek_input_1[min(u_p_input.index, 16u)].u_value) + mtek_params.u_table[0i].value;
    return u_l_value;
}

@compute @workgroup_size(4, 2, 2)
fn mtek_cs(@builtin(global_invocation_id) mtek_global: vec3<u32>, @builtin(local_invocation_id) mtek_local: vec3<u32>, @builtin(workgroup_id) mtek_group: vec3<u32>, @builtin(num_workgroups) mtek_groups: vec3<u32>, @builtin(local_invocation_index) mtek_local_index: u32) {
    if ((mtek_global.x >= mtek_dispatch.x) || (mtek_global.y >= mtek_dispatch.y)) || (mtek_global.z >= mtek_dispatch.z) {
        return;
    }
    let mtek_index = mtek_global.x + (mtek_dispatch.x * (mtek_global.y + (mtek_dispatch.y * mtek_global.z)));
    mtek_output[mtek_index] = mtek_kernel(MtekComputeInput(mtek_index, mtek_global.x, mtek_global.y, mtek_global.z, mtek_local.x, mtek_local.y, mtek_local.z, mtek_group.x, mtek_group.y, mtek_group.z, mtek_groups.x, mtek_groups.y, mtek_groups.z, mtek_local_index));
}
