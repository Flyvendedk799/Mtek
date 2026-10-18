//! Go to definition (decision 0076 item 8).
//!
//! A name of the program goes to its declaration; an imported name goes through the import to
//! the declaration in the module that exports it (the import's specifier goes to the module
//! itself); a field goes to its declaration in a struct, material or prefab, or to the field in
//! the standard-library reference; a name of the standard library goes to a virtual, read-only
//! document of the `mtek-prelude:` scheme (`prelude_doc`).

use mtek_compiler::project::ModuleId;
use mtek_compiler::source::Span;

use super::analysis::{ModuleView, Nodes, Snapshot};
use super::prelude_doc::{self, Location};
use super::semantic::{Referent, referent_at};

/// Where a definition is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Target {
    /// A span of a module of the project.
    Source { module: ModuleId, span: Span },
    /// The start of a module of the project (an import's target).
    Module(ModuleId),
    /// A span of a virtual document of the standard library.
    Prelude(Location),
}

/// The definition of the name at the byte offset `offset` of `view`.
pub fn definition_at(snapshot: &Snapshot, view: &ModuleView<'_>, offset: u32) -> Option<Target> {
    let nodes = Nodes::build(view.ast);
    let (referent, _) = referent_at(snapshot, view, &nodes, offset)?;
    match referent {
        Referent::Decl { module, def } => {
            let span = snapshot.module(module)?.res.def(def)?.span;
            Some(Target::Source { module, span })
        }
        Referent::Member { module, span, .. } => Some(Target::Source { module, span }),
        Referent::Prelude(key) => prelude_doc::location(key).map(Target::Prelude),
        Referent::Module(module) => Some(Target::Module(module)),
        Referent::Components(_) | Referent::Typed(_) | Referent::Described(_) => None,
    }
}
