//! What the compiler made of a project, as the language features read it.
//!
//! A [`Snapshot`] is one run of the compiler's front end ([`mtek_compiler::analyze`]) on the
//! project with the editor's unsaved buffers over the files on disk. It is read-only: the
//! features never change it, and a new run replaces it. A [`ModuleView`] is one module of the
//! snapshot with its syntax tree, names and types; [`Nodes`] indexes a syntax tree by node id
//! and position, which the compiler's node ids and spans make cheap.

use std::path::Path;

use mtek_compiler::project::{ModuleId, ProjectRoot};
use mtek_compiler::resolve::Resolution;
use mtek_compiler::source::{FileId, ProjectPath, SourceFile};
use mtek_compiler::syntax::ast;
use mtek_compiler::syntax::{NodeInfo, walk_module};
use mtek_compiler::types::Typeck;
use mtek_compiler::{Analysis, analyze, analyze_without_edits};

use super::overlay::{Buffers, OverlayFs};
use crate::real_fs::RealFs;

/// One run of the front end.
pub struct Snapshot {
    pub analysis: Analysis,
}

impl Snapshot {
    /// Analyse the project in the directory `dir`, with `buffers` over its files. With
    /// `validate_edits` the report carries the validated suggested edits of
    /// `spec/diagnostics.md` section 6 (a whole front-end run per proposal, up to 32); without,
    /// it carries none and costs one run.
    pub fn run(dir: &Path, buffers: &Buffers, validate_edits: bool) -> Self {
        let base = RealFs::new(dir);
        let fs = OverlayFs::new(&base, buffers);
        let root = ProjectRoot::at_base();
        let analysis = if validate_edits {
            analyze(&root, &fs)
        } else {
            analyze_without_edits(&root, &fs)
        };
        Self { analysis }
    }

    /// The module `id`, with everything the front end produced for it.
    pub fn module(&self, id: ModuleId) -> Option<ModuleView<'_>> {
        let project = self.analysis.project.as_ref()?;
        let module = project.modules.get(id)?;
        let source = project.sources.get(module.file())?;
        let (ast, res, types) = if id.index() == 0 {
            (
                self.analysis.module.as_ref()?,
                self.analysis.resolution.as_ref()?,
                self.analysis.types.as_ref(),
            )
        } else {
            let unit = self
                .analysis
                .dependencies
                .iter()
                .find(|unit| unit.id == id)?;
            (&unit.module, &unit.resolution, Some(&unit.types))
        };
        Some(ModuleView {
            id,
            path: module.path(),
            source,
            ast,
            res,
            types,
        })
    }

    /// The module that is the file at `path`.
    pub fn module_at(&self, path: &ProjectPath) -> Option<ModuleView<'_>> {
        let id = self.analysis.project.as_ref()?.modules.find(path)?;
        self.module(id)
    }

    /// The module that was loaded as the file `file`.
    pub fn module_of_file(&self, file: FileId) -> Option<ModuleView<'_>> {
        let project = self.analysis.project.as_ref()?;
        let module = project
            .modules
            .modules()
            .iter()
            .find(|module| module.file() == file)?;
        self.module(module.id())
    }
}

/// One module of a [`Snapshot`].
#[derive(Clone, Copy)]
pub struct ModuleView<'a> {
    pub id: ModuleId,
    pub path: &'a ProjectPath,
    pub source: &'a SourceFile,
    pub ast: &'a ast::Module,
    pub res: &'a Resolution,
    /// `None` if the module was not type-checked (the entry module of a program the front end
    /// stopped on).
    pub types: Option<&'a Typeck>,
}

/// The syntax nodes of one module, indexed by id, with parents and children.
///
/// Built from the compiler's generic walk ([`walk_module`]), so it knows every node's id, span
/// and kind label (`"ident"`, `"name"`, `"field-access"`, `"desc"`, ... as the walk names them)
/// and how the nodes nest, but not what is inside them; what a node means comes from the name
/// resolution and the types, which are keyed by the same ids.
pub struct Nodes {
    infos: Vec<NodeInfo>,
    /// Position in `infos` of each node id; `u32::MAX` for an id that is not in the tree.
    by_id: Vec<u32>,
    parents: Vec<u32>,
    children: Vec<Vec<u32>>,
}

const NONE: u32 = u32::MAX;

impl Nodes {
    pub fn build(module: &ast::Module) -> Self {
        let mut nodes = Nodes {
            infos: Vec::new(),
            by_id: vec![NONE; module.node_count as usize],
            parents: Vec::new(),
            children: Vec::new(),
        };
        walk_module(module, &mut |info, parent| {
            let position = u32::try_from(nodes.infos.len()).unwrap_or(NONE);
            if position == NONE {
                return;
            }
            let parent_position = parent.map_or(NONE, |parent| nodes.position(parent.id.0));
            nodes.infos.push(info);
            nodes.parents.push(parent_position);
            nodes.children.push(Vec::new());
            if let Some(slot) = nodes.by_id.get_mut(info.id.index()) {
                *slot = position;
            }
            if let Some(children) = nodes.children.get_mut(parent_position as usize) {
                children.push(position);
            }
        });
        nodes
    }

    fn position(&self, id: u32) -> u32 {
        self.by_id.get(id as usize).copied().unwrap_or(NONE)
    }

    fn at(&self, position: u32) -> Option<NodeInfo> {
        self.infos.get(position as usize).copied()
    }

    /// The node `id`.
    pub fn get(&self, id: ast::NodeId) -> Option<NodeInfo> {
        self.at(self.position(id.0))
    }

    /// The node that contains `id`.
    pub fn parent(&self, id: ast::NodeId) -> Option<NodeInfo> {
        self.at(*self.parents.get(self.position(id.0) as usize)?)
    }

    /// The nodes directly inside `id`, in source order.
    pub fn children(&self, id: ast::NodeId) -> impl Iterator<Item = NodeInfo> + '_ {
        self.children
            .get(self.position(id.0) as usize)
            .into_iter()
            .flatten()
            .filter_map(|&position| self.at(position))
    }

    /// The `n`th node directly inside `id`.
    pub fn child(&self, id: ast::NodeId, n: usize) -> Option<NodeInfo> {
        self.children(id).nth(n)
    }

    /// Every node, parents before children.
    pub fn all(&self) -> impl Iterator<Item = NodeInfo> + '_ {
        self.infos.iter().copied()
    }

    /// The ancestors of `id`, innermost first.
    pub fn ancestors(&self, id: ast::NodeId) -> impl Iterator<Item = NodeInfo> + '_ {
        let mut next = self.parent(id);
        std::iter::from_fn(move || {
            let current = next?;
            next = self.parent(current.id);
            Some(current)
        })
    }

    /// The name at the byte offset `offset`: an identifier, a name expression or `self` whose
    /// span contains the offset or ends at it (the cursor right after a name).
    pub fn name_at(&self, offset: u32) -> Option<NodeInfo> {
        let is_name = |info: &NodeInfo| matches!(info.kind, "ident" | "name" | "self");
        let mut touching = None;
        for info in self.infos.iter().filter(|info| is_name(info)) {
            if info.span.start <= offset && offset < info.span.end {
                return Some(*info);
            }
            if info.span.end == offset && !info.span.is_empty() {
                touching = Some(*info);
            }
        }
        touching
    }

    /// The innermost node of kind `kind` whose span contains `offset` (the end counts).
    pub fn innermost(&self, offset: u32, kind: &str) -> Option<NodeInfo> {
        self.infos
            .iter()
            .filter(|info| {
                info.kind == kind && info.span.start <= offset && offset <= info.span.end
            })
            .min_by_key(|info| info.span.len())
            .copied()
    }
}

#[cfg(test)]
mod tests {
    use mtek_compiler::diagnostics::Diagnostics;
    use mtek_compiler::syntax::{lex_str, parse_module};

    use super::*;

    fn parse(text: &str) -> ast::Module {
        let lexed = lex_str(FileId(0), text);
        parse_module(text, &lexed.tokens, &lexed.trivia, &mut Diagnostics::new()).module
    }

    const SRC: &str = "fn f(a: f32) -> f32 { return a.x + 1.0; }\n";

    #[test]
    fn nodes_know_their_parents_children_and_ancestors() {
        let module = parse(SRC);
        let nodes = Nodes::build(&module);
        let at = |needle: &str| u32::try_from(SRC.find(needle).unwrap()).unwrap();
        // `a` in `a.x`, a name expression.
        let name = nodes.name_at(at("a.x")).unwrap();
        assert_eq!(name.kind, "name");
        let access = nodes.parent(name.id).unwrap();
        assert_eq!(access.kind, "field-access");
        let kinds: Vec<&str> = nodes.children(access.id).map(|n| n.kind).collect();
        assert_eq!(kinds, ["name", "ident"]);
        let ancestors: Vec<&str> = nodes.ancestors(name.id).map(|n| n.kind).collect();
        assert_eq!(
            ancestors,
            [
                "field-access",
                "binary",
                "return",
                "block",
                "fn",
                "item",
                "module"
            ]
        );
        assert_eq!(nodes.child(access.id, 1).unwrap().kind, "ident");
        assert!(nodes.child(access.id, 2).is_none());
        assert!(nodes.parent(module.id).is_none());
    }

    #[test]
    fn a_name_is_found_inside_it_and_right_after_it_but_not_before_it() {
        let module = parse(SRC);
        let nodes = Nodes::build(&module);
        let start = u32::try_from(SRC.find("return").unwrap()).unwrap() + 7;
        // `a` of `a.x` is [start, start + 1).
        assert!(nodes.name_at(start).is_some());
        assert!(nodes.name_at(start + 1).is_some(), "just after the name");
        assert_eq!(nodes.name_at(start + 1).unwrap().span.start, start);
        assert!(nodes.name_at(start - 1).is_none(), "a space before it");
        assert!(nodes.name_at(u32::MAX).is_none());
        // On the dot, between `a` and `x`: `a` ends there.
        assert_eq!(nodes.name_at(start + 1).map(|n| n.kind), Some("name"));
        assert_eq!(nodes.name_at(start + 2).map(|n| n.kind), Some("ident"));
    }

    #[test]
    fn innermost_finds_the_smallest_enclosing_node_of_a_kind() {
        let module = parse("fn f() { if true { let a = 1; } }");
        let nodes = Nodes::build(&module);
        let text = "fn f() { if true { let a = 1; } }";
        let inside = u32::try_from(text.find("let").unwrap()).unwrap();
        let block = nodes.innermost(inside, "block").unwrap();
        assert!(
            block.span.start > 8,
            "the inner block, not the function body"
        );
        assert!(nodes.innermost(inside, "scene").is_none());
    }

    #[test]
    fn an_empty_or_broken_module_is_fine() {
        for text in ["", "}}}{{{", "fn", "scene {", "const x = ;"] {
            let module = parse(text);
            let nodes = Nodes::build(&module);
            assert!(nodes.all().count() >= 1, "{text:?}");
            let _ = nodes.name_at(0);
            let _ = nodes.innermost(0, "block");
        }
    }
}
