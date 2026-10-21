//! What a name in the editor refers to.
//!
//! Hover and go to definition ask the same question of the same cursor position: which thing is
//! this name? The answer is a [`Referent`]. It is read from what the compiler's front end
//! recorded, never recomputed here (`spec/compiler-architecture.md` section 4.12: the language
//! server has no second semantic implementation):
//!
//! * a name of the program resolves through [`Resolution::res`] to a declaration of a module
//!   (an imported name is followed to the declaration in the module that exports it) or to an
//!   item of the standard library;
//! * a field name (`Res::Field`) is told apart by where it stands: a member of a scene, entity
//!   or object body or of a descriptor literal is a field of a registry schema or a param of a
//!   user material or prefab; a name after a dot is whatever the type checker recorded for the
//!   access ([`FieldKind`]) or for the call it is the callee of ([`CallKind`]).

use mtek_compiler::project::ModuleId;
use mtek_compiler::resolve::{DefId, DefKind, ImportTarget, Res};
use mtek_compiler::source::Span;
use mtek_compiler::stdlib::registry;
use mtek_compiler::syntax::NodeInfo;
use mtek_compiler::types::ty::{MaterialKey, Ty};
use mtek_compiler::types::{CallKind, FieldKind, MaterialInfo};

use super::analysis::{ModuleView, Nodes, Snapshot};
use super::prelude_doc::RefKey;

/// What a name refers to.
#[derive(Clone, PartialEq, Debug)]
pub enum Referent {
    /// A declaration of a module of the project.
    Decl { module: ModuleId, def: DefId },
    /// An item of the standard library.
    Prelude(RefKey),
    /// A named member that is not a [`DefId`] declaration: a struct field, a param of a material
    /// or prefab. `span` is the declared name, `doc_start` where its declaration starts (for the
    /// documentation comment), `signature` the declaration as hover shows it.
    Member {
        module: ModuleId,
        span: Span,
        doc_start: u32,
        signature: String,
    },
    /// A component access or swizzle (`.xyz`, `.rgb`): hover only.
    Components(String),
    /// A member that has a type and no declaration to go to (the state of a static prefab
    /// instance): hover only.
    Typed(String),
    /// A contextual word of the language that is not a name (`update`, `fragment`): Markdown,
    /// hover only.
    Described(String),
    /// The module an import names.
    Module(ModuleId),
}

/// The referent of the name at `offset` and the span of the name.
pub fn referent_at(
    snapshot: &Snapshot,
    view: &ModuleView<'_>,
    nodes: &Nodes,
    offset: u32,
) -> Option<(Referent, Span)> {
    if let Some(info) = nodes.name_at(offset) {
        return referent_of_name(snapshot, view, nodes, info).map(|r| (r, info.span));
    }
    // The specifier of an import goes to the module it names.
    let specifier = nodes.innermost(offset, "str")?;
    if nodes.parent(specifier.id)?.kind != "import" {
        return None;
    }
    let project = snapshot.analysis.project.as_ref()?;
    let import = project
        .modules
        .get(view.id)?
        .imports()
        .iter()
        .find(|import| import.span == specifier.span)?;
    Some((Referent::Module(import.target), specifier.span))
}

/// The referent of the name node `info`.
pub fn referent_of_name(
    snapshot: &Snapshot,
    view: &ModuleView<'_>,
    nodes: &Nodes,
    info: NodeInfo,
) -> Option<Referent> {
    match view.res.res(info.id) {
        Some(Res::Def(def)) => Some(follow_import(snapshot, view, def)),
        Some(Res::Prelude(item)) => Some(Referent::Prelude(item.into())),
        Some(Res::Field) => field_referent(snapshot, view, nodes, info),
        Some(Res::Error) => None,
        None => None,
    }
    .or_else(|| declared_name(view, nodes, info))
    .or_else(|| contextual_word(view, nodes, info))
}

/// The name of a declaration whose name the resolver recorded no resolution for (a param of a
/// prefab): the declaration its node introduces, if this identifier is its name.
fn declared_name(view: &ModuleView<'_>, nodes: &Nodes, info: NodeInfo) -> Option<Referent> {
    let parent = nodes.parent(info.id)?;
    let def = view.res.def_of(parent.id)?;
    (view.res.def(def)?.span == info.span).then_some(Referent::Decl {
        module: view.id,
        def,
    })
}

/// The words that name a kind of member and are not names (`update`, `fixed_update`, `fragment`).
fn contextual_word(view: &ModuleView<'_>, nodes: &Nodes, info: NodeInfo) -> Option<Referent> {
    let parent = nodes.parent(info.id)?;
    let is_first = nodes.child(parent.id, 0).map(|child| child.id) == Some(info.id);
    let word = text(view, info.span)?;
    let described = match (parent.kind, word) {
        ("lifecycle", "update") => {
            "```mtek\nupdate(dt: f32) { .. }\n```\n\nA lifecycle function: runs once per rendered frame, after the fixed simulation ticks (`spec/scenes.md` section 6)."
        }
        ("lifecycle", "fixed_update") => {
            "```mtek\nfixed_update(dt: f32) { .. }\n```\n\nA lifecycle function: runs once per fixed simulation tick; `dt` is the fixed step (`spec/scenes.md` section 6)."
        }
        ("stage", "fragment") => {
            "```mtek\nfragment(input: SurfaceInput) -> color { .. }\n```\n\nThe fragment stage of a material: computes the colour of a surface point from the interpolated inputs (`spec/materials.md` section 3)."
        }
        _ => return None,
    };
    is_first.then(|| Referent::Described(described.to_owned()))
}

/// `def` of `view`, followed to the declaration an imported name denotes.
pub fn follow_import(snapshot: &Snapshot, view: &ModuleView<'_>, def: DefId) -> Referent {
    let own = Referent::Decl {
        module: view.id,
        def,
    };
    let Some(ImportTarget { module, node, .. }) = view.res.import_target(def).copied() else {
        return own;
    };
    snapshot
        .module(module)
        .and_then(|target| target.res.def_of(node))
        .map_or(own, |target_def| Referent::Decl {
            module,
            def: target_def,
        })
}

fn field_referent(
    snapshot: &Snapshot,
    view: &ModuleView<'_>,
    nodes: &Nodes,
    info: NodeInfo,
) -> Option<Referent> {
    let parent = nodes.parent(info.id)?;
    match parent.kind {
        "field-access" => access_referent(snapshot, view, nodes, parent, info),
        "init" => {
            let owner = nodes.parent(parent.id)?;
            let schema = match owner.kind {
                "entity" | "prefab" => registry().declaration_schemas.entity,
                "scene" => registry().declaration_schemas.scene,
                "object" => {
                    let kind = nodes.child(owner.id, 0)?;
                    match view.res.res(kind.id)? {
                        Res::Prelude(item) => match RefKey::from(item) {
                            RefKey::SceneObject(keyword) => {
                                registry().scene_object(keyword)?.schema
                            }
                            _ => return None,
                        },
                        _ => return None,
                    }
                }
                _ => return None,
            };
            schema_field(view, schema, info).or_else(|| {
                // `entity First: Crate { origin: ..; }`: a param of the prefab.
                let prefab = nodes
                    .child(owner.id, 1)
                    .filter(|_| owner.kind == "entity")?;
                let Res::Def(def) = view.res.res(prefab.id)? else {
                    return None;
                };
                let Referent::Decl { module, def } = follow_import(snapshot, view, def) else {
                    return None;
                };
                declared_member(snapshot, module, def, text(view, info.span)?)
            })
        }
        "field" => {
            let desc = nodes.parent(parent.id)?;
            if desc.kind != "desc" {
                return None;
            }
            let head = nodes.child(desc.id, 0)?;
            let name = text(view, info.span)?;
            match view.res.res(head.id)? {
                Res::Prelude(item) => match RefKey::from(item) {
                    RefKey::Schema(schema) => schema_field(view, schema, info),
                    _ => None,
                },
                Res::Def(def) => {
                    let Referent::Decl { module, def } = follow_import(snapshot, view, def) else {
                        return None;
                    };
                    declared_member(snapshot, module, def, name)
                }
                _ => None,
            }
        }
        "struct-field" => {
            let decl = nodes.parent(parent.id)?;
            let def = view.res.def_of(decl.id)?;
            declared_member(snapshot, view.id, def, text(view, info.span)?)
        }
        _ => None,
    }
}

/// The field `name` (the text of `info`) of the registry schema `schema`.
fn schema_field(view: &ModuleView<'_>, schema: &str, info: NodeInfo) -> Option<Referent> {
    let field = registry().schema_field(schema, text(view, info.span)?)?;
    let schema = registry().schema(schema)?;
    Some(Referent::Prelude(RefKey::SchemaField(
        schema.name,
        field.name,
    )))
}

/// The referent of the name after the dot of the access `access`.
fn access_referent(
    snapshot: &Snapshot,
    view: &ModuleView<'_>,
    nodes: &Nodes,
    access: NodeInfo,
    name: NodeInfo,
) -> Option<Referent> {
    let types = view.types?;
    let member = text(view, name.span)?;
    // A body command is a call: the access is its callee.
    if let Some(call) = nodes.parent(access.id)
        && call.kind == "call"
        && nodes.child(call.id, 0).map(|callee| callee.id) == Some(access.id)
    {
        match types.call_kind(call.id) {
            Some(CallKind::BodyCommand { command, .. }) => {
                return Some(Referent::Prelude(RefKey::BodyCommand(command)));
            }
            Some(CallKind::GlbAccessor { method }) => {
                return Some(Referent::Prelude(RefKey::TypeMethod("glb_asset", method)));
            }
            _ => {}
        }
    }
    let base = nodes.child(access.id, 0)?;
    let base_ty = types.ty(base.id).map(|ty| types.interner().get(ty));
    match types.field_kind(access.id)? {
        FieldKind::Components(_) => {
            let result = types.ty(access.id).map(|ty| types.display(ty))?;
            let base = types.ty(base.id).map(|ty| types.display(ty))?;
            Some(Referent::Components(format!(
                "`.{member}` of `{base}`: `{result}`"
            )))
        }
        FieldKind::ObjectField {
            object_def, field, ..
        } => {
            let object = view.res.def((*object_def)?)?;
            let schema = match object.kind {
                DefKind::Entity => registry().declaration_schemas.entity,
                DefKind::SceneObject {
                    kind: Some(keyword),
                } => registry().scene_object(keyword)?.schema,
                _ => return None,
            };
            let field = registry().schema_field(schema, field)?;
            Some(Referent::Prelude(RefKey::SchemaField(
                schema_name(schema)?,
                field.name,
            )))
        }
        FieldKind::EntityState {
            state: Some(state), ..
        } => Some(Referent::Decl {
            module: view.id,
            def: *state,
        }),
        FieldKind::EntityState { name, .. } => {
            let ty = types.ty(access.id).map(|ty| types.display(ty))?;
            Some(Referent::Typed(format!("state {name}: {ty}")))
        }
        FieldKind::MaterialParam { entity, param } => {
            let material = types.interner().get(types.entity_material(*entity)?);
            match material {
                Ty::MaterialInstance(key) => {
                    let (module, info) = material_info(snapshot, key)?;
                    let param = info.param(param)?;
                    Some(Referent::Member {
                        module: module.id,
                        span: param.name_span,
                        doc_start: param.span.start,
                        signature: declaration_text(&module, param.span),
                    })
                }
                Ty::Schema(schema) => {
                    let field = registry().schema_field(schema, param)?;
                    Some(Referent::Prelude(RefKey::SchemaField(
                        schema_name(schema)?,
                        field.name,
                    )))
                }
                _ => None,
            }
        }
        FieldKind::RefField { .. } => None,
        FieldKind::LightField { entity, field } => {
            let schema = types.entity_light(*entity)?;
            let field = registry().schema_field(schema, field)?;
            Some(Referent::Prelude(RefKey::SchemaField(
                schema_name(schema)?,
                field.name,
            )))
        }
        FieldKind::StructField(field) => {
            let Some(Ty::Struct(key)) = base_ty else {
                return None;
            };
            let module = snapshot.module_of_file(key.file)?;
            declared_member(snapshot, module.id, key.def, field)
        }
        FieldKind::RecordField { field, .. } => {
            let Some(Ty::Record(record)) = base_ty else {
                return None;
            };
            let ty = registry().type_def(record)?;
            let field = ty.fields.iter().find(|f| f.name == *field)?;
            Some(Referent::Prelude(RefKey::RecordField(ty.name, field.name)))
        }
        FieldKind::BodyProperty { property, .. } => {
            Some(Referent::Prelude(RefKey::BodyProperty(property)))
        }
        // `frame.time` carries the registry's own resolution on its name already.
        FieldKind::NamespaceValue(_) => None,
        FieldKind::EnumVariant { variant, index } => {
            let ty = types.ty(access.id).map(|ty| types.display(ty))?;
            Some(Referent::Typed(format!(
                "{ty}.{variant} (variant {index} of enum {ty})"
            )))
        }
    }
}

/// The registry's own `&'static` spelling of a schema name.
fn schema_name(schema: &str) -> Option<&'static str> {
    registry().schema(schema).map(|s| s.name)
}

/// The text of the source at `span`.
pub fn text<'a>(view: &ModuleView<'a>, span: Span) -> Option<&'a str> {
    view.source.slice(span.start, span.end)
}

/// The material that `key` identifies, with the module that declares it.
pub fn material_info<'a>(
    snapshot: &'a Snapshot,
    key: MaterialKey,
) -> Option<(ModuleView<'a>, &'a MaterialInfo)> {
    let module = snapshot.module_of_file(key.file)?;
    let info = module.types?.material(key.def)?;
    Some((module, info))
}

/// The member `name` of the struct, material or prefab declared as `def` in `module`: a struct
/// field, a material param or a prefab param.
pub fn declared_member(
    snapshot: &Snapshot,
    module: ModuleId,
    def: DefId,
    name: &str,
) -> Option<Referent> {
    let view = snapshot.module(module)?;
    let declaration = view.res.def(def)?;
    let types = view.types?;
    match declaration.kind {
        DefKind::Material => {
            let param = types.material(def)?.param(name)?;
            Some(Referent::Member {
                module,
                span: param.name_span,
                doc_start: param.span.start,
                signature: declaration_text(&view, param.span),
            })
        }
        DefKind::Prefab => {
            let param = types.prefab(def)?.param(name)?;
            Some(Referent::Member {
                module,
                span: param.name_span,
                doc_start: param.span.start,
                signature: declaration_text(&view, param.span),
            })
        }
        DefKind::Struct => {
            let nodes = Nodes::build(view.ast);
            let field = nodes
                .children(declaration.node)
                .filter(|child| child.kind == "struct-field")
                .find_map(|child| {
                    let ident = nodes.child(child.id, 0)?;
                    (text(&view, ident.span)? == name).then_some((ident.span, child.span.start))
                })?;
            let ty = types
                .interner()
                .struct_def(types.struct_ty(def)?)?
                .fields
                .iter()
                .find(|(field_name, _)| field_name == name)
                .map(|(_, ty)| types.display(*ty))?;
            Some(Referent::Member {
                module,
                span: field.0,
                doc_start: field.1,
                signature: format!("{name}: {ty}"),
            })
        }
        _ => None,
    }
}

/// The declaration at `span` of `view` as it is written, on one line, without its `;` and cut
/// to a length a tooltip can show: `param tint: color = #6b5cff`.
pub fn declaration_text(view: &ModuleView<'_>, span: Span) -> String {
    const LIMIT: usize = 100;
    let written = view.source.slice(span.start, span.end).unwrap_or("");
    let collapsed = written.split_whitespace().collect::<Vec<_>>().join(" ");
    let collapsed = collapsed.trim_end_matches(';').trim_end();
    if collapsed.chars().count() <= LIMIT {
        collapsed.to_owned()
    } else {
        let cut: String = collapsed.chars().take(LIMIT).collect();
        format!("{cut}\u{2026}")
    }
}
