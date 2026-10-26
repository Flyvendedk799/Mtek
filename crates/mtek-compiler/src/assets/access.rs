//! The accessors of a `glb_asset` (`spec/assets.md` section 2.1): `.mesh(name)`,
//! `.primitive(name, index)`, `.material(name)`, `.material_base_color(name)`,
//! `.material_metallic(name)`, `.material_roughness(name)`, `.material_texture(name)`,
//! `.node_position(name)`, `.node_rotation(name)` and `.node_scale(name)`.
//!
//! [`evaluate`] looks the name up in an already validated [`GlbFile`] and returns the value or a
//! [`Failure`] (`E7024` for an unknown or ambiguous name, an index out of range, or a node
//! outside the default scene; `E7012` for a mesh with several primitives; `E7013` for a node
//! transform an entity cannot have). [`evaluate_checked`] adds the validated rename edit of
//! `E7024`: the single name within edit distance 2, offered only if evaluating the accessor
//! with it succeeds.

use super::glb::{GlbFile, GlbTexture};
use super::transform::{in_default_scene, node_world_trs};
use crate::diagnostics::Code;
use crate::project::edit_distance;

/// How many names an `E7024` lists.
const LISTED_NAMES: usize = 20;

/// The accessor kinds, by method name.
const METHODS: [&str; 10] = [
    "mesh",
    "primitive",
    "material",
    "material_base_color",
    "material_metallic",
    "material_roughness",
    "material_texture",
    "node_position",
    "node_rotation",
    "node_scale",
];

/// Whether `method` is an accessor of `glb_asset`.
#[must_use]
pub fn is_accessor(method: &str) -> bool {
    METHODS.contains(&method)
}

/// The value of an accessor.
#[derive(Clone, Debug, PartialEq)]
pub enum Accessed {
    /// Primitive `primitive` of the glTF mesh called `mesh`.
    Mesh {
        mesh: String,
        primitive: usize,
    },
    Color([f32; 4]),
    Scalar(f32),
    Vec3([f32; 3]),
    Quat([f32; 4]),
    /// `None`: the material has no base colour texture (`texture.white()`).
    Texture(Option<GlbTexture>),
    /// Every parameter of the material.
    Material {
        base_color: [f32; 4],
        metallic: f32,
        roughness: f32,
        texture: Option<GlbTexture>,
        maps: super::GlbMaterialMaps,
    },
}

/// Why an accessor has no value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    pub code: Code,
    pub message: String,
    pub notes: Vec<String>,
    pub help: Option<String>,
    /// A validated replacement for the name argument (`E7024` only).
    pub rename: Option<String>,
    /// The name is not there (as opposed to ambiguous, or an index out of range).
    pub unknown_name: bool,
}

impl Failure {
    fn new(code: Code, message: String) -> Self {
        Self {
            code,
            message,
            notes: Vec::new(),
            help: None,
            rename: None,
            unknown_name: false,
        }
    }
}

/// The plural of a noun from `noun`.
fn plural(noun: &str) -> &'static str {
    match noun {
        "mesh" => "meshes",
        "material" => "materials",
        _ => "nodes",
    }
}

/// The kind of object a method looks up, for messages.
fn noun(method: &str) -> &'static str {
    match method {
        "mesh" | "primitive" => "mesh",
        "material"
        | "material_base_color"
        | "material_metallic"
        | "material_roughness"
        | "material_texture" => "material",
        _ => "node",
    }
}

/// The named objects a method can address, with their index; nodes only in the default scene.
fn candidates(file: &GlbFile, noun: &str) -> Vec<(usize, String)> {
    match noun {
        "mesh" => file
            .meshes
            .iter()
            .enumerate()
            .filter_map(|(i, m)| m.name.clone().map(|n| (i, n)))
            .collect(),
        "material" => file
            .materials
            .iter()
            .enumerate()
            .filter_map(|(i, m)| m.name.clone().map(|n| (i, n)))
            .collect(),
        _ => file
            .nodes
            .iter()
            .enumerate()
            .filter(|(i, _)| in_default_scene(file, *i))
            .filter_map(|(i, n)| n.name.clone().map(|name| (i, name)))
            .collect(),
    }
}

fn total(file: &GlbFile, noun: &str) -> usize {
    match noun {
        "mesh" => file.meshes.len(),
        "material" => file.materials.len(),
        _ => file.nodes.len(),
    }
}

fn unknown_name(file: &GlbFile, method: &str, name: &str, found: &[(usize, String)]) -> Failure {
    let noun = noun(method);
    let mut names: Vec<&str> = found.iter().map(|(_, n)| n.as_str()).collect();
    names.sort_unstable();
    names.dedup();
    let scope = if noun == "node" {
        " in the default scene"
    } else {
        ""
    };
    let mut failure = Failure::new(
        Code::E7024,
        format!(
            "The glTF file '{}' has no {noun} named '{name}'{scope}.",
            file.path
        ),
    );
    failure.unknown_name = true;
    let plural = plural(noun);
    if names.is_empty() {
        failure
            .notes
            .push(format!("the file has no named {plural}{scope}"));
    } else {
        let shown: Vec<String> = names
            .iter()
            .take(LISTED_NAMES)
            .map(|n| format!("'{n}'"))
            .collect();
        let more = names.len().saturating_sub(LISTED_NAMES);
        failure.notes.push(format!(
            "available {plural}{scope}: {}{}",
            shown.join(", "),
            if more > 0 {
                format!(" (and {more} more)")
            } else {
                String::new()
            }
        ));
    }
    let unnamed = total(file, noun).saturating_sub(found.len());
    if unnamed > 0 && noun != "node" {
        failure.notes.push(format!(
            "{unnamed} {} in the file {} no name and cannot be referenced; name {} in the authoring tool",
            if unnamed == 1 { noun } else { plural },
            if unnamed == 1 { "has" } else { "have" },
            if unnamed == 1 { "it" } else { "them" },
        ));
    }
    if noun == "node" {
        let elsewhere = file.nodes.iter().any(|n| n.name.as_deref() == Some(name));
        if elsewhere {
            failure.notes.push(format!(
                "a node named '{name}' exists, but it is not part of the default scene"
            ));
        }
    }
    failure
}

/// The value of the accessor `method` for `name` (and `index` for `.primitive`).
///
/// # Errors
/// See the module documentation.
pub fn evaluate(
    file: &GlbFile,
    method: &str,
    name: &str,
    index: Option<u32>,
) -> Result<Accessed, Failure> {
    let noun = noun(method);
    let found = candidates(file, noun);
    let matching: Vec<usize> = found
        .iter()
        .filter(|(_, n)| n == name)
        .map(|(i, _)| *i)
        .collect();
    let object = match matching.as_slice() {
        [] => return Err(unknown_name(file, method, name, &found)),
        [single] => *single,
        several => {
            let mut failure = Failure::new(
                Code::E7024,
                format!(
                    "The glTF file '{}' has {} {} named '{name}', so the name does not identify one.",
                    file.path,
                    several.len(),
                    plural(noun)
                ),
            );
            failure.notes.push(
                "names must be unique to be referenced; rename them in the authoring tool".into(),
            );
            return Err(failure);
        }
    };
    match method {
        "mesh" | "primitive" => {
            let mesh = file
                .meshes
                .get(object)
                .ok_or_else(|| unknown_name(file, method, name, &found))?;
            let count = mesh.primitives.len();
            let primitive = if method == "mesh" {
                if count != 1 {
                    let mut failure = Failure::new(
                        Code::E7012,
                        format!(
                            "The mesh '{name}' of '{}' has {count} primitives; `.mesh` needs exactly one.",
                            file.path
                        ),
                    );
                    if count > 1 {
                        failure.help = Some(format!(
                            "pick one with `.primitive(\"{name}\", 0)` to `.primitive(\"{name}\", {})`",
                            count - 1
                        ));
                        failure.notes.push(
                            "a glTF primitive has one material; v0.1 draws each primitive as its own entity".into(),
                        );
                    }
                    return Err(failure);
                }
                0
            } else {
                let wanted = index.unwrap_or(0) as usize;
                if wanted >= count {
                    return Err(Failure::new(
                        Code::E7024,
                        format!(
                            "The mesh '{name}' of '{}' has {count} primitive{}, but primitive {wanted} was requested.",
                            file.path,
                            if count == 1 { "" } else { "s" }
                        ),
                    ));
                }
                wanted
            };
            Ok(Accessed::Mesh {
                mesh: name.to_owned(),
                primitive,
            })
        }
        "material"
        | "material_base_color"
        | "material_metallic"
        | "material_roughness"
        | "material_texture" => {
            let material = file
                .materials
                .get(object)
                .ok_or_else(|| unknown_name(file, method, name, &found))?;
            Ok(match method {
                "material" => Accessed::Material {
                    base_color: material.base_color,
                    metallic: material.metallic,
                    roughness: material.roughness,
                    texture: material.texture,
                    maps: material.maps.clone(),
                },
                "material_base_color" => Accessed::Color(material.base_color),
                "material_metallic" => Accessed::Scalar(material.metallic),
                "material_roughness" => Accessed::Scalar(material.roughness),
                _ => Accessed::Texture(material.texture),
            })
        }
        _ => {
            let trs = node_world_trs(file, object).map_err(|reason| {
                let mut failure = Failure::new(
                    Code::E7013,
                    format!(
                        "The node '{name}' of '{}' cannot be an entity transform: {reason}.",
                        file.path
                    ),
                );
                failure.help = Some(
                    "apply the transform in the authoring tool, or use only translation, rotation and positive scale".into(),
                );
                failure
            })?;
            Ok(match method {
                "node_position" => Accessed::Vec3(trs.translation),
                "node_rotation" => Accessed::Quat(trs.rotation),
                _ => Accessed::Vec3(trs.scale),
            })
        }
    }
}

/// [`evaluate`], with the validated rename edit of `E7024` filled in.
///
/// # Errors
/// See [`evaluate`].
pub fn evaluate_checked(
    file: &GlbFile,
    method: &str,
    name: &str,
    index: Option<u32>,
) -> Result<Accessed, Failure> {
    let mut failure = match evaluate(file, method, name, index) {
        Ok(value) => return Ok(value),
        Err(failure) => failure,
    };
    if failure.unknown_name {
        let found = candidates(file, noun(method));
        let mut near: Vec<&str> = found
            .iter()
            .map(|(_, n)| n.as_str())
            .filter(|n| (1..=2).contains(&edit_distance(name, n)))
            .collect();
        near.sort_unstable();
        near.dedup();
        if let [single] = near.as_slice() {
            failure.help = Some(format!("did you mean '{single}'?"));
            // An edit is a promise that the program is fine with it applied.
            if evaluate(file, method, single, index).is_ok() {
                failure.rename = Some((*single).to_owned());
            }
        }
    }
    Err(failure)
}
