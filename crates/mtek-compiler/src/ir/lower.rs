//! Lowering a checked program to the typed IR (decision 0028).
//!
//! The input is the front end's result without errors, for every module of
//! the project in load order (the entry module first): the parsed module (for
//! item order, constant declarations and their spans), the resolution
//! (declarations and, for the entry module, the entry scene) and the type checker's
//! result (folded constants and the [`CheckedScene`]s of decision 0027, whose
//! fields are complete: written values and registry defaults, descriptors
//! completed in schema order). Lowering never reads registry defaults and
//! never evaluates anything; it only reshapes.
//!
//! A checked program the lowering cannot represent (a field it does not know,
//! a missing value) is a compiler defect, reported by the caller as `E9999`:
//! the lists of the fields, schemas and scene-object kinds lowered here are
//! compared with the registry by unit tests, so a milestone that implements
//! a new field or schema fails those tests until the IR represents it.

use super::model::{
    Camera, Const, Entity, Field, Item, MaterialInstanceDesc, Mesh, MeshDesc, Module, Origin,
    Param, Program, Projection, ProjectionDesc, Scene, SceneFields, Source, StructFieldItem,
    StructItem, Symbol, Value,
};
use crate::project::{ModuleId, Project};
use crate::resolve::Resolution;
use crate::source::Span;
use crate::stdlib::{SchemaCategory, registry};
use crate::syntax::ast::{self, ConstDecl, EntityMember, ItemKind, SceneMember};
use crate::types::{CheckedEntity, CheckedField, CheckedObject, CheckedScene, ConstValue, Typeck};

/// The scene fields lowered into [`SceneFields`].
pub(super) const SCENE_FIELDS: [&str; 1] = ["clear_color"];
/// The camera fields lowered into [`Camera`]; `active` is represented by
/// [`Camera::active`], which the scene checks computed.
pub(super) const CAMERA_FIELDS: [&str; 5] =
    ["position", "target", "rotation", "projection", "active"];
/// The entity fields lowered into [`Entity`].
pub(super) const ENTITY_FIELDS: [&str; 6] = [
    "position", "rotation", "scale", "visible", "mesh", "material",
];
/// The scene-object kinds lowered (into [`Camera`]).
pub(super) const OBJECT_KINDS: [&str; 1] = ["camera"];
/// The mesh schemas lowered into [`MeshDesc`].
pub(super) const MESH_SCHEMAS: [&str; 3] = ["Box", "Sphere", "Plane"];
/// The projection schemas lowered into [`ProjectionDesc`].
pub(super) const PROJECTION_SCHEMAS: [&str; 2] = ["Perspective", "Orthographic"];

/// Why lowering failed: a description of the compiler defect.
pub(super) type Defect = String;

/// One checked module: its id and what the front end produced for it.
#[derive(Clone, Copy)]
pub(super) struct Unit<'a> {
    pub(super) id: ModuleId,
    pub(super) module: &'a ast::Module,
    pub(super) resolution: &'a Resolution,
    pub(super) types: &'a Typeck,
}

/// Lower the modules of a checked program without errors, the entry module
/// first, into [`Program::modules`] in that order (load order). Imports are
/// not items of the IR: every use of an imported constant is folded, and a
/// declaration is listed once, in the module that declares it, under its own
/// symbol.
pub(super) fn lower(project: &Project, units: &[Unit<'_>]) -> Result<Program, Defect> {
    let mut modules = Vec::with_capacity(units.len());
    let mut entry_scene = None;
    for (index, unit) in units.iter().enumerate() {
        let (module, scene) = lower_module(project, unit, index == 0)?;
        modules.push(module);
        entry_scene = entry_scene.or(scene);
    }
    let entry_scene = entry_scene.ok_or("the entry scene is not a scene of the entry module")?;
    Ok(Program {
        entry_scene,
        modules,
    })
}

/// Lower one module; for the entry module, also the symbol of the entry
/// scene.
fn lower_module(
    project: &Project,
    unit: &Unit<'_>,
    entry: bool,
) -> Result<(Module, Option<Symbol>), Defect> {
    let Unit {
        module,
        resolution,
        types,
        ..
    } = *unit;
    let source = project
        .modules
        .get(unit.id)
        .and_then(|m| project.sources.get(m.file()))
        .ok_or("a module is missing from the source map")?;
    let path = source.path().as_str().to_owned();
    let lowering = Lowering {
        path: &path,
        resolution,
        types,
    };
    let mut items = Vec::new();
    let mut entry_scene = None;
    for item in &module.items {
        match &item.kind {
            ItemKind::Const(decl) => {
                let symbol = Symbol::item(&path, &decl.name.name);
                items.push(Item::Const(lowering.constant(decl, symbol)?));
            }
            ItemKind::Scene(decl) => {
                let def = resolution
                    .def_of(decl.id)
                    .ok_or_else(|| format!("scene '{}' has no declaration", decl.name.name))?;
                let checked = types
                    .scene(def)
                    .ok_or_else(|| format!("scene '{}' was not checked", decl.name.name))?;
                let scene = lowering.scene(decl, checked)?;
                if entry && resolution.entry_scene() == Some(def) {
                    entry_scene = Some(scene.symbol.clone());
                }
                items.push(Item::Scene(scene));
            }
            ItemKind::Import(_) => {}
            ItemKind::Struct(decl) => {
                let symbol = Symbol::item(&path, &decl.name.name);
                items.push(Item::Struct(lowering.structure(decl, symbol)?));
            }
            // Everything else is gated in this build (`E9010`), so a program
            // without errors has none of it.
            ItemKind::Fn(_) | ItemKind::Material(_) | ItemKind::Prefab(_) | ItemKind::Error => {
                return Err("a module item of a kind this build does not lower".to_owned());
            }
        }
    }
    Ok((
        Module {
            path: path.clone(),
            file: source.id().0,
            span: module.span,
            items,
        },
        entry_scene,
    ))
}

struct Lowering<'a> {
    /// The normalised path of the module, the prefix of its symbols.
    path: &'a str,
    resolution: &'a Resolution,
    types: &'a Typeck,
}

impl Lowering<'_> {
    /// A constant declaration with its folded value.
    fn constant(&self, decl: &ConstDecl, symbol: Symbol) -> Result<Const, Defect> {
        let name = &decl.name.name;
        let info = self
            .resolution
            .def_of(decl.id)
            .and_then(|def| self.types.const_info(def))
            .ok_or_else(|| format!("constant '{name}' was not checked"))?;
        let value = info
            .value
            .as_ref()
            .ok_or_else(|| format!("constant '{name}' has no value"))?;
        Ok(Const {
            name: name.clone(),
            symbol,
            ty: self.types.display(info.ty),
            value: value.into(),
            span: decl.span,
        })
    }

    /// A struct declaration with its checked field types.
    fn structure(&self, decl: &ast::StructDecl, symbol: Symbol) -> Result<StructItem, Defect> {
        let name = &decl.name.name;
        let declared = self
            .resolution
            .def_of(decl.id)
            .and_then(|def| self.types.struct_ty(def))
            .and_then(|ty| self.types.interner().struct_def(ty))
            .ok_or_else(|| format!("struct '{name}' was not checked"))?;
        if declared.fields.len() != decl.fields.len() {
            return Err(format!("struct '{name}' has fields with errors"));
        }
        Ok(StructItem {
            name: name.clone(),
            symbol,
            fields: declared
                .fields
                .iter()
                .map(|(field, ty)| StructFieldItem {
                    name: field.clone(),
                    ty: self.types.display(*ty),
                })
                .collect(),
            span: decl.span,
        })
    }

    fn scene(&self, decl: &ast::SceneDecl, checked: &CheckedScene) -> Result<Scene, Defect> {
        let symbol = Symbol::item(self.path, &checked.name);
        let what = format!("scene '{}'", checked.name);
        known_fields(&what, &checked.fields, &SCENE_FIELDS)?;
        let fields = SceneFields {
            clear_color: required(&what, &checked.fields, "clear_color", checked.span)?,
        };
        let mut constants = Vec::new();
        self.body_constants(&decl.members, &symbol, &mut constants)?;
        let mut cameras = Vec::new();
        for object in &checked.objects {
            cameras.push(self.camera(object, &symbol)?);
        }
        let mut entities = Vec::new();
        for entity in &checked.entities {
            self.entity(entity, &symbol, None, &mut entities)?;
        }
        Ok(Scene {
            name: checked.name.clone(),
            symbol,
            span: checked.span,
            fields,
            constants,
            cameras,
            entities,
        })
    }

    /// The constants of a scene body and, depth first, of its entities'
    /// bodies, in source order.
    fn body_constants(
        &self,
        members: &[SceneMember],
        scene: &Symbol,
        out: &mut Vec<Const>,
    ) -> Result<(), Defect> {
        for member in members {
            match member {
                SceneMember::Const(decl) => {
                    out.push(self.constant(decl, scene.child(&decl.name.name))?);
                }
                SceneMember::Entity(entity) => {
                    self.entity_constants(entity, &scene.child(&entity.name.name), out)?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn entity_constants(
        &self,
        entity: &ast::EntityDecl,
        symbol: &Symbol,
        out: &mut Vec<Const>,
    ) -> Result<(), Defect> {
        for member in &entity.members {
            match member {
                EntityMember::Const(decl) => {
                    out.push(self.constant(decl, symbol.child(&decl.name.name))?);
                }
                EntityMember::Entity(child) => {
                    self.entity_constants(child, &symbol.child(&child.name.name), out)?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn camera(&self, object: &CheckedObject, scene: &Symbol) -> Result<Camera, Defect> {
        let what = format!("{} '{}'", object.kind, object.name);
        if !OBJECT_KINDS.contains(&object.kind) {
            return Err(format!(
                "{what} is of a scene-object kind this build does not lower"
            ));
        }
        known_fields(&what, &object.fields, &CAMERA_FIELDS)?;
        let fields = &object.fields;
        let projection = find(&what, fields, "projection")?;
        let (value, origin, span) = parts(&what, projection, object.span)?;
        let desc = projection_desc(&what, value)?;
        Ok(Camera {
            name: object.name.clone(),
            symbol: scene.child(&object.name),
            span: object.span,
            active: object.active,
            position: required(&what, fields, "position", object.span)?,
            target: optional(&what, fields, "target", object.span)?,
            rotation: required(&what, fields, "rotation", object.span)?,
            projection: Projection { desc, origin, span },
        })
    }

    /// Append `checked` and then its children (pre-order) to `out`.
    fn entity(
        &self,
        checked: &CheckedEntity,
        owner: &Symbol,
        parent: Option<u32>,
        out: &mut Vec<Entity>,
    ) -> Result<(), Defect> {
        let what = format!("entity '{}'", checked.name);
        known_fields(&what, &checked.fields, &ENTITY_FIELDS)?;
        let fields = &checked.fields;
        let index = u32::try_from(out.len()).map_err(|_| "too many entities".to_owned())?;
        let symbol = owner.child(&checked.name);
        let mesh = match fields.iter().find(|f| f.name == "mesh") {
            Some(field) => {
                let (value, origin, span) = parts(&what, field, checked.span)?;
                Some(Mesh {
                    desc: mesh_desc(&what, value)?,
                    origin,
                    span,
                })
            }
            None => None,
        };
        let material = match fields.iter().find(|f| f.name == "material") {
            Some(field) => {
                let (value, origin, span) = parts(&what, field, checked.span)?;
                Some(material_instance(&what, value, origin, span)?)
            }
            None => None,
        };
        if mesh.is_some() != material.is_some() {
            return Err(format!(
                "{what} has a mesh without a material or the reverse"
            ));
        }
        out.push(Entity {
            index,
            name: checked.name.clone(),
            symbol: symbol.clone(),
            parent,
            span: checked.span,
            position: required(&what, fields, "position", checked.span)?,
            rotation: required(&what, fields, "rotation", checked.span)?,
            scale: required(&what, fields, "scale", checked.span)?,
            visible: required(&what, fields, "visible", checked.span)?,
            mesh,
            material,
        });
        for child in &checked.children {
            self.entity(child, &symbol, Some(index), out)?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/// Every checked field must be one the lowering knows.
fn known_fields(what: &str, fields: &[CheckedField], known: &[&str]) -> Result<(), Defect> {
    match fields.iter().find(|f| !known.contains(&f.name)) {
        Some(field) => Err(format!(
            "the field '{}' of {what} is not lowered by this build",
            field.name
        )),
        None => Ok(()),
    }
}

fn find<'f>(
    what: &str,
    fields: &'f [CheckedField],
    name: &str,
) -> Result<&'f CheckedField, Defect> {
    fields
        .iter()
        .find(|f| f.name == name)
        .ok_or_else(|| format!("{what} has no field '{name}'"))
}

/// The value, origin and span of a checked field; a default's span is the
/// declaration `owner` that holds it.
fn parts<'f>(
    what: &str,
    field: &'f CheckedField,
    owner: Span,
) -> Result<(&'f ConstValue, Origin, Span), Defect> {
    let value = field
        .value
        .as_ref()
        .ok_or_else(|| format!("the field '{}' of {what} has no value", field.name))?;
    Ok(match field.origin {
        crate::types::FieldOrigin::Written { span, .. } => (value, Origin::Written, span),
        crate::types::FieldOrigin::Default => (value, Origin::Default, owner),
    })
}

fn lower_field(what: &str, field: &CheckedField, owner: Span) -> Result<Field, Defect> {
    let (value, origin, span) = parts(what, field, owner)?;
    Ok(Field {
        source: Source::Const(value.into()),
        origin,
        span,
    })
}

/// A field every checked body of its kind has (written or defaulted).
fn required(what: &str, fields: &[CheckedField], name: &str, owner: Span) -> Result<Field, Defect> {
    lower_field(what, find(what, fields, name)?, owner)
}

/// A field without a default: present only when written.
fn optional(
    what: &str,
    fields: &[CheckedField],
    name: &str,
    owner: Span,
) -> Result<Option<Field>, Defect> {
    fields
        .iter()
        .find(|f| f.name == name)
        .map(|field| lower_field(what, field, owner))
        .transpose()
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

/// The fields of a descriptor value, in schema order.
type Fields = [(String, ConstValue)];

/// The schema name and fields of a completed descriptor value.
fn descriptor<'v>(what: &str, value: &'v ConstValue) -> Result<(&'v str, &'v Fields), Defect> {
    match value {
        ConstValue::Struct { name, fields } => Ok((name, fields)),
        _ => Err(format!("a descriptor of {what} is not a descriptor value")),
    }
}

fn member<'v>(schema: &str, fields: &'v Fields, name: &str) -> Result<&'v ConstValue, Defect> {
    fields
        .iter()
        .find(|(n, _)| n == name)
        .map(|(_, v)| v)
        .ok_or_else(|| format!("the {schema} descriptor has no field '{name}'"))
}

fn f32_member(schema: &str, fields: &Fields, name: &str) -> Result<f32, Defect> {
    match member(schema, fields, name)? {
        ConstValue::F32(v) => Ok(*v),
        _ => Err(format!("the field '{name}' of {schema} is not an f32")),
    }
}

fn u32_member(schema: &str, fields: &Fields, name: &str) -> Result<u32, Defect> {
    match member(schema, fields, name)? {
        ConstValue::U32(v) => Ok(*v),
        _ => Err(format!("the field '{name}' of {schema} is not a u32")),
    }
}

fn vec2_member(schema: &str, fields: &Fields, name: &str) -> Result<[f32; 2], Defect> {
    match member(schema, fields, name)? {
        ConstValue::Vec2(v) => Ok(*v),
        _ => Err(format!("the field '{name}' of {schema} is not a vec2")),
    }
}

fn vec3_member(schema: &str, fields: &Fields, name: &str) -> Result<[f32; 3], Defect> {
    match member(schema, fields, name)? {
        ConstValue::Vec3(v) => Ok(*v),
        _ => Err(format!("the field '{name}' of {schema} is not a vec3")),
    }
}

/// A completed mesh descriptor.
pub(super) fn mesh_desc(what: &str, value: &ConstValue) -> Result<MeshDesc, Defect> {
    let (schema, fields) = descriptor(what, value)?;
    if !MESH_SCHEMAS.contains(&schema) {
        return Err(format!(
            "the mesh {schema} of {what} is not lowered by this build"
        ));
    }
    match schema {
        "Box" => Ok(MeshDesc::Box {
            size: vec3_member(schema, fields, "size")?,
        }),
        "Sphere" => Ok(MeshDesc::Sphere {
            radius: f32_member(schema, fields, "radius")?,
            segments: u32_member(schema, fields, "segments")?,
            rings: u32_member(schema, fields, "rings")?,
        }),
        "Plane" => Ok(MeshDesc::Plane {
            size: vec2_member(schema, fields, "size")?,
        }),
        other => Err(format!(
            "the mesh {other} of {what} is not lowered by this build"
        )),
    }
}

/// A completed projection descriptor.
pub(super) fn projection_desc(what: &str, value: &ConstValue) -> Result<ProjectionDesc, Defect> {
    let (schema, fields) = descriptor(what, value)?;
    if !PROJECTION_SCHEMAS.contains(&schema) {
        return Err(format!(
            "the projection {schema} of {what} is not lowered by this build"
        ));
    }
    match schema {
        "Perspective" => Ok(ProjectionDesc::Perspective {
            fov_y: f32_member(schema, fields, "fov_y")?,
            near: f32_member(schema, fields, "near")?,
            far: f32_member(schema, fields, "far")?,
        }),
        "Orthographic" => Ok(ProjectionDesc::Orthographic {
            height: f32_member(schema, fields, "height")?,
            near: f32_member(schema, fields, "near")?,
            far: f32_member(schema, fields, "far")?,
        }),
        other => Err(format!(
            "the projection {other} of {what} is not lowered by this build"
        )),
    }
}

/// A completed material descriptor: the material's symbol and every
/// parameter in declaration order.
fn material_instance(
    what: &str,
    value: &ConstValue,
    origin: Origin,
    span: Span,
) -> Result<MaterialInstanceDesc, Defect> {
    let (name, fields) = descriptor(what, value)?;
    let schema = registry()
        .schema(name)
        .filter(|schema| schema.category == SchemaCategory::Material)
        .ok_or_else(|| format!("the material {name} of {what} is not a registry material"))?;
    let path = prelude_material_path(name)
        .ok_or_else(|| format!("no prelude source declares the material {name}"))?;
    let mut params = Vec::new();
    for (param, value) in fields {
        let def = schema
            .field(param)
            .ok_or_else(|| format!("the material {name} has no parameter '{param}'"))?;
        params.push(Param {
            name: param.clone(),
            ty: def.ty.spelling().to_owned(),
            source: Source::Const(Value::from(value)),
            span,
        });
    }
    Ok(MaterialInstanceDesc {
        material: Symbol::item(path, name),
        params,
        origin,
        span,
    })
}

/// The prelude source that declares the built-in material `name`
/// (`std/materials.mtek` for `Unlit`): its symbols are
/// `std/materials.mtek::Unlit`, like a user material's
/// `src/main.mtek::Pulse` (decision 0028).
pub(super) fn prelude_material_path(name: &str) -> Option<&'static str> {
    registry()
        .prelude_sources
        .iter()
        .find(|(_, text)| {
            let words: Vec<&str> = text.split_whitespace().collect();
            words
                .windows(2)
                .any(|pair| pair[0] == "material" && pair[1] == name)
        })
        .map(|(path, _)| *path)
}
