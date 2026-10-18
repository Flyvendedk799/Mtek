//! Completion (decision 0076 item 9).
//!
//! Completion is asked of text that is, by definition, unfinished. Instead of guessing the
//! context from the characters around the cursor, the server asks the compiler: [`prepare`]
//! makes the buffer parse as well as it can (a placeholder identifier at the cursor when no
//! name is being typed), the front end runs on it like on any buffer, and [`candidates`] reads
//! the context off the syntax tree around the placeholder and the candidates off the resolver,
//! the checker and the registry:
//!
//! | The cursor is | Candidates |
//! |---|---|
//! | after `Name.` | the members of what `Name` is: enum members (`Key.`), namespace members (`quat.`), the fields and `state` of an entity or object (`Cube.`, `self.`), the params of its material (`Cube.material.`), light and body, the components of a vector, the fields of a struct or record |
//! | at a field name of a descriptor (`Box { | }`, `Pulse { | }`) | the fields of the schema, the params of the material or prefab, the fields of the struct, without the ones already written |
//! | at a member of a scene, entity, object, prefab or material body | the fields of its schema (not yet written) and the member keywords |
//! | where a value is written | the names in scope (parameters, locals, `state`, constants, functions, entities, imports), the standard library (intrinsic functions, namespaces, enums, descriptor schemas, constructors) and, at the start of a statement, the statement keywords |
//! | in a type | the standard-library types and the structs in scope |
//! | after `on` | the events of the registry |
//! | after `entity Name:` | the prefabs in scope |
//!
//! Items whose registry milestone this build has not reached are left out (using them is
//! `E9010`).

use std::path::Path;
use std::sync::Arc;

use lsp_types::CompletionItemKind;
use mtek_compiler::resolve::gate::is_implemented;
use mtek_compiler::resolve::{Def, DefId, DefKind, PreludeItem, Res};
use mtek_compiler::source::{FileId, ProjectPath};
use mtek_compiler::stdlib::{
    FieldDef, IntrinsicDef, NamespaceMember, SchemaCategory, TypeKind, registry,
};
use mtek_compiler::syntax::{NodeInfo, TokenKind, TriviaKind, lex_str};
use mtek_compiler::types::TyId;
use mtek_compiler::types::ty::Ty;

use super::analysis::{ModuleView, Nodes, Snapshot};
use super::hover::decl_signature;
use super::overlay::Buffers;
use super::semantic::{Referent, follow_import, material_info, text};

/// The identifier put at the cursor when no name is being typed there.
pub const PLACEHOLDER: &str = "__mtek_completion__";

/// What to analyse for a completion request.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Prepared {
    /// The buffer with the placeholder inserted at the cursor, if none was needed `None` (the
    /// cursor is in or right after a name, which is already in the text).
    pub patched: Option<String>,
    /// The byte offset where the name being completed starts in the text that is analysed.
    pub anchor: u32,
    /// The byte range of the buffer that a chosen candidate replaces: the part of the name
    /// before the cursor (empty at the cursor when no name is being typed).
    pub replace: (u32, u32),
}

/// What the cursor needs, or `None` when nothing can be completed there (in a comment, in a
/// string or a number).
pub fn prepare(text: &str, offset: u32) -> Option<Prepared> {
    let offset = clamp_to_boundary(text, offset);
    let lexed = lex_str(FileId(0), text);
    for comment in lexed.trivia.items() {
        let (start, end) = (comment.span.start, comment.span.end);
        let inside = match comment.kind {
            TriviaKind::LineComment | TriviaKind::DocComment => start < offset && offset <= end,
            TriviaKind::BlockComment => start < offset && offset < end,
        };
        if inside {
            return None;
        }
    }
    for token in &lexed.tokens {
        let (start, end) = (token.span.start, token.span.end);
        // The cursor right before a name (`Key.|Space`): that name is the context, and the
        // candidates replace nothing.
        if start == offset && (token.kind == TokenKind::Ident || token.kind.is_keyword()) {
            return Some(Prepared {
                patched: None,
                anchor: offset,
                replace: (offset, offset),
            });
        }
        if !(start < offset && offset <= end) {
            continue;
        }
        match token.kind {
            TokenKind::Ident => {
                return Some(Prepared {
                    patched: None,
                    anchor: start,
                    replace: (start, offset),
                });
            }
            kind if kind.is_keyword() => {
                return Some(Prepared {
                    patched: None,
                    anchor: start,
                    replace: (start, offset),
                });
            }
            TokenKind::String => {
                if offset < end
                    || !text
                        .get(start as usize..end as usize)
                        .is_some_and(|t| t.len() >= 2 && t.ends_with('"'))
                {
                    return None;
                }
            }
            TokenKind::Int | TokenKind::Float | TokenKind::Color => return None,
            _ => {}
        }
    }
    let (before, after) = text.split_at(offset as usize);
    Some(Prepared {
        patched: Some(format!("{before}{PLACEHOLDER}{after}")),
        anchor: offset,
        replace: (offset, offset),
    })
}

fn clamp_to_boundary(text: &str, offset: u32) -> u32 {
    let mut offset = (offset as usize).min(text.len());
    while !text.is_char_boundary(offset) {
        offset -= 1;
    }
    u32::try_from(offset).unwrap_or(u32::MAX)
}

#[cfg(test)]
/// The completion at the byte offset `offset` of `text`, the buffer of the module `path` of the
/// project in `dir` (`buffers` are all the open buffers, `text` among them). `current` is the
/// snapshot of exactly these buffers, if the caller has it: it is used when the text needs no
/// placeholder, and saves a run of the front end.
pub fn complete(
    dir: &Path,
    buffers: &Buffers,
    path: &ProjectPath,
    text: &str,
    offset: u32,
    current: Option<&Snapshot>,
) -> Option<Completion> {
    let prepared = prepare(text, offset)?;
    complete_prepared(&prepared, dir, buffers, path, text, current)
}

/// [`complete`] for text that [`prepare`] has already looked at: `current` is used when
/// `prepared` needs no placeholder.
pub fn complete_prepared(
    prepared: &Prepared,
    dir: &Path,
    buffers: &Buffers,
    path: &ProjectPath,
    text: &str,
    current: Option<&Snapshot>,
) -> Option<Completion> {
    let fresh;
    let snapshot = match (&prepared.patched, current) {
        (None, Some(current)) => current,
        (patched, _) => {
            let mut buffers = buffers.clone();
            buffers.insert(path.clone(), Arc::from(patched.as_deref().unwrap_or(text)));
            fresh = Snapshot::run(dir, &buffers, false);
            &fresh
        }
    };
    let view = snapshot.module_at(path)?;
    Some(Completion {
        candidates: candidates(snapshot, &view, prepared.anchor),
        replace: prepared.replace,
    })
}

/// The candidates of [`complete`] and the byte range of the buffer they replace.
#[derive(Clone, PartialEq, Debug)]
pub struct Completion {
    pub candidates: Vec<Candidate>,
    pub replace: (u32, u32),
}

/// One completion candidate.
#[derive(Clone, PartialEq, Debug)]
pub struct Candidate {
    pub label: String,
    pub kind: CompletionItemKind,
    /// The declaration or type, one line.
    pub detail: Option<String>,
    /// Markdown.
    pub documentation: Option<String>,
    /// Orders the candidates: names of the program before the standard library, keywords last.
    pub group: u8,
}

impl Candidate {
    fn new(label: impl Into<String>, kind: CompletionItemKind, group: u8) -> Self {
        Self {
            label: label.into(),
            kind,
            detail: None,
            documentation: None,
            group,
        }
    }

    fn detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    fn doc(mut self, doc: &str) -> Self {
        if !doc.is_empty() {
            self.documentation = Some(doc.to_owned());
        }
        self
    }
}

/// The kind of place a name is wanted.
#[derive(Clone, Debug)]
enum Context {
    /// After `base.`.
    Member {
        base: NodeInfo,
    },
    /// A field name in the body or descriptor `owner`.
    FieldName {
        owner: NodeInfo,
    },
    /// A member of the body of `owner`, or a module item (`owner` is the module node).
    MemberStart {
        owner: NodeInfo,
    },
    /// A value.
    Expression {
        statement_start: bool,
    },
    Type,
    Event,
    Prefab,
    Nothing,
}

/// The candidates at the name that starts at `anchor` of `view`, which is the module of the
/// text that was analysed ([`Prepared`]).
pub fn candidates(snapshot: &Snapshot, view: &ModuleView<'_>, anchor: u32) -> Vec<Candidate> {
    let nodes = Nodes::build(view.ast);
    let mut out = match context(&nodes, anchor) {
        Context::Member { base } => member_candidates(snapshot, view, &nodes, base),
        Context::FieldName { owner } => field_candidates(snapshot, view, &nodes, owner, anchor),
        Context::MemberStart { owner } => {
            member_start_candidates(snapshot, view, &nodes, owner, anchor)
        }
        Context::Expression { statement_start } => {
            expression_candidates(snapshot, view, &nodes, anchor, statement_start)
        }
        Context::Type => type_candidates(snapshot, view, &nodes, anchor),
        Context::Event => registry()
            .events
            .iter()
            .filter(|event| is_implemented(event.since))
            .map(|event| Candidate::new(event.name, CompletionItemKind::EVENT, 1).doc(event.doc))
            .collect(),
        Context::Prefab => defs_of_kind(snapshot, view, &nodes, anchor, |kind| {
            kind == DefKind::Prefab
        }),
        Context::Nothing => Vec::new(),
    };
    out.sort_by(|a, b| (a.group, &a.label).cmp(&(b.group, &b.label)));
    out.dedup_by(|a, b| a.label == b.label && a.kind == b.kind);
    out
}

/// The context of the name at `anchor`.
fn context(nodes: &Nodes, anchor: u32) -> Context {
    let name = nodes
        .all()
        .find(|info| matches!(info.kind, "ident" | "name") && info.span.start == anchor);
    if let Some(name) = name
        && let Some(parent) = nodes.parent(name.id)
    {
        let index = nodes
            .children(parent.id)
            .position(|child| child.id == name.id);
        return match (parent.kind, index) {
            ("field-access", Some(1)) => match nodes.child(parent.id, 0) {
                Some(base) => Context::Member { base },
                None => Context::Nothing,
            },
            ("type", _) => Context::Type,
            ("desc", Some(0)) => Context::Expression {
                statement_start: false,
            },
            ("field", Some(0)) => nodes
                .parent(parent.id)
                .map_or(Context::Nothing, |owner| Context::FieldName { owner }),
            ("init", Some(0)) => nodes.parent(parent.id).map_or(Context::Nothing, |owner| {
                // A scene, entity or prefab body also takes keywords; an object's body only fields.
                if owner.kind == "object" {
                    Context::FieldName { owner }
                } else {
                    Context::MemberStart { owner }
                }
            }),
            ("on", Some(0)) => Context::Event,
            ("entity", Some(1)) => Context::Prefab,
            ("object", Some(0)) => nodes
                .parent(parent.id)
                .map_or(Context::Nothing, |owner| Context::MemberStart { owner }),
            ("expr-stmt", _) => Context::Expression {
                statement_start: true,
            },
            _ if name.kind == "name" => Context::Expression {
                statement_start: false,
            },
            _ => Context::Nothing,
        };
    }
    // No name in the tree there (the parser dropped it): the innermost body around the cursor.
    let owner = nodes
        .all()
        .filter(|info| {
            matches!(
                info.kind,
                "desc" | "entity" | "prefab" | "scene" | "object" | "material" | "block" | "module"
            ) && info.span.start < anchor
                && anchor <= info.span.end
        })
        .min_by_key(|info| info.span.len());
    match owner {
        Some(owner) => match owner.kind {
            "desc" | "object" => Context::FieldName { owner },
            "block" => Context::Expression {
                statement_start: true,
            },
            _ => Context::MemberStart { owner },
        },
        None => Context::Nothing,
    }
}

// ---------------------------------------------------------------------------
// Members: `base.|`
// ---------------------------------------------------------------------------

fn member_candidates(
    snapshot: &Snapshot,
    view: &ModuleView<'_>,
    nodes: &Nodes,
    base: NodeInfo,
) -> Vec<Candidate> {
    let registry = registry();
    if matches!(base.kind, "name" | "self") {
        match view.res.res(base.id) {
            Some(Res::Prelude(PreludeItem::Enum(name))) => return enum_members(name),
            Some(Res::Prelude(PreludeItem::Namespace(name))) => return namespace_members(name),
            Some(Res::Def(def)) => match view.res.def(def).map(|d| d.kind) {
                Some(DefKind::Entity) => {
                    return entity_members(view, def, registry.declaration_schemas.entity);
                }
                Some(DefKind::SceneObject {
                    kind: Some(keyword),
                }) => {
                    if let Some(kind) = registry.scene_object(keyword) {
                        return schema_fields(kind.schema, &[], 1);
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }
    let Some(types) = view.types else {
        return Vec::new();
    };
    // `Cube.material.`, `Cube.light.` and `Cube.body.`: the checker types the first two, and
    // reads the third as part of the call or property it belongs to, so the entity and the
    // member are read off the syntax.
    if base.kind == "field-access"
        && let (Some(owner), Some(member)) = (nodes.child(base.id, 0), nodes.child(base.id, 1))
        && matches!(owner.kind, "name" | "self")
        && let Some(Res::Def(entity)) = view.res.res(owner.id)
        && view
            .res
            .def(entity)
            .is_some_and(|d| d.kind == DefKind::Entity)
    {
        match text(view, member.span) {
            Some("material") => {
                if let Some(material) = types.entity_material(entity) {
                    return type_members(snapshot, view, material);
                }
            }
            Some("light") => {
                if let Some(schema) = types.entity_light(entity) {
                    return schema_fields(schema, &[], 1);
                }
            }
            Some("body") => {
                if let Some((kind, _)) = types.entity_physics(entity).and_then(|p| p.body) {
                    return body_members(kind);
                }
            }
            _ => {}
        }
    }
    match types.ty(base.id) {
        Some(ty) => type_members(snapshot, view, ty),
        None => Vec::new(),
    }
}

fn enum_members(name: &str) -> Vec<Candidate> {
    registry()
        .enum_def(name)
        .map(|e| {
            e.members
                .iter()
                .filter(|m| is_implemented(m.since))
                .map(|m| {
                    Candidate::new(m.name, CompletionItemKind::ENUM_MEMBER, 0)
                        .detail(format!("{name} (KeyboardEvent.code `{}`)", m.code))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn namespace_members(name: &str) -> Vec<Candidate> {
    registry()
        .namespace(name)
        .map(|namespace| {
            namespace
                .members
                .iter()
                .filter(|m| is_implemented(m.since()))
                .map(|member| match member {
                    NamespaceMember::Function(function) => {
                        Candidate::new(function.name, CompletionItemKind::FUNCTION, 0)
                            .detail(signatures(function))
                            .doc(function.doc)
                    }
                    NamespaceMember::Value(value) => {
                        Candidate::new(value.name, CompletionItemKind::PROPERTY, 0)
                            .detail(format!("{}: {}", value.name, value.ty.spelling()))
                            .doc(value.doc)
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The fields of an entity (or object) schema and the `state` the entity declares.
fn entity_members(view: &ModuleView<'_>, entity: DefId, schema: &str) -> Vec<Candidate> {
    let mut out = schema_fields(schema, &[], 1);
    if let Some(types) = view.types {
        for state in types.states().filter(|state| state.owner == Some(entity)) {
            out.push(
                Candidate::new(state.name.clone(), CompletionItemKind::VARIABLE, 0)
                    .detail(format!("state {}: {}", state.name, types.display(state.ty))),
            );
        }
    }
    out
}

fn body_members(kind: mtek_compiler::stdlib::BodyKind) -> Vec<Candidate> {
    let registry = registry();
    let mut out: Vec<Candidate> = registry
        .body_properties
        .iter()
        .filter(|p| p.applies_to.contains(&kind) && is_implemented(p.since))
        .map(|p| {
            Candidate::new(p.name, CompletionItemKind::PROPERTY, 0)
                .detail(format!("{}: {}", p.name, p.ty.spelling()))
                .doc(p.doc)
        })
        .collect();
    out.extend(
        registry
            .body_commands
            .iter()
            .filter(|c| c.applies_to.contains(&kind) && is_implemented(c.since))
            .map(|c| {
                let params = c
                    .params
                    .iter()
                    .map(|p| format!("{}: {}", p.name, p.ty.spelling()))
                    .collect::<Vec<_>>()
                    .join(", ");
                Candidate::new(c.name, CompletionItemKind::METHOD, 0)
                    .detail(format!("{}({params})", c.name))
                    .doc(c.doc)
            }),
    );
    out
}

fn type_members(snapshot: &Snapshot, view: &ModuleView<'_>, ty: TyId) -> Vec<Candidate> {
    let Some(types) = view.types else {
        return Vec::new();
    };
    let component = |name: &str, of: &str| {
        Candidate::new(name, CompletionItemKind::FIELD, 0)
            .detail(format!("{name}: f32 (a component of {of})"))
    };
    match types.interner().get(ty) {
        Ty::Vec2 => ["x", "y"].iter().map(|n| component(n, "vec2")).collect(),
        Ty::Vec3 => ["x", "y", "z"]
            .iter()
            .map(|n| component(n, "vec3"))
            .collect(),
        Ty::Vec4 => ["x", "y", "z", "w"]
            .iter()
            .map(|n| component(n, "vec4"))
            .collect(),
        Ty::Quat => ["x", "y", "z", "w"]
            .iter()
            .map(|n| component(n, "quat"))
            .collect(),
        Ty::Color => {
            let mut out: Vec<Candidate> = ["r", "g", "b", "a"]
                .iter()
                .map(|n| component(n, "color"))
                .collect();
            out.push(
                Candidate::new("rgb", CompletionItemKind::FIELD, 0)
                    .detail("rgb: vec3 (the colour channels)"),
            );
            out
        }
        Ty::Struct(_) => {
            // The struct's fields are in the interner of the module that holds the type.
            types
                .interner()
                .struct_def(ty)
                .map(|def| {
                    def.fields
                        .iter()
                        .map(|(name, field)| {
                            Candidate::new(name.clone(), CompletionItemKind::FIELD, 0)
                                .detail(format!("{name}: {}", types.display(*field)))
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        // The instance of a user material has its params, the instance of a built-in material
        // or a light has the fields of its schema.
        Ty::MaterialInstance(key) => material_info(snapshot, key)
            .map(|(module, info)| {
                info.params
                    .iter()
                    .map(|param| {
                        let ty = module
                            .types
                            .map_or_else(String::new, |t| t.display(param.ty));
                        Candidate::new(param.name.clone(), CompletionItemKind::PROPERTY, 0)
                            .detail(format!("param {}: {ty}", param.name))
                    })
                    .collect()
            })
            .unwrap_or_default(),
        Ty::Schema(schema) => schema_fields(schema, &[], 1),
        Ty::Record(name) => registry()
            .type_def(name)
            .map(|def| {
                def.fields
                    .iter()
                    .map(|f| {
                        Candidate::new(f.name, CompletionItemKind::FIELD, 0).detail(format!(
                            "{}: {}",
                            f.name,
                            f.ty.spelling()
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Field names and member starts
// ---------------------------------------------------------------------------

/// The names of the fields already written in the body or descriptor `owner`, except the one at
/// `anchor`: the names followed by `:` directly inside its braces. Read off the tokens, not the
/// tree, because the parser's recovery around the name being typed may have swallowed what
/// follows it.
fn written_fields(view: &ModuleView<'_>, owner: NodeInfo, anchor: u32) -> Vec<String> {
    let text = view.source.text();
    let Some(body) = text.get(owner.span.range()) else {
        return Vec::new();
    };
    let lexed = lex_str(FileId(0), body);
    let mut depth = 0u32;
    let mut written = Vec::new();
    let tokens = &lexed.tokens;
    for (index, token) in tokens.iter().enumerate() {
        match token.kind {
            TokenKind::LBrace | TokenKind::LParen | TokenKind::LBracket => depth += 1,
            TokenKind::RBrace | TokenKind::RParen | TokenKind::RBracket => {
                depth = depth.saturating_sub(1);
            }
            // A field may be named like a keyword (`material`).
            kind if depth == 1 && (kind == TokenKind::Ident || kind.is_keyword()) => {
                let is_field = tokens
                    .get(index + 1)
                    .is_some_and(|next| next.kind == TokenKind::Colon);
                let start = token.span.start.saturating_add(owner.span.start);
                if is_field && start != anchor {
                    written.push(token.text(body).to_owned());
                }
            }
            _ => {}
        }
    }
    written
}

fn field_candidates(
    snapshot: &Snapshot,
    view: &ModuleView<'_>,
    nodes: &Nodes,
    owner: NodeInfo,
    anchor: u32,
) -> Vec<Candidate> {
    let registry = registry();
    let written = written_fields(view, owner, anchor);
    match owner.kind {
        "desc" => {
            let Some(head) = nodes.child(owner.id, 0) else {
                return Vec::new();
            };
            match view.res.res(head.id) {
                Some(Res::Prelude(PreludeItem::Schema(schema))) => {
                    schema_fields(schema, &written, 0)
                }
                Some(Res::Def(def)) => match follow_import(snapshot, view, def) {
                    Referent::Decl { module, def } => {
                        declared_fields(snapshot, module, def, &written)
                    }
                    _ => Vec::new(),
                },
                _ => Vec::new(),
            }
        }
        "entity" | "prefab" => schema_fields(registry.declaration_schemas.entity, &written, 0),
        "scene" => schema_fields(registry.declaration_schemas.scene, &written, 0),
        "object" => {
            let Some(kind) = nodes.child(owner.id, 0) else {
                return Vec::new();
            };
            match view.res.res(kind.id) {
                Some(Res::Prelude(PreludeItem::SceneObject(keyword))) => registry
                    .scene_object(keyword)
                    .map(|k| schema_fields(k.schema, &written, 0))
                    .unwrap_or_default(),
                _ => Vec::new(),
            }
        }
        _ => Vec::new(),
    }
}

/// The fields of the registry schema `schema`, except `written`.
fn schema_fields(schema: &str, written: &[String], group: u8) -> Vec<Candidate> {
    registry()
        .schema(schema)
        .map(|schema| {
            schema
                .fields
                .iter()
                .filter(|field| is_implemented(field.since))
                .filter(|field| !written.iter().any(|w| w == field.name))
                .map(|field| field_candidate(field, group))
                .collect()
        })
        .unwrap_or_default()
}

fn field_candidate(field: &FieldDef, group: u8) -> Candidate {
    let mut detail = format!("{}: {}", field.name, field.ty.spelling());
    if let Some(default) = field.default_text() {
        detail.push_str(&format!(" = {default}"));
    }
    Candidate::new(field.name, CompletionItemKind::FIELD, group)
        .detail(detail)
        .doc(field.doc)
}

/// The params of the material or prefab, or the fields of the struct, `def` of `module`.
fn declared_fields(
    snapshot: &Snapshot,
    module: mtek_compiler::project::ModuleId,
    def: DefId,
    written: &[String],
) -> Vec<Candidate> {
    let Some(view) = snapshot.module(module) else {
        return Vec::new();
    };
    let (Some(declaration), Some(types)) = (view.res.def(def), view.types) else {
        return Vec::new();
    };
    let keep = |name: &str| !written.iter().any(|w| w == name);
    match declaration.kind {
        DefKind::Material => types
            .material(def)
            .map(|info| {
                info.params
                    .iter()
                    .filter(|p| keep(&p.name))
                    .map(|p| {
                        Candidate::new(p.name.clone(), CompletionItemKind::PROPERTY, 0)
                            .detail(super::semantic::declaration_text(&view, p.span))
                    })
                    .collect()
            })
            .unwrap_or_default(),
        DefKind::Prefab => types
            .prefab(def)
            .map(|info| {
                info.params
                    .iter()
                    .filter(|p| keep(&p.name))
                    .map(|p| {
                        Candidate::new(p.name.clone(), CompletionItemKind::PROPERTY, 0)
                            .detail(super::semantic::declaration_text(&view, p.span))
                    })
                    .collect()
            })
            .unwrap_or_default(),
        DefKind::Struct => types
            .struct_ty(def)
            .and_then(|ty| types.interner().struct_def(ty))
            .map(|info| {
                info.fields
                    .iter()
                    .filter(|(name, _)| keep(name))
                    .map(|(name, ty)| {
                        Candidate::new(name.clone(), CompletionItemKind::FIELD, 0)
                            .detail(format!("{name}: {}", types.display(*ty)))
                    })
                    .collect()
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

const STATEMENT_KEYWORDS: &[&str] = &[
    "let", "var", "const", "if", "for", "return", "break", "continue",
];
const LIFECYCLE_KEYWORDS: &[&str] = &["update", "fixed_update"];

fn keywords(words: &[&str]) -> Vec<Candidate> {
    words
        .iter()
        .map(|word| Candidate::new(*word, CompletionItemKind::KEYWORD, 9))
        .collect()
}

fn member_start_candidates(
    snapshot: &Snapshot,
    view: &ModuleView<'_>,
    nodes: &Nodes,
    owner: NodeInfo,
    anchor: u32,
) -> Vec<Candidate> {
    let registry = registry();
    let written = written_fields(view, owner, anchor);
    match owner.kind {
        "module" => keywords(&[
            "import", "export", "const", "fn", "cpu", "struct", "material", "prefab", "scene",
        ]),
        "scene" => {
            let mut out = schema_fields(registry.declaration_schemas.scene, &written, 0);
            out.extend(
                registry
                    .scene_objects
                    .iter()
                    .filter(|k| is_implemented(k.since))
                    .map(|k| Candidate::new(k.keyword, CompletionItemKind::KEYWORD, 8).doc(k.doc)),
            );
            out.extend(keywords(&["const", "state", "entity", "on"]));
            out.extend(keywords(LIFECYCLE_KEYWORDS));
            out
        }
        "entity" | "prefab" => {
            let mut out = schema_fields(registry.declaration_schemas.entity, &written, 0);
            // `entity First: Crate { | }`: the params of the prefab are set here too.
            if owner.kind == "entity"
                && let Some(prefab) = nodes.child(owner.id, 1).filter(|n| n.kind == "ident")
                && let Some(Res::Def(def)) = view.res.res(prefab.id)
                && let Referent::Decl { module, def } = follow_import(snapshot, view, def)
            {
                out.extend(declared_fields(snapshot, module, def, &written));
            }
            let mut words = vec!["const", "state", "entity", "on"];
            if owner.kind == "prefab" {
                words.push("param");
            }
            out.extend(keywords(&words));
            out.extend(keywords(LIFECYCLE_KEYWORDS));
            out
        }
        "material" => keywords(&["param", "fragment"]),
        _ => Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Names in scope, the prelude, types
// ---------------------------------------------------------------------------

/// The declarations of `view` visible at `offset`, in declaration order.
fn visible_defs<'a>(view: &ModuleView<'a>, nodes: &Nodes, offset: u32) -> Vec<&'a Def> {
    // The innermost entity, prefab or material around the cursor: the members of an outer
    // body are not visible in an inner one (`spec/language.md` section 4.1).
    let body = nodes
        .all()
        .filter(|info| {
            matches!(info.kind, "entity" | "prefab" | "material")
                && info.span.start < offset
                && offset <= info.span.end
        })
        .min_by_key(|info| info.span.len());
    let within = |info: &NodeInfo| info.span.start < offset && offset <= info.span.end;
    view.res
        .defs()
        .iter()
        .filter(|def| !def.name.is_empty() && def.name != "_")
        .filter(|def| {
            let Some(parent) = nodes.parent(def.node) else {
                return false;
            };
            match (def.kind, parent.kind) {
                (DefKind::Import, _) | (_, "item") => true,
                (_, "scene") => within(&parent),
                (DefKind::Entity, "entity") => nodes
                    .ancestors(def.node)
                    .find(|a| a.kind == "scene")
                    .is_some_and(|scene| within(&scene)),
                (_, "entity" | "prefab" | "material") => {
                    within(&parent) && body.is_some_and(|b| b.id == parent.id)
                }
                (_, "fn" | "stage" | "lifecycle" | "on") => within(&parent),
                (DefKind::LoopVar, _) => nodes
                    .children(def.node)
                    .find(|child| child.kind == "block")
                    .is_some_and(|block| within(&block)),
                (_, "block") => {
                    let node = nodes.get(def.node);
                    within(&parent) && node.is_some_and(|n| n.span.end <= offset)
                }
                _ => false,
            }
        })
        .collect()
}

fn def_candidate(snapshot: &Snapshot, view: &ModuleView<'_>, def: &Def) -> Candidate {
    // An imported name is what it imports.
    let (target_view, target_def): (Option<ModuleView<'_>>, Option<&Def>) =
        match follow_import(snapshot, view, def.id) {
            Referent::Decl {
                module,
                def: target,
            } => {
                let target_view = snapshot.module(module);
                let target_def = target_view.as_ref().and_then(|v| v.res.def(target));
                (target_view, target_def)
            }
            _ => (None, None),
        };
    let shown = target_def.unwrap_or(def);
    let kind = match shown.kind {
        DefKind::Const => CompletionItemKind::CONSTANT,
        DefKind::Fn => CompletionItemKind::FUNCTION,
        DefKind::Struct => CompletionItemKind::STRUCT,
        DefKind::Material | DefKind::Prefab => CompletionItemKind::CLASS,
        DefKind::Scene => CompletionItemKind::MODULE,
        _ => CompletionItemKind::VARIABLE,
    };
    let group = match def.kind {
        DefKind::Local { .. } | DefKind::LoopVar | DefKind::FnParam => 0,
        DefKind::State | DefKind::Param | DefKind::Entity | DefKind::SceneObject { .. } => 1,
        _ => 2,
    };
    let mut candidate = Candidate::new(def.name.clone(), kind, group);
    let signature_view = target_view.as_ref().unwrap_or(view);
    if let Some(signature) = decl_signature(signature_view, shown) {
        candidate = candidate.detail(signature.lines().next().unwrap_or_default());
    }
    candidate
}

fn defs_of_kind(
    snapshot: &Snapshot,
    view: &ModuleView<'_>,
    nodes: &Nodes,
    offset: u32,
    wanted: impl Fn(DefKind) -> bool,
) -> Vec<Candidate> {
    visible_defs(view, nodes, offset)
        .into_iter()
        .filter(|def| {
            let kind = match follow_import(snapshot, view, def.id) {
                Referent::Decl {
                    module,
                    def: target,
                } => snapshot
                    .module(module)
                    .and_then(|v| v.res.def(target).map(|d| d.kind)),
                _ => None,
            };
            wanted(kind.unwrap_or(def.kind))
        })
        .map(|def| def_candidate(snapshot, view, def))
        .collect()
}

fn expression_candidates(
    snapshot: &Snapshot,
    view: &ModuleView<'_>,
    nodes: &Nodes,
    anchor: u32,
    statement_start: bool,
) -> Vec<Candidate> {
    let registry = registry();
    let mut out: Vec<Candidate> = visible_defs(view, nodes, anchor)
        .into_iter()
        .filter(|def| {
            // A struct or a material is named in a descriptor, a scene is not a value.
            !matches!(def.kind, DefKind::Scene)
        })
        .map(|def| def_candidate(snapshot, view, def))
        .collect();
    out.extend(
        registry
            .intrinsics
            .iter()
            .filter(|f| is_implemented(f.since))
            .map(|f| {
                Candidate::new(f.name, CompletionItemKind::FUNCTION, 3)
                    .detail(signatures(f))
                    .doc(f.doc)
            }),
    );
    out.extend(
        registry
            .namespaces
            .iter()
            .filter(|n| is_implemented(n.since))
            .map(|n| Candidate::new(n.name, CompletionItemKind::MODULE, 3).doc(n.doc)),
    );
    out.extend(
        registry
            .enums
            .iter()
            .filter(|e| is_implemented(e.since))
            .map(|e| Candidate::new(e.name, CompletionItemKind::ENUM, 3).doc(e.doc)),
    );
    out.extend(
        registry
            .types
            .iter()
            .filter(|t| {
                is_implemented(t.since) && matches!(t.kind, TypeKind::Scalar | TypeKind::Vector)
            })
            .map(|t| {
                Candidate::new(t.name, CompletionItemKind::CONSTRUCTOR, 3)
                    .detail(format!("{}(..)", t.name))
                    .doc(t.doc)
            }),
    );
    out.extend(
        registry
            .schemas
            .iter()
            .filter(|s| is_implemented(s.since) && s.category != SchemaCategory::Object)
            .map(|s| {
                Candidate::new(s.name, CompletionItemKind::CLASS, 4)
                    .detail(format!("{} {{ .. }}", s.name))
                    .doc(s.doc)
            }),
    );
    out.extend(keywords(&["true", "false", "self"]));
    if statement_start {
        out.extend(keywords(STATEMENT_KEYWORDS));
    }
    out
}

fn type_candidates(
    snapshot: &Snapshot,
    view: &ModuleView<'_>,
    nodes: &Nodes,
    anchor: u32,
) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = registry()
        .types
        .iter()
        .filter(|t| is_implemented(t.since))
        .map(|t| {
            Candidate::new(t.name, CompletionItemKind::CLASS, 3)
                .detail(format!("type {}", t.name))
                .doc(t.doc)
        })
        .collect();
    out.extend(defs_of_kind(snapshot, view, nodes, anchor, |kind| {
        kind == DefKind::Struct
    }));
    out
}

/// `(a: T, b: T) -> T`, one line per overload joined by ` | `.
fn signatures(function: &IntrinsicDef) -> String {
    let all: Vec<String> = function
        .signatures
        .iter()
        .map(|sig| format!("{}{}", function.name, sig.text()))
        .collect();
    all.join(" | ")
}
