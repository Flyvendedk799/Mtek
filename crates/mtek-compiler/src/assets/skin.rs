//! Validated glTF skeletal meshes. Vertex influences stay attached to their mesh;
//! node hierarchy, inverse bind matrices and animation channels share file coordinates.
use super::{GlbClip, Issue};
use crate::diagnostics::Code;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skin {
    pub mesh_node: usize,
    pub nodes: Vec<Node>,
    pub joints: Vec<usize>,
    pub inverse_bind: Vec<[f32; 16]>,
    pub indices: Vec<[u16; 4]>,
    pub weights: Vec<[f32; 4]>,
    pub clips: Vec<Clip>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub name: String,
    pub parent: i32,
    pub translation: [f32; 3],
    pub rotation: [f32; 4],
    pub scale: [f32; 3],
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Clip {
    pub name: String,
    pub duration: f32,
    pub channels: Vec<Channel>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Channel {
    pub node: usize,
    pub path: String,
    pub interpolation: String,
    pub times: Vec<f32>,
    pub values: Vec<f32>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct SkinMesh {
    pub mesh: String,
    pub primitive: usize,
    pub skin: Skin,
}

fn bad(message: impl Into<String>) -> Issue {
    Issue::new(Code::E7019, message.into())
}

pub fn read(doc: &gltf::Document, bin: &[u8], clips: &[GlbClip]) -> Result<Vec<SkinMesh>, Issue> {
    if doc.skins().len() == 0 {
        return Ok(Vec::new());
    }
    if doc.nodes().len() > 256 {
        return Err(bad(
            "A skeletal asset supports at most 256 hierarchy nodes.",
        ));
    }
    // Validate every accessor range before the glTF reader can borrow it.
    for accessor in doc.accessors() {
        let view = accessor
            .view()
            .ok_or_else(|| bad("Skeletal assets require dense accessors."))?;
        let stride = view.stride().unwrap_or(accessor.size());
        let end = accessor
            .offset()
            .checked_add(accessor.count().saturating_sub(1).saturating_mul(stride))
            .and_then(|v| v.checked_add(accessor.size()))
            .ok_or_else(|| bad("Skeletal accessor range overflow."))?;
        if accessor.count() == 0
            || stride < accessor.size()
            || end > view.length()
            || view
                .offset()
                .checked_add(view.length())
                .is_none_or(|n| n > bin.len())
        {
            return Err(bad("A skeletal accessor lies outside its buffer view."));
        }
    }
    let mut nodes = doc
        .nodes()
        .map(|node| {
            let (translation, rotation, scale) = node.transform().decomposed();
            Node {
                name: node.name().unwrap_or("").to_owned(),
                parent: -1,
                translation,
                rotation,
                scale,
            }
        })
        .collect::<Vec<_>>();
    for node in doc.nodes() {
        for child in node.children() {
            if nodes[child.index()].parent != -1 {
                return Err(bad("A skeletal node has multiple parents."));
            }
            nodes[child.index()].parent = node.index() as i32;
        }
    }
    for (index, node) in nodes.iter().enumerate() {
        if !node
            .translation
            .iter()
            .chain(&node.rotation)
            .chain(&node.scale)
            .all(|v| v.is_finite())
            || node.scale.iter().any(|v| *v <= 0.0)
            || node.rotation.iter().map(|v| v * v).sum::<f32>() < 1e-8
        {
            return Err(bad(
                "Skeletal nodes require finite TRS, positive scale and a nonzero quaternion.",
            ));
        }
        let mut ancestor = index as i32;
        for depth in 0..=nodes.len() {
            if ancestor < 0 {
                break;
            }
            if depth == nodes.len() {
                return Err(bad("The skeletal hierarchy contains a cycle."));
            }
            ancestor = nodes[ancestor as usize].parent;
        }
    }
    let clips = clips
        .iter()
        .map(|clip| Clip {
            name: clip.name.clone(),
            duration: clip.duration,
            channels: clip
                .channels
                .iter()
                .map(|c| Channel {
                    node: c.node,
                    path: c.path.as_str().into(),
                    interpolation: c.interpolation.as_str().into(),
                    times: c.times.clone(),
                    values: c.values.clone(),
                })
                .collect(),
        })
        .collect::<Vec<_>>();
    for clip in &clips {
        for channel in &clip.channels {
            if (channel.path == "scale" && channel.values.iter().any(|v| *v <= 0.0))
                || (channel.path == "rotation"
                    && channel
                        .values
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .any(|q| q.iter().map(|v| v * v).sum::<f32>() < 1e-8))
            {
                return Err(bad(
                    "Skeletal clips require positive scale and nonzero rotation quaternions.",
                ));
            }
        }
    }
    let mut result: Vec<SkinMesh> = Vec::new();
    for node in doc.nodes() {
        let Some(skin) = node.skin() else {
            continue;
        };
        let mesh = node
            .mesh()
            .ok_or_else(|| bad("A skinned node must have a mesh."))?;
        let name = mesh
            .name()
            .ok_or_else(|| bad("A skinned mesh must have a name."))?
            .to_owned();
        if result.iter().any(|s| s.mesh == name) {
            return Err(bad(
                "A skinned mesh must be used by exactly one mesh node; instance it in Mtek.",
            ));
        }
        let joints = skin.joints().map(|j| j.index()).collect::<Vec<_>>();
        if joints.is_empty() || joints.len() > 128 {
            return Err(bad("A skin requires 1..128 joints."));
        }
        if let Some(a) = skin.inverse_bind_matrices()
            && (a.data_type() != gltf::accessor::DataType::F32
                || a.dimensions() != gltf::accessor::Dimensions::Mat4)
        {
            return Err(bad("Inverse bind matrices require FLOAT MAT4 accessors."));
        }
        let inverse_bind = match skin.reader(|_| Some(bin)).read_inverse_bind_matrices() {
            Some(matrices) => matrices
                .map(|m| std::array::from_fn(|i| m[i / 4][i % 4]))
                .collect::<Vec<_>>(),
            None if skin.inverse_bind_matrices().is_none() => vec![
                [
                    1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.
                ];
                joints.len()
            ],
            None => return Err(bad("Cannot read inverse bind matrices.")),
        };
        if inverse_bind.len() != joints.len()
            || !inverse_bind.iter().flatten().all(|v| v.is_finite())
        {
            return Err(bad(
                "Inverse bind matrices must be finite and match the joint count.",
            ));
        }
        for primitive in mesh.primitives() {
            if let Some(a) = primitive.get(&gltf::Semantic::Joints(0))
                && (!matches!(
                    a.data_type(),
                    gltf::accessor::DataType::U8 | gltf::accessor::DataType::U16
                ) || a.dimensions() != gltf::accessor::Dimensions::Vec4
                    || a.normalized())
            {
                return Err(bad(
                    "JOINTS_0 requires non-normalized unsigned byte or short VEC4.",
                ));
            }
            if let Some(a) = primitive.get(&gltf::Semantic::Weights(0))
                && (a.dimensions() != gltf::accessor::Dimensions::Vec4
                    || !matches!(
                        (a.data_type(), a.normalized()),
                        (gltf::accessor::DataType::F32, false)
                            | (
                                gltf::accessor::DataType::U8 | gltf::accessor::DataType::U16,
                                true
                            )
                    ))
            {
                return Err(bad(
                    "WEIGHTS_0 requires FLOAT or normalized unsigned byte or short VEC4.",
                ));
            }
            let reader = primitive.reader(|_| Some(bin));
            let indices = reader
                .read_joints(0)
                .ok_or_else(|| {
                    bad("A skinned mesh requires JOINTS_0 (unsigned byte or short VEC4).")
                })?
                .into_u16()
                .collect::<Vec<_>>();
            let mut weights = reader
                .read_weights(0)
                .ok_or_else(|| bad("A skinned mesh requires WEIGHTS_0."))?
                .into_f32()
                .collect::<Vec<_>>();
            let count = primitive
                .get(&gltf::Semantic::Positions)
                .map_or(0, |a| a.count());
            if indices.len() != count || weights.len() != count {
                return Err(bad("Skin attributes must match the POSITION count."));
            }
            for (ids, weights) in indices.iter().zip(&mut weights) {
                if ids.iter().any(|id| usize::from(*id) >= joints.len()) {
                    return Err(bad("A vertex joint index lies outside its skin."));
                }
                let sum: f32 = weights.iter().sum();
                if !sum.is_finite() || sum <= 0.0 || weights.iter().any(|w| *w < 0.0) {
                    return Err(bad(
                        "Skin weights must be finite, nonnegative and have a positive sum.",
                    ));
                }
                for w in weights {
                    *w /= sum;
                }
            }
            result.push(SkinMesh {
                mesh: name.clone(),
                primitive: primitive.index(),
                skin: Skin {
                    mesh_node: node.index(),
                    nodes: nodes.clone(),
                    joints: joints.clone(),
                    inverse_bind: inverse_bind.clone(),
                    indices,
                    weights,
                    clips: clips.clone(),
                },
            });
        }
    }
    if result.is_empty() {
        return Err(bad("The file declares skins but no skinned mesh node."));
    }
    Ok(result)
}
