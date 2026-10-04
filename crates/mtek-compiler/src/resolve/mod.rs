//! Name resolution (`spec/compiler-architecture.md` section 4.6,
//! `spec/language.md` section 4, decision 0025).
//!
//! [`resolve_module`] walks one parsed module and produces a [`Resolution`]:
//! a [`DefId`] for every declaration and a side table `NodeId -> Res` for
//! every name. It reports to the [`Diagnostics`] sink:
//!
//! * `E2001` a declaration that hides a visible name (a related span at the
//!   earlier declaration; a prelude name has no span, so a note names the
//!   built-in), with the exceptions of `spec/language.md` 4.2: a local,
//!   parameter, `state` or `param` may reuse a prelude *function* (calling it
//!   there is `E2004`), and a material or prefab `param` may share its name
//!   with a prelude type (using it as a namespace there is `E2005`);
//! * `E2002` two declarations of one name in one scope (entity names are
//!   unique in their scene at every depth; entity `state` may not take the
//!   name of an `Entity` field);
//! * `E2003` an unknown name, with a "did you mean" when exactly one visible
//!   name is within edit distance 2;
//! * `E0012` `_` used as a name, `E3003` a name in type position that is not a
//!   type, `E5014` an unknown scene-object kind;
//! * `E9010` every construct and registry item this build does not implement
//!   yet ([`gate`]), once, at the outermost such construct.
//!
//! `E0013` (a reserved word used as a name) is reported by the parser wherever
//! the word appears; the resolver treats the word as an ordinary name and
//! does not report it again.
//!
//! # Scopes
//!
//! From the outside in (`spec/language.md` 4.1): the prelude (the registry);
//! the module (items and imported names); a scene (its `state`, `const`s,
//! scene objects and **all** its entities, nested ones included, flat); an
//! entity, prefab or material body (`state`, `const`, `param`; `self`);
//! the parameters of a function, stage function, lifecycle function or
//! handler; blocks (locals, visible from the end of their declaration).
//! Module, scene and body scopes do not depend on order: their names are
//! declared before anything in them is resolved. A nested entity's body sees
//! the scene, not the body of its parent entity (nesting is parenting, not
//! inheritance, `spec/scenes.md` 4.3). A prefab is a module item, so scene
//! names are unknown in it.
//!
//! # Declaration order of `DefId`s
//!
//! Ids are handed out in the order of the walk, which depends only on the
//! source: the items first, in source order; then item by item, the names of
//! each order-independent scope in source order before anything inside it
//! (a scene's constants, `state`, scene objects and entities, the entities
//! depth-first in pre-order), and parameters and locals as they are met.

mod defs;
pub mod gate;
mod resolver;
#[cfg(test)]
mod tests;

pub use defs::{Def, DefId, DefKind, PreludeItem, Res, Resolution};
pub use gate::{Construct, ConstructGate, IMPLEMENTED_MILESTONE, construct_gate};

use crate::diagnostics::Diagnostics;
use crate::syntax::ast::Module;

/// Resolve every name of `module`, reporting to `sink`. The tree may contain
/// `Error` nodes from recovery; they are skipped. Never panics.
#[must_use]
pub fn resolve_module(module: &Module, sink: &mut Diagnostics) -> Resolution {
    let mut resolver = resolver::Resolver::new(module.node_count, sink);
    resolver.module(module);
    resolver.finish()
}
