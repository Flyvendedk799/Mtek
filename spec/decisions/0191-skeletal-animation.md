# 0191 — Skeletal animation and named combat clips



Status: accepted. Extends 0190; replaces the blanket skin rejection in 0058/0156.
The renderer and host animation API described below were subsequently extended by
[0193](0193-platform-runtime-extensions.md), which supersedes the CPU-only deformation,
uncullable-skin and no-host-layer/IK implementation statements in this record.



A skinned GLB mesh retains its hierarchy, inverse bind matrices and four vertex

influences. Import supports at most 256 nodes and 128 joints, one mesh node per

named mesh, dense JOINTS_0 (unsigned byte/short) and WEIGHTS_0 (float or normalized

unsigned byte/short). Weights are normalized at import. Invalid skin data is

E7019; extra influence sets, morphs and unsupported attributes remain rejected.

Nodes require finite TRS with positive scale and nonzero rotation. Named LINEAR

and STEP TRS clips are retained; cubic splines and morph animation remain outside

the profile. Unsupported clips cannot be selected.



Each entity instance owns its animation time, local poses and joint palette.

The mesh-local palette is inverse(mesh-global) * joint-global * inverse-bind.

The renderer deforms positions and inverse-transpose normals with linear blend

skinning into reusable per-instance buffers. This implementation evaluates on

the CPU and uploads changed poses; it does not claim GPU skinning. Finished,

unchanged poses avoid vertex deformation and uploads. Skin geometry is not

instanced and is conservatively excluded from rigid bind-pose sphere culling.

Buffers use the renderer resource registry and are released on entity removal.



The CPU animation namespace adds:



| Function | Meaning |

|---|---|

| `transition(target, name: string, seconds: f32, looping: bool, speed: f32) -> bool` | Select a named skeletal clip. Blend from the current displayed local pose to the incoming running clip using smoothstep and quaternion SLERP. Re-selecting the current name is a no-op; `play` explicitly restarts. Decision 0192 advances both clips during the blend; interruption snapshots the displayed pose to prevent a snap. |

| `joint_position(target, name: string) -> vec3` | Current mesh-local joint/socket position. |

| `joint_rotation(target, name: string) -> quat` | Current mesh-local normalized joint/socket orientation. |



Mutation is handler/lifecycle-only; queries are CPU-only and nonconstant. Socket

queries return zero/identity for missing targets/names. Transitions return false

for missing clips/targets, negative or nonfinite durations/speeds. Existing

playback, seek, marker and weight controls apply to skeletal clips too. Clip

weight blends against the imported bind pose. Transition and weight fades use

elapsed scene time even if clip playback is paused, matching decision 0190's

fade contract. There are no layer masks, additive layers or runtime IK APIs.



The example authors IK into source clips at build time. Gameplay remains Mtek:

weapon sockets, attack selection, recoil, reload, enemies and marker-based damage.

Runtime tests pin known vertex deformation, hierarchical sockets, nonuniform

normal transforms, independent instances, slot reuse and interrupted transitions.

Compiler tests pin accepted influences and rejected malformed skin data.
