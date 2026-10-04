//! Binding imported names to the exports of the imported module
//! (`spec/language.md` sections 9.1 and 9.2, decision 0036).
//!
//! [`bind_imports`] looks every name of every `import { … }` of one module up
//! among the items of the module it imports, before that module is resolved:
//! exports are a syntactic property (the `export` keyword in front of a
//! module item), so binding needs only the imported module's syntax tree.
//! A name the target does not export is `E2033`, at the name:
//!
//! * declared there without `export`: a related span at the declaration and
//!   help to add `export` (this includes the entry module's scene, which may
//!   omit `export` only because nothing imports it);
//! * imported there itself: imported names cannot be exported again
//!   (`export` cannot precede `import`), a related span at that import;
//! * not declared there: a "did you mean" naming the one exported item within
//!   edit distance 2, if there is exactly one.
//!
//! Imports whose module could not be loaded have been reported by the loader
//! and bind nothing. A name that binds nothing still declares the name in the
//! importing module (so it is not also "unknown"), and its uses resolve to
//! [`Res::Error`](super::Res::Error) without a further diagnostic.

use std::collections::BTreeMap;

use super::defs::{DefKind, ImportTarget};
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::project::{ImportLink, LoadedModule, ModuleGraph, edit_distance};
use crate::source::Span;
use crate::syntax::ast::{Ident, Item, ItemKind, Module, NodeId};

/// The bindings of one module's imported names, by the node of the name in
/// the `import` list.
pub type ImportBindings = BTreeMap<NodeId, ImportTarget>;

/// Bind the imported names of `module`, whose imports led where `links`
/// says, to the exports of the modules of `loaded` (indexed by
/// [`ModuleId::index`]; paths from `graph`). Reports `E2033` to `sink`.
#[must_use]
pub fn bind_imports(
    module: &Module,
    links: &[ImportLink],
    loaded: &[LoadedModule],
    graph: &ModuleGraph,
    sink: &mut Diagnostics,
) -> ImportBindings {
    let mut bindings = ImportBindings::new();
    for item in &module.items {
        let ItemKind::Import(decl) = &item.kind else {
            continue;
        };
        let Some(target) = links
            .iter()
            .find(|link| link.decl == decl.id)
            .and_then(|link| link.target)
        else {
            continue;
        };
        let Some(exporter) = loaded.get(target.index()) else {
            continue;
        };
        let path = graph
            .get(target)
            .map_or_else(String::new, |m| m.path().as_str().to_owned());
        for name in &decl.names {
            if name.name.is_empty() || name.name == "_" {
                continue;
            }
            match lookup(&exporter.ast, &name.name) {
                Lookup::Exported(kind, node, span) => {
                    bindings.insert(
                        name.id,
                        ImportTarget {
                            module: target,
                            node,
                            kind,
                            span,
                        },
                    );
                }
                Lookup::NotExported(kind, span) => {
                    let noun = kind.noun();
                    sink.push(
                        Diagnostic::new(
                            Code::E2033,
                            format!("'{}' is not exported by '{path}'.", name.name),
                        )
                        .at(name.span)
                        .related(
                            span,
                            format!(
                                "the {noun} '{}' is declared here without `export`",
                                name.name
                            ),
                        )
                        .help(format!(
                            "write `export` in front of the declaration in '{path}' to make it importable"
                        )),
                    );
                }
                Lookup::Imported(span) => {
                    sink.push(
                        Diagnostic::new(
                            Code::E2033,
                            format!(
                                "'{}' is imported by '{path}', not declared there, so '{path}' does not export it.",
                                name.name
                            ),
                        )
                        .at(name.span)
                        .related(span, format!("'{}' is imported here", name.name))
                        .note("imported names cannot be exported again")
                        .help("import the name from the module that declares it"),
                    );
                }
                Lookup::Missing => sink.push(missing(&exporter.ast, &path, name)),
            }
        }
    }
    bindings
}

/// What a module has under a name.
enum Lookup {
    /// An exported item: its kind, declaring node and name span.
    Exported(DefKind, NodeId, Span),
    /// An item declared without `export`.
    NotExported(DefKind, Span),
    /// A name the module imports (the span of that imported name).
    Imported(Span),
    Missing,
}

/// The module item of `module` named `name` (the first, if a duplicate was
/// reported).
fn lookup(module: &Module, name: &str) -> Lookup {
    for item in &module.items {
        if let Some((kind, node, ident)) = declared(item)
            && ident.name == name
        {
            return if item.export {
                Lookup::Exported(kind, node, ident.span)
            } else {
                Lookup::NotExported(kind, ident.span)
            };
        }
    }
    for item in &module.items {
        if let ItemKind::Import(decl) = &item.kind
            && let Some(ident) = decl.names.iter().find(|ident| ident.name == name)
        {
            return Lookup::Imported(ident.span);
        }
    }
    Lookup::Missing
}

/// The kind, declaring node and name of a declaring module item.
fn declared(item: &Item) -> Option<(DefKind, NodeId, &Ident)> {
    Some(match &item.kind {
        ItemKind::Const(decl) => (DefKind::Const, decl.id, &decl.name),
        ItemKind::Fn(decl) => (DefKind::Fn, decl.id, &decl.name),
        ItemKind::Struct(decl) => (DefKind::Struct, decl.id, &decl.name),
        ItemKind::Material(decl) => (DefKind::Material, decl.id, &decl.name),
        ItemKind::Prefab(decl) => (DefKind::Prefab, decl.id, &decl.name),
        ItemKind::Scene(decl) => (DefKind::Scene, decl.id, &decl.name),
        ItemKind::Import(_) | ItemKind::Error => return None,
    })
}

/// `E2033` for a name the target neither declares nor imports.
fn missing(exporter: &Module, path: &str, name: &Ident) -> Diagnostic {
    let exported: Vec<&Ident> = exporter
        .items
        .iter()
        .filter(|item| item.export)
        .filter_map(|item| declared(item).map(|(_, _, ident)| ident))
        .collect();
    let mut diagnostic = Diagnostic::new(
        Code::E2033,
        format!("'{path}' does not export '{}'.", name.name),
    )
    .at(name.span);
    let close: Vec<&&Ident> = exported
        .iter()
        .filter(|ident| (1..=2).contains(&edit_distance(&name.name, &ident.name)))
        .collect();
    if let [single] = close.as_slice() {
        diagnostic = diagnostic.related(single.span, format!("did you mean '{}'?", single.name));
    }
    if exported.is_empty() {
        diagnostic.note(format!("'{path}' exports nothing"))
    } else {
        let mut names: Vec<&str> = exported.iter().map(|ident| ident.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        diagnostic.note(format!("'{path}' exports: {}", names.join(", ")))
    }
}
