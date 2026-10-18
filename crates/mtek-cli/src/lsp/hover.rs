//! Hover: the declaration, the type, the documentation (decision 0076 item 7).
//!
//! The text is Markdown: a code block with the declaration as Mtek writes it, then the facts the
//! compiler knows (an imported name says where it comes from), then the documentation comment
//! of the declaration (`///`, `spec/language.md` section 1.5) or, for a standard-library item,
//! the registry's documentation ([`prelude_doc::hover`]).

use mtek_compiler::resolve::{Def, DefKind};
use mtek_compiler::source::Span;
use mtek_compiler::syntax::lex;

use super::analysis::{ModuleView, Nodes, Snapshot};
use super::prelude_doc;
use super::semantic::{Referent, declaration_text, referent_at};

/// A hover: Markdown for the span of the name it is about.
#[derive(Clone, PartialEq, Debug)]
pub struct Hover {
    pub markdown: String,
    pub span: Span,
}

/// The hover at the byte offset `offset` of `view`.
pub fn hover_at(snapshot: &Snapshot, view: &ModuleView<'_>, offset: u32) -> Option<Hover> {
    let nodes = Nodes::build(view.ast);
    if let Some((referent, span)) = referent_at(snapshot, view, &nodes, offset) {
        let markdown = referent_markdown(snapshot, view, &referent)?;
        return Some(Hover { markdown, span });
    }
    expression_hover(view, &nodes, offset)
}

/// The type of the innermost typed expression at `offset`, for a literal, an operator or a
/// call that is not a name.
fn expression_hover(view: &ModuleView<'_>, nodes: &Nodes, offset: u32) -> Option<Hover> {
    let types = view.types?;
    let node = nodes
        .all()
        .filter(|info| {
            matches!(
                info.kind,
                "lit"
                    | "call"
                    | "binary"
                    | "unary"
                    | "paren"
                    | "index"
                    | "array"
                    | "desc"
                    | "field-access"
            ) && info.span.start <= offset
                && offset < info.span.end
        })
        .filter(|info| types.ty(info.id).is_some())
        .min_by_key(|info| info.span.len())?;
    let ty = types.display(types.ty(node.id)?);
    let mut markdown = format!("```mtek\n{ty}\n```");
    if let Some(value) = types.value(node.id) {
        markdown.push_str(&format!("\n\nconstant value `{value}`"));
    }
    Some(Hover {
        markdown,
        span: node.span,
    })
}

/// The Markdown of a referent.
pub fn referent_markdown(
    snapshot: &Snapshot,
    view: &ModuleView<'_>,
    referent: &Referent,
) -> Option<String> {
    match referent {
        Referent::Prelude(key) => prelude_doc::hover(*key),
        Referent::Decl { module, def } => {
            let declaring = snapshot.module(*module)?;
            let def = declaring.res.def(*def)?;
            let mut markdown = decl_markdown(&declaring, def)?;
            if *module != view.id {
                markdown.push_str(&format!("\n\n*declared in `{}`*", declaring.path));
            }
            Some(markdown)
        }
        Referent::Member {
            module,
            doc_start,
            signature,
            ..
        } => {
            let declaring = snapshot.module(*module)?;
            let mut markdown = code(signature);
            let doc = doc_comment(&declaring, *doc_start);
            if !doc.is_empty() {
                markdown.push_str("\n\n");
                markdown.push_str(&doc);
            }
            if *module != view.id {
                markdown.push_str(&format!("\n\n*declared in `{}`*", declaring.path));
            }
            Some(markdown)
        }
        Referent::Components(text) | Referent::Described(text) => Some(text.clone()),
        Referent::Typed(text) => Some(code(text)),
        Referent::Module(module) => {
            let target = snapshot.module(*module)?;
            Some(format!("module `{}`", target.path))
        }
    }
}

fn code(text: &str) -> String {
    format!("```mtek\n{text}\n```")
}

/// The documentation comment before the declaration that starts at `start`.
fn doc_comment(view: &ModuleView<'_>, start: u32) -> String {
    lex(view.source).doc_comment_before(view.source.text(), start)
}

/// Where the documentation comment of the declaration `def` is looked for: the item (so that an
/// `export` in front is part of it) or the member's own start.
fn doc_start(view: &ModuleView<'_>, def: &Def) -> u32 {
    let nodes = Nodes::build(view.ast);
    let Some(node) = nodes.get(def.node) else {
        return def.span.start;
    };
    match nodes.parent(def.node) {
        Some(parent) if parent.kind == "item" => parent.span.start,
        _ => node.span.start,
    }
}

/// The Markdown for the declaration `def` of `view`: its signature, the folded value of a
/// constant, the documentation.
fn decl_markdown(view: &ModuleView<'_>, def: &Def) -> Option<String> {
    let mut markdown = code(&decl_signature(view, def)?);
    if matches!(def.kind, DefKind::Import) {
        return Some(markdown);
    }
    let doc = doc_comment(view, doc_start(view, def));
    if !doc.is_empty() {
        markdown.push_str("\n\n");
        markdown.push_str(&doc);
    }
    Some(markdown)
}

/// The declaration as Mtek writes it, with the types the checker found.
pub(super) fn decl_signature(view: &ModuleView<'_>, def: &Def) -> Option<String> {
    let name = &def.name;
    let Some(types) = view.types else {
        return Some(format!("{} {name}", def.kind.noun()));
    };
    let ty = |id| types.display(id);
    Some(match def.kind {
        DefKind::Const => {
            let info = types.const_info(def.id)?;
            // The value as it is written (a colour literal stays `#6b5cff`), not as folded.
            let nodes = Nodes::build(view.ast);
            let value = nodes
                .children(def.node)
                .last()
                .filter(|node| node.span.start > def.span.end)
                .map(|node| format!(" = {}", declaration_text(view, node.span)))
                .unwrap_or_default();
            format!("const {name}: {}{value}", ty(info.ty))
        }
        DefKind::Fn => {
            let info = types.function(def.id)?;
            let params: Vec<String> = info
                .sig
                .params
                .iter()
                .map(|(param, id)| format!("{param}: {}", ty(*id)))
                .collect();
            let cpu = if info.sig.cpu { "cpu " } else { "" };
            let ret = if info.sig.ret == mtek_compiler::types::TyId::UNIT {
                String::new()
            } else {
                format!(" -> {}", ty(info.sig.ret))
            };
            format!("{cpu}fn {name}({}){ret}", params.join(", "))
        }
        DefKind::Struct => {
            let id = types.struct_ty(def.id)?;
            let fields: Vec<String> = types
                .interner()
                .struct_def(id)?
                .fields
                .iter()
                .map(|(field, id)| format!("    {field}: {};", ty(*id)))
                .collect();
            if fields.is_empty() {
                format!("struct {name} {{}}")
            } else {
                format!("struct {name} {{\n{}\n}}", fields.join("\n"))
            }
        }
        DefKind::Material => {
            let info = types.material(def.id)?;
            let params: Vec<String> = info
                .params
                .iter()
                .map(|param| format!("    {};", declaration_text(view, param.span)))
                .collect();
            if params.is_empty() {
                format!("material {name}")
            } else {
                format!("material {name} {{\n{}\n}}", params.join("\n"))
            }
        }
        DefKind::Prefab => {
            let info = types.prefab(def.id)?;
            let mut lines: Vec<String> = info
                .params
                .iter()
                .map(|param| format!("    {};", declaration_text(view, param.span)))
                .collect();
            lines.extend(
                info.states
                    .iter()
                    .map(|(state, id)| format!("    state {state}: {};", ty(*id))),
            );
            if lines.is_empty() {
                format!("prefab {name}")
            } else {
                format!("prefab {name} {{\n{}\n}}", lines.join("\n"))
            }
        }
        DefKind::Scene => format!("scene {name}"),
        DefKind::Import => format!("import {{ {name} }}"),
        DefKind::State => {
            let state = types.state(def.id)?;
            format!("state {name}: {}", ty(state.ty))
        }
        DefKind::Param => {
            let parent = def.parent.and_then(|parent| view.res.def(parent))?;
            match parent.kind {
                DefKind::Material => {
                    declaration_text(view, types.material(parent.id)?.param(name)?.span)
                }
                DefKind::Prefab => {
                    declaration_text(view, types.prefab(parent.id)?.param(name)?.span)
                }
                _ => format!("param {name}"),
            }
        }
        DefKind::FnParam => format!("{name}: {}", ty(types.local_ty(def.id)?)),
        DefKind::Local { mutable } => {
            let keyword = if mutable { "var" } else { "let" };
            format!("{keyword} {name}: {}", ty(types.local_ty(def.id)?))
        }
        DefKind::LoopVar => format!("for {name}: {}", ty(types.local_ty(def.id)?)),
        DefKind::Entity => format!("entity {name}"),
        DefKind::SceneObject { kind } => format!("{} {name}", kind.unwrap_or("object")),
    })
}
