//! The module graph of a project.
//!
//! Modules are numbered in load order: the entry module is [`ModuleId`] 0 and
//! every other module gets the next number when it is first reached, following
//! imports in source order from the entry (`spec/language.md` section 9.4). The
//! numbering, the order of every module's imports and the cycles found are
//! therefore independent of directory enumeration order, as long as the loader
//! adds modules in that traversal order.
//!
//! In M1 only the entry module is loaded and the graph has a single node;
//! imports arrive in M2 (`E9010` reports them until then). The type is
//! complete so that M2 only has to add modules and edges.

use std::collections::BTreeMap;
use std::fmt;

use crate::source::{FileId, ProjectPath, Span};

/// Modules per project (`spec/compiler-architecture.md` section 9, `E9002`).
pub const MAX_MODULES: usize = 1_024;

/// A module of the project; the index into load order.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct ModuleId(u32);

impl ModuleId {
    /// The position in load order.
    #[must_use]
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

/// One `import` of a module.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Import {
    /// The imported module.
    pub target: ModuleId,
    /// The `import` declaration (or its specifier) in the importing file.
    pub span: Span,
}

/// A loaded module.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Module {
    id: ModuleId,
    path: ProjectPath,
    file: FileId,
    imports: Vec<Import>,
}

impl Module {
    #[must_use]
    pub fn id(&self) -> ModuleId {
        self.id
    }

    /// The module's file, relative to the project root.
    #[must_use]
    pub fn path(&self) -> &ProjectPath {
        &self.path
    }

    /// The module's text in the [`SourceMap`](crate::source::SourceMap).
    #[must_use]
    pub fn file(&self) -> FileId {
        self.file
    }

    /// The module's imports in source order. The same target may appear more
    /// than once (two `import` declarations of one file).
    #[must_use]
    pub fn imports(&self) -> &[Import] {
        &self.imports
    }
}

/// Why the graph rejected an operation.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GraphError {
    /// Adding another module would exceed [`MAX_MODULES`] (`E9002`).
    TooManyModules,
    /// The id does not belong to this graph.
    UnknownModule(ModuleId),
}

impl fmt::Display for GraphError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GraphError::TooManyModules => {
                write!(f, "The project has more than {MAX_MODULES} modules.")
            }
            GraphError::UnknownModule(id) => {
                write!(f, "Module {} is not part of this module graph.", id.0)
            }
        }
    }
}

impl std::error::Error for GraphError {}

/// An import cycle (`E2035`, `spec/language.md` section 9.3).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ImportCycle {
    /// The modules of the cycle in import order: each one imports the next,
    /// and the last imports the first through [`Self::closing`]. A module
    /// that imports itself is a cycle of one.
    pub modules: Vec<ModuleId>,
    /// The import that closes the cycle: an import of the last module whose
    /// target is the first. This is where `E2035` is reported.
    pub closing: Import,
}

/// The modules of a project and their imports.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ModuleGraph {
    modules: Vec<Module>,
    by_path: BTreeMap<ProjectPath, ModuleId>,
}

impl ModuleGraph {
    /// A graph whose only module is the entry module, `path` loaded as `file`.
    #[must_use]
    pub fn new(entry_path: ProjectPath, entry_file: FileId) -> Self {
        let id = ModuleId(0);
        let entry = Module {
            id,
            path: entry_path.clone(),
            file: entry_file,
            imports: Vec::new(),
        };
        Self {
            modules: vec![entry],
            by_path: BTreeMap::from([(entry_path, id)]),
        }
    }

    /// The entry module.
    #[must_use]
    pub fn entry(&self) -> &Module {
        &self.modules[0]
    }

    /// Add the module at `path`, loaded as `file`, after all modules added so
    /// far. If `path` is already in the graph its id is returned and nothing
    /// changes: a module is loaded once however often it is imported.
    ///
    /// # Errors
    /// [`GraphError::TooManyModules`] when the graph already holds
    /// [`MAX_MODULES`] modules.
    pub fn add_module(&mut self, path: ProjectPath, file: FileId) -> Result<ModuleId, GraphError> {
        if let Some(existing) = self.by_path.get(&path) {
            return Ok(*existing);
        }
        if self.modules.len() >= MAX_MODULES {
            return Err(GraphError::TooManyModules);
        }
        let id =
            ModuleId(u32::try_from(self.modules.len()).map_err(|_| GraphError::TooManyModules)?);
        self.by_path.insert(path.clone(), id);
        self.modules.push(Module {
            id,
            path,
            file,
            imports: Vec::new(),
        });
        Ok(id)
    }

    /// Record that `from` imports `target` at `span`, after the imports of
    /// `from` recorded so far (source order).
    ///
    /// # Errors
    /// [`GraphError::UnknownModule`] if either id is not in this graph.
    pub fn add_import(
        &mut self,
        from: ModuleId,
        target: ModuleId,
        span: Span,
    ) -> Result<(), GraphError> {
        if self.get(target).is_none() {
            return Err(GraphError::UnknownModule(target));
        }
        let module = self
            .modules
            .get_mut(from.index())
            .ok_or(GraphError::UnknownModule(from))?;
        module.imports.push(Import { target, span });
        Ok(())
    }

    /// The module with this id.
    #[must_use]
    pub fn get(&self, id: ModuleId) -> Option<&Module> {
        self.modules.get(id.index())
    }

    /// The module loaded from `path`.
    #[must_use]
    pub fn find(&self, path: &ProjectPath) -> Option<ModuleId> {
        self.by_path.get(path).copied()
    }

    /// All modules in load order (the entry first).
    #[must_use]
    pub fn modules(&self) -> &[Module] {
        &self.modules
    }

    /// Number of modules; at least 1.
    #[must_use]
    pub fn len(&self) -> usize {
        self.modules.len()
    }

    /// Always false: a graph has at least its entry module. Present for the
    /// conventional `len`/`is_empty` pair.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        false
    }

    /// Every import cycle, each reported once at its closing import.
    ///
    /// A depth-first search visits modules in load order and follows imports
    /// in source order; an import whose target is on the current search path
    /// closes a cycle, made of the path from that target down to the importing
    /// module. The result is in the order the closing imports are met, so it
    /// is deterministic. Cycles that share modules may be reported separately,
    /// one per closing import.
    #[must_use]
    pub fn find_cycles(&self) -> Vec<ImportCycle> {
        #[derive(Clone, Copy, PartialEq, Eq)]
        enum Mark {
            Unvisited,
            OnPath,
            Done,
        }
        let mut marks = vec![Mark::Unvisited; self.modules.len()];
        let mut cycles = Vec::new();
        for first in &self.modules {
            if marks[first.id.index()] != Mark::Unvisited {
                continue;
            }
            // The current search path: a module and how many of its imports
            // have been followed.
            let mut path: Vec<(ModuleId, usize)> = vec![(first.id, 0)];
            marks[first.id.index()] = Mark::OnPath;
            while let Some(&(module, next)) = path.last() {
                let imports = self.modules[module.index()].imports();
                let Some(&import) = imports.get(next) else {
                    marks[module.index()] = Mark::Done;
                    path.pop();
                    continue;
                };
                if let Some(top) = path.last_mut() {
                    top.1 += 1;
                }
                match marks[import.target.index()] {
                    Mark::Unvisited => {
                        marks[import.target.index()] = Mark::OnPath;
                        path.push((import.target, 0));
                    }
                    Mark::OnPath => {
                        let start = path
                            .iter()
                            .position(|(m, _)| *m == import.target)
                            .unwrap_or(0);
                        cycles.push(ImportCycle {
                            modules: path[start..].iter().map(|(m, _)| *m).collect(),
                            closing: import,
                        });
                    }
                    Mark::Done => {}
                }
            }
        }
        cycles
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> ProjectPath {
        ProjectPath::new(s).unwrap()
    }

    fn span(n: u32) -> Span {
        Span::new(FileId(0), n, n + 1)
    }

    /// A graph of modules `m0.mtek`, `m1.mtek`, ... with the given import
    /// edges `(from, to)`; the span of an edge is its position in `edges`.
    fn graph(count: u32, edges: &[(u32, u32)]) -> ModuleGraph {
        let mut g = ModuleGraph::new(p("m0.mtek"), FileId(0));
        let ids: Vec<ModuleId> = std::iter::once(g.entry().id())
            .chain((1..count).map(|i| g.add_module(p(&format!("m{i}.mtek")), FileId(i)).unwrap()))
            .collect();
        for (n, (from, to)) in edges.iter().enumerate() {
            g.add_import(ids[*from as usize], ids[*to as usize], span(n as u32))
                .unwrap();
        }
        g
    }

    fn ids(cycle: &ImportCycle) -> Vec<usize> {
        cycle.modules.iter().map(|m| m.index()).collect()
    }

    #[test]
    fn a_new_graph_holds_only_the_entry() {
        let g = ModuleGraph::new(p("src/main.mtek"), FileId(7));
        assert_eq!(g.len(), 1);
        assert!(!g.is_empty());
        let entry = g.entry();
        assert_eq!(entry.id().index(), 0);
        assert_eq!(entry.path(), &p("src/main.mtek"));
        assert_eq!(entry.file(), FileId(7));
        assert!(entry.imports().is_empty());
        assert_eq!(g.find(&p("src/main.mtek")), Some(entry.id()));
        assert_eq!(g.find(&p("src/other.mtek")), None);
        assert!(g.find_cycles().is_empty());
        assert_eq!(g.modules().len(), 1);
    }

    #[test]
    fn modules_are_numbered_in_the_order_they_are_added() {
        let g = graph(4, &[(0, 2), (0, 1), (2, 3)]);
        let order: Vec<&str> = g.modules().iter().map(|m| m.path().as_str()).collect();
        assert_eq!(order, ["m0.mtek", "m1.mtek", "m2.mtek", "m3.mtek"]);
        let entry_imports: Vec<usize> = g
            .entry()
            .imports()
            .iter()
            .map(|i| i.target.index())
            .collect();
        assert_eq!(entry_imports, [2, 1], "imports keep their source order");
    }

    #[test]
    fn adding_a_known_path_returns_the_existing_module() {
        let mut g = ModuleGraph::new(p("a.mtek"), FileId(0));
        let b = g.add_module(p("b.mtek"), FileId(1)).unwrap();
        assert_eq!(g.add_module(p("b.mtek"), FileId(9)), Ok(b));
        assert_eq!(g.add_module(p("a.mtek"), FileId(9)), Ok(g.entry().id()));
        assert_eq!(g.len(), 2);
        assert_eq!(g.get(b).map(Module::file), Some(FileId(1)));
    }

    #[test]
    fn the_module_limit_is_enforced() {
        let mut g = ModuleGraph::new(p("m0.mtek"), FileId(0));
        for i in 1..MAX_MODULES {
            g.add_module(p(&format!("m{i}.mtek")), FileId(i as u32))
                .unwrap();
        }
        assert_eq!(g.len(), MAX_MODULES);
        assert_eq!(
            g.add_module(p("one-too-many.mtek"), FileId(0)),
            Err(GraphError::TooManyModules)
        );
        // Known modules are still found at the limit.
        assert!(g.add_module(p("m5.mtek"), FileId(0)).is_ok());
        assert_eq!(
            GraphError::TooManyModules.to_string(),
            "The project has more than 1024 modules."
        );
    }

    #[test]
    fn unknown_ids_are_rejected() {
        let mut g = ModuleGraph::new(p("a.mtek"), FileId(0));
        let other = graph(3, &[]);
        let foreign = other.modules()[2].id();
        let entry = g.entry().id();
        assert_eq!(
            g.add_import(entry, foreign, span(0)),
            Err(GraphError::UnknownModule(foreign))
        );
        assert_eq!(
            g.add_import(foreign, entry, span(0)),
            Err(GraphError::UnknownModule(foreign))
        );
        assert!(g.get(foreign).is_none());
        assert_eq!(
            GraphError::UnknownModule(foreign).to_string(),
            "Module 2 is not part of this module graph."
        );
    }

    #[test]
    fn acyclic_graphs_have_no_cycles() {
        // A diamond and a chain.
        assert!(
            graph(4, &[(0, 1), (0, 2), (1, 3), (2, 3)])
                .find_cycles()
                .is_empty()
        );
        assert!(graph(3, &[(0, 1), (1, 2)]).find_cycles().is_empty());
    }

    #[test]
    fn a_self_import_is_a_cycle_of_one() {
        let g = graph(1, &[(0, 0)]);
        let cycles = g.find_cycles();
        assert_eq!(cycles.len(), 1);
        assert_eq!(ids(&cycles[0]), [0]);
        assert_eq!(cycles[0].closing.span, span(0));
    }

    #[test]
    fn a_cycle_lists_every_module_in_order_and_names_the_closing_import() {
        // m0 -> m1 -> m2 -> m3 -> m1
        let g = graph(4, &[(0, 1), (1, 2), (2, 3), (3, 1)]);
        let cycles = g.find_cycles();
        assert_eq!(cycles.len(), 1);
        assert_eq!(ids(&cycles[0]), [1, 2, 3]);
        assert_eq!(cycles[0].closing.target.index(), 1);
        assert_eq!(cycles[0].closing.span, span(3), "the import in m3");
    }

    #[test]
    fn two_cycles_are_reported_in_search_order() {
        // m0 -> m1 -> m0 and m0 -> m2 -> m2
        let g = graph(3, &[(0, 1), (1, 0), (0, 2), (2, 2)]);
        let cycles = g.find_cycles();
        assert_eq!(cycles.len(), 2);
        assert_eq!(ids(&cycles[0]), [0, 1]);
        assert_eq!(cycles[0].closing.span, span(1));
        assert_eq!(ids(&cycles[1]), [2]);
        assert_eq!(cycles[1].closing.span, span(3));
    }

    #[test]
    fn a_module_reached_twice_is_not_a_cycle() {
        // m0 -> m1 -> m2 and m0 -> m2: m2 is Done when it is met again.
        let g = graph(3, &[(0, 1), (1, 2), (0, 2)]);
        assert!(g.find_cycles().is_empty());
    }

    #[test]
    fn a_long_chain_does_not_overflow_the_stack() {
        let count = MAX_MODULES as u32;
        let edges: Vec<(u32, u32)> = (0..count - 1)
            .map(|i| (i, i + 1))
            .chain([(count - 1, 0)])
            .collect();
        let g = graph(count, &edges);
        let cycles = g.find_cycles();
        assert_eq!(cycles.len(), 1);
        assert_eq!(cycles[0].modules.len(), MAX_MODULES);
    }

    #[test]
    fn unreachable_modules_are_searched_too() {
        // m1 and m2 form a cycle but the entry does not import them.
        let g = graph(3, &[(1, 2), (2, 1)]);
        let cycles = g.find_cycles();
        assert_eq!(cycles.len(), 1);
        assert_eq!(ids(&cycles[0]), [1, 2]);
    }
}
