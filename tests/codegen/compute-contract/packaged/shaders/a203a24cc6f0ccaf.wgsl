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

struct S_e2cab98b_Invocation {
    u_index: u32,
    u_global_x: u32,
    u_global_y: u32,
    u_global_z: u32,
    u_local_x: u32,
    u_local_y: u32,
    u_local_z: u32,
    u_group_x: u32,
    u_group_y: u32,
    u_group_z: u32,
    u_group_count_x: u32,
    u_group_count_y: u32,
    u_group_count_z: u32,
    u_local_index: u32,
}

struct MtekComputeDispatch {
    x: u32,
    y: u32,
    z: u32,
}

@group(0) @binding(0) var<uniform> mtek_dispatch: MtekComputeDispatch;
@group(0) @binding(2) var<storage, read_write> mtek_output: array<S_e2cab98b_Invocation, 257>;

fn mtek_kernel(u_p_input: MtekComputeInput) -> S_e2cab98b_Invocation {
    return S_e2cab98b_Invocation(u_p_input.index, u_p_input.global_x, u_p_input.global_y, u_p_input.global_z, u_p_input.local_x, u_p_input.local_y, u_p_input.local_z, u_p_input.group_x, u_p_input.group_y, u_p_input.group_z, u_p_input.group_count_x, u_p_input.group_count_y, u_p_input.group_count_z, u_p_input.local_index);
}

@compute @workgroup_size(4, 2, 2)
fn mtek_cs(@builtin(global_invocation_id) mtek_global: vec3<u32>, @builtin(local_invocation_id) mtek_local: vec3<u32>, @builtin(workgroup_id) mtek_group: vec3<u32>, @builtin(num_workgroups) mtek_groups: vec3<u32>, @builtin(local_invocation_index) mtek_local_index: u32) {
    if ((mtek_global.x >= mtek_dispatch.x) || (mtek_global.y >= mtek_dispatch.y)) || (mtek_global.z >= mtek_dispatch.z) {
        return;
    }
    let mtek_index = mtek_global.x + (mtek_dispatch.x * (mtek_global.y + (mtek_dispatch.y * mtek_global.z)));
    mtek_output[mtek_index] = mtek_kernel(MtekComputeInput(mtek_index, mtek_global.x, mtek_global.y, mtek_global.z, mtek_local.x, mtek_local.y, mtek_local.z, mtek_group.x, mtek_group.y, mtek_group.z, mtek_groups.x, mtek_groups.y, mtek_groups.z, mtek_local_index));
}
