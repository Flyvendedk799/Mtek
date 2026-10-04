//! Resource planning (`spec/compiler-architecture.md` section 4.10): what the packager and the
//! JavaScript emitter need to know about a scene's GPU-side resources, decided once.
//!
//! For the M1 subset that is
//!
//! - the **meshes**: one entry per distinct mesh descriptor, in first-use order of the stable
//!   instance order (`spec/scenes.md` section 10.1), so equal descriptors share one
//!   `mesh:<n>` and the runtime builds the geometry once;
//! - the **material instances**: one per entity that has a material, in entity order, every
//!   parameter of update class `initial` (bindings and handler writes, which make a parameter
//!   `bound` or `imperative`, are M3), and therefore shareable (`spec/gpu-layout.md`
//!   section 8.2);
//! - the **materials**: the distinct material symbols the instances use, sorted.
//!
//! The plan depends only on the IR, never on traversal of unordered structures.

use crate::ir::{MeshDesc, Scene, Symbol, Value};

/// The update class of a material parameter (`spec/runtime-abi.md` section 5.2). M1 has only
/// constant parameters.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParamClass {
    /// Written once by `init(ctx)` and never again.
    Initial,
}

/// One parameter of a planned material instance.
#[derive(Clone, Debug, PartialEq)]
pub struct PlannedParam {
    pub name: String,
    /// The Mtek type spelling (`color`).
    pub ty: String,
    /// The constant initial value.
    pub value: Value,
    pub class: ParamClass,
}

/// A material instance.
#[derive(Clone, Debug, PartialEq)]
pub struct PlannedInstance {
    /// Its index in the manifest's `materialInstances`.
    pub index: u32,
    /// The static index of the entity that owns it.
    pub entity: u32,
    /// The material's symbol (`std/materials.mtek::Unlit`).
    pub material: Symbol,
    /// Every parameter of the material, in declaration order.
    pub params: Vec<PlannedParam>,
}

impl PlannedInstance {
    /// True when every parameter is `initial`: the instance may share a parameter slot with
    /// byte-identical instances of the same material.
    #[must_use]
    pub fn shareable(&self) -> bool {
        self.params.iter().all(|p| p.class == ParamClass::Initial)
    }
}

/// The resource plan of a scene.
#[derive(Clone, Debug, PartialEq)]
pub struct ResourcePlan {
    /// Distinct mesh descriptors; the position is the `<n>` of `mesh:<n>`.
    pub meshes: Vec<MeshDesc>,
    /// Per static entity index: its mesh's position in [`ResourcePlan::meshes`].
    pub entity_meshes: Vec<Option<u32>>,
    /// Material instances in entity order.
    pub instances: Vec<PlannedInstance>,
    /// Per static entity index: its material instance's index.
    pub entity_instances: Vec<Option<u32>>,
    /// The distinct material symbols the instances use, sorted.
    pub materials: Vec<Symbol>,
}

impl ResourcePlan {
    /// The manifest id of mesh `index`: `mesh:<index>`.
    #[must_use]
    pub fn mesh_id(index: u32) -> String {
        format!("mesh:{index}")
    }
}

/// Bitwise equality of mesh descriptors (an `f32` compares by its bits, so the plan never
/// depends on how `NaN` or `-0.0` compare).
fn same_mesh(a: &MeshDesc, b: &MeshDesc) -> bool {
    let bits = |values: &[f32]| values.iter().map(|v| v.to_bits()).collect::<Vec<_>>();
    match (a, b) {
        (MeshDesc::Box { size: x }, MeshDesc::Box { size: y }) => bits(x) == bits(y),
        (MeshDesc::Plane { size: x }, MeshDesc::Plane { size: y }) => bits(x) == bits(y),
        (
            MeshDesc::Sphere {
                radius: r1,
                segments: s1,
                rings: g1,
            },
            MeshDesc::Sphere {
                radius: r2,
                segments: s2,
                rings: g2,
            },
        ) => r1.to_bits() == r2.to_bits() && s1 == s2 && g1 == g2,
        _ => false,
    }
}

/// Plans the resources of `scene`.
///
/// # Errors
/// A text describing a compiler defect: a material parameter without a constant value (M1
/// has no other kind), or an index that does not fit the manifest's integers.
pub fn plan_scene(scene: &Scene) -> Result<ResourcePlan, String> {
    let mut meshes: Vec<MeshDesc> = Vec::new();
    let mut entity_meshes = Vec::with_capacity(scene.entities.len());
    let mut instances: Vec<PlannedInstance> = Vec::new();
    let mut entity_instances = Vec::with_capacity(scene.entities.len());
    for entity in &scene.entities {
        let mesh = match &entity.mesh {
            Some(mesh) => {
                let index = match meshes.iter().position(|m| same_mesh(m, &mesh.desc)) {
                    Some(index) => index,
                    None => {
                        meshes.push(mesh.desc.clone());
                        meshes.len() - 1
                    }
                };
                Some(index_u32(index)?)
            }
            None => None,
        };
        entity_meshes.push(mesh);
        let instance = match &entity.material {
            Some(material) => {
                let index = index_u32(instances.len())?;
                let mut params = Vec::with_capacity(material.params.len());
                for param in &material.params {
                    let value = param.source.as_const().ok_or_else(|| {
                        format!(
                            "the parameter '{}' of the material instance of '{}' has no constant value",
                            param.name, entity.symbol
                        )
                    })?;
                    params.push(PlannedParam {
                        name: param.name.clone(),
                        ty: param.ty.clone(),
                        value: value.clone(),
                        class: ParamClass::Initial,
                    });
                }
                instances.push(PlannedInstance {
                    index,
                    entity: entity.index,
                    material: material.material.clone(),
                    params,
                });
                Some(index)
            }
            None => None,
        };
        entity_instances.push(instance);
    }
    let mut materials: Vec<Symbol> = instances.iter().map(|i| i.material.clone()).collect();
    materials.sort();
    materials.dedup();
    Ok(ResourcePlan {
        meshes,
        entity_meshes,
        instances,
        entity_instances,
        materials,
    })
}

fn index_u32(index: usize) -> Result<u32, String> {
    u32::try_from(index).map_err(|_| format!("the index {index} does not fit a u32"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{
        Entity, Field, MaterialInstanceDesc, Mesh, Origin, Param, SceneFields, Source,
    };
    use crate::source::{FileId, Span};

    fn span() -> Span {
        Span::new(FileId(0), 0, 1)
    }

    fn field(value: Value) -> Field {
        Field {
            source: Source::Const(value),
            origin: Origin::Default,
            span: span(),
        }
    }

    fn entity(index: u32, mesh: Option<MeshDesc>, color: Option<[f32; 4]>) -> Entity {
        let symbol = Symbol::item("src/main.mtek", "S").child(&format!("E{index}"));
        Entity {
            index,
            name: format!("E{index}"),
            symbol,
            parent: None,
            span: span(),
            position: field(Value::Vec3([0.0; 3])),
            rotation: field(Value::Quat([0.0, 0.0, 0.0, 1.0])),
            scale: field(Value::Vec3([1.0; 3])),
            visible: field(Value::Bool(true)),
            mesh: mesh.map(|desc| Mesh {
                desc,
                origin: Origin::Written,
                span: span(),
            }),
            material: color.map(|c| MaterialInstanceDesc {
                material: Symbol::item("std/materials.mtek", "Unlit"),
                params: vec![Param {
                    name: "color".to_owned(),
                    ty: "color".to_owned(),
                    source: Source::Const(Value::Color(c)),
                    span: span(),
                }],
                origin: Origin::Written,
                span: span(),
            }),
        }
    }

    fn scene(entities: Vec<Entity>) -> Scene {
        Scene {
            name: "S".to_owned(),
            symbol: Symbol::item("src/main.mtek", "S"),
            span: span(),
            fields: SceneFields {
                clear_color: field(Value::Color([0.0, 0.0, 0.0, 1.0])),
            },
            constants: Vec::new(),
            cameras: Vec::new(),
            entities,
        }
    }

    #[test]
    fn equal_meshes_share_an_entry_in_first_use_order() {
        let unit = MeshDesc::Box { size: [1.0; 3] };
        let ball = MeshDesc::Sphere {
            radius: 1.0,
            segments: 32,
            rings: 16,
        };
        let plan = plan_scene(&scene(vec![
            entity(0, Some(ball.clone()), Some([1.0; 4])),
            entity(1, None, None),
            entity(2, Some(unit.clone()), Some([1.0; 4])),
            entity(3, Some(ball.clone()), Some([0.5, 0.5, 0.5, 1.0])),
        ]))
        .expect("planned");
        assert_eq!(plan.meshes, [ball, unit]);
        assert_eq!(plan.entity_meshes, [Some(0), None, Some(1), Some(0)]);
        assert_eq!(ResourcePlan::mesh_id(1), "mesh:1");
    }

    #[test]
    fn every_entity_with_a_material_gets_an_initial_shareable_instance() {
        let unit = MeshDesc::Box { size: [1.0; 3] };
        let plan = plan_scene(&scene(vec![
            entity(0, Some(unit.clone()), Some([1.0; 4])),
            entity(1, None, None),
            entity(2, Some(unit), Some([0.25, 0.5, 1.0, 1.0])),
        ]))
        .expect("planned");
        assert_eq!(plan.entity_instances, [Some(0), None, Some(1)]);
        let entities: Vec<u32> = plan.instances.iter().map(|i| i.entity).collect();
        assert_eq!(entities, [0, 2]);
        assert!(plan.instances.iter().all(PlannedInstance::shareable));
        assert_eq!(
            plan.instances[1].params[0].value,
            Value::Color([0.25, 0.5, 1.0, 1.0])
        );
        assert_eq!(
            plan.materials,
            [Symbol::item("std/materials.mtek", "Unlit")]
        );
    }

    #[test]
    fn meshes_compare_by_bits() {
        let a = MeshDesc::Plane { size: [0.0, 1.0] };
        let b = MeshDesc::Plane { size: [-0.0, 1.0] };
        assert!(!same_mesh(&a, &b));
        assert!(same_mesh(&a, &a.clone()));
        assert!(!same_mesh(&a, &MeshDesc::Box { size: [1.0; 3] }));
    }
}
