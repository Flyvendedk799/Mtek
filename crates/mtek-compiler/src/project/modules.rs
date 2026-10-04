//! Loading the modules of a project (`spec/language.md` sections 9.1, 9.3
//! and 9.4, `spec/compiler-architecture.md` section 4.4, decision 0036).
//!
//! [`load_modules`] starts at the entry module, which [`Project::load`]
//! has read, lexes and parses it, and follows its imports in source order,
//! depth first: a module imported for the first time is read, parsed and
//! searched for imports before the next import of the importing module. A
//! module gets the next [`ModuleId`] (and the next [`FileId`]) when it is
//! first reached, so the numbering, the order of every module's imports and
//! therefore every output derived from the module set depend only on the
//! source text, never on directory enumeration order. Directories are listed
//! only to suggest the right spelling of a path whose case differs
//! (`E2032`), and then in sorted order.
//!
//! Reported here, at the import's specifier: `E2030` (form), `E2031` (outside
//! the root or in the reserved `std/` directory), `E2034` (bare specifier),
//! `E2032` (case mismatch), `E2036` (no such file); `E0001`/`E0004` for an
//! imported file the source manager rejects and `E9002` beyond
//! [`MAX_MODULES`](super::MAX_MODULES) (both without a primary location, as
//! `spec/diagnostics.md` section 2.1 specifies for files that never got a file
//! id, with a related span at the import). Import cycles (`E2035`) are
//! reported by [`report_cycles`] once the graph is complete.

use super::graph::{ImportCycle, MAX_MODULES, ModuleId};
use super::load::{Project, path_differing_in_case};
use super::root::ProjectRoot;
use super::specifier::{SpecifierError, resolve_specifier};
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::source::{Fs, FsError, ProjectPath, Span};
use crate::syntax::ast::{ImportDecl, ItemKind, Module, NodeId};
use crate::syntax::{lex, parse_module};

/// One parsed module and where each of its imports led.
#[derive(Clone, Debug)]
pub struct LoadedModule {
    /// The module's syntax tree (with `Error` nodes where it did not parse).
    pub ast: Module,
    /// One entry per `import` declaration, in source order: the declaration
    /// and the module it imports, `None` if the import was reported
    /// (`E2030`–`E2036`, `E9002`, a source-manager error) or its specifier did
    /// not lex.
    pub imports: Vec<ImportLink>,
}

/// Where one `import` declaration led.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ImportLink {
    /// The [`ImportDecl`]'s node.
    pub decl: NodeId,
    /// The imported module.
    pub target: Option<ModuleId>,
}

/// Parse the entry module of `project` and load every module it imports,
/// directly or not, adding them to `project.sources` and `project.modules`.
/// Returns the parsed modules indexed by [`ModuleId::index`]. Never panics;
/// problems are diagnostics.
pub fn load_modules(
    project: &mut Project,
    root: &ProjectRoot,
    fs: &dyn Fs,
    sink: &mut Diagnostics,
) -> Vec<LoadedModule> {
    let view = root.view(fs);
    let entry = project.modules.entry().id();
    let mut loaded = Vec::new();
    let Some(ast) = parse(project, entry, sink) else {
        return loaded;
    };
    loaded.push(LoadedModule {
        ast,
        imports: Vec::new(),
    });
    // The search path: a module and how many of its imports were followed.
    let mut stack: Vec<(ModuleId, usize)> = vec![(entry, 0)];
    while let Some(&(module, next)) = stack.last() {
        let Some(decl) = loaded
            .get(module.index())
            .and_then(|m| import_decls(&m.ast).nth(next))
            .cloned()
        else {
            stack.pop();
            continue;
        };
        if let Some(top) = stack.last_mut() {
            top.1 += 1;
        }
        let (target, new) = follow(project, &view, module, &decl, sink);
        if let Some(target) = target
            && project
                .modules
                .add_import(module, target, decl.source.span)
                .is_err()
        {
            internal(sink, decl.source.span);
        }
        if let Some(slot) = loaded.get_mut(module.index()) {
            slot.imports.push(ImportLink {
                decl: decl.id,
                target,
            });
        }
        if let (Some(target), true) = (target, new) {
            match parse(project, target, sink) {
                Some(ast) if target.index() == loaded.len() => {
                    loaded.push(LoadedModule {
                        ast,
                        imports: Vec::new(),
                    });
                    stack.push((target, 0));
                }
                _ => internal(sink, decl.source.span),
            }
        }
    }
    loaded
}

/// The `import` declarations of `module` in source order.
fn import_decls(module: &Module) -> impl Iterator<Item = &ImportDecl> {
    module.items.iter().filter_map(|item| match &item.kind {
        ItemKind::Import(decl) => Some(decl),
        _ => None,
    })
}

/// Lex and parse the module `id` of `project`, reporting to `sink`.
fn parse(project: &Project, id: ModuleId, sink: &mut Diagnostics) -> Option<Module> {
    let file = project.modules.get(id)?.file();
    let source = project.sources.get(file)?;
    let mut lexed = lex(source);
    lexed.report_into(sink);
    Some(parse_module(source.text(), &lexed.tokens, &lexed.trivia, sink).module)
}

/// `E9999` for a loader state that cannot happen.
fn internal(sink: &mut Diagnostics, span: Span) {
    sink.push(
        Diagnostic::new(
            Code::E9999,
            "The module graph lost track of an import; this is a compiler bug.",
        )
        .at(span)
        .help("please report it with the program that caused it"),
    );
}

/// Follow the import `decl` of `importer`: the imported module, if it could
/// be loaded, and whether it was loaded just now (and still has to be
/// parsed).
fn follow(
    project: &mut Project,
    view: &dyn Fs,
    importer: ModuleId,
    decl: &ImportDecl,
    sink: &mut Diagnostics,
) -> (Option<ModuleId>, bool) {
    // A string literal that did not lex was reported by the lexer.
    let Some(specifier) = decl.source.value.as_deref() else {
        return (None, false);
    };
    let span = decl.source.span;
    let Some(importer_path) = project.modules.get(importer).map(|m| m.path().clone()) else {
        return (None, false);
    };
    let path = match resolve_specifier(&importer_path, specifier) {
        Ok(path) => path,
        Err(error) => {
            sink.push(specifier_diagnostic(
                &error,
                specifier,
                &importer_path,
                span,
            ));
            return (None, false);
        }
    };
    if let Some(existing) = project.modules.find(&path) {
        return (Some(existing), false);
    }
    if project.modules.len() >= MAX_MODULES {
        sink.push(
            Diagnostic::new(
                Code::E9002,
                format!("Cannot load '{path}': the project has more than {MAX_MODULES} modules."),
            )
            .related(span, format!("'{path}' is imported here"))
            .help("merge small modules; the limit keeps compilation time and memory bounded"),
        );
        return (None, false);
    }
    let bytes = match view.read(&path) {
        Ok(bytes) if view.exact_case_exists(&path) => bytes,
        // A file system that matched the name without regard to case.
        Ok(_) => {
            sink.push(not_readable(
                view,
                specifier,
                &path,
                &FsError::NotFound(path.clone()),
                span,
            ));
            return (None, false);
        }
        Err(error) => {
            sink.push(not_readable(view, specifier, &path, &error, span));
            return (None, false);
        }
    };
    let file = match project.sources.add(path.clone(), &bytes) {
        Ok(file) => file,
        Err(error) => {
            sink.push(
                Diagnostic::from_source_error(&error)
                    .related(span, format!("'{path}' is imported here")),
            );
            return (None, false);
        }
    };
    match project.modules.add_module(path, file) {
        Ok(id) => (Some(id), true),
        Err(_) => {
            internal(sink, span);
            (None, false)
        }
    }
}

/// The diagnostic of a specifier that breaks a rule of
/// [`resolve_specifier`].
fn specifier_diagnostic(
    error: &SpecifierError,
    specifier: &str,
    importer: &ProjectPath,
    span: Span,
) -> Diagnostic {
    match error {
        SpecifierError::Invalid(reason) => {
            let mut diagnostic = Diagnostic::new(
                Code::E2030,
                format!("Invalid import specifier \"{specifier}\": {reason}."),
            )
            .at(span);
            if specifier.contains('\\') {
                diagnostic = diagnostic.help(format!(
                    "write \"{}\"",
                    specifier.replace('\\', "/")
                ));
            }
            diagnostic.help(
                "a specifier is a relative path that starts with `./` or `../`, uses `/` and ends in `.mtek`, for example \"./palette.mtek\"",
            )
        }
        SpecifierError::Bare => {
            let suggestion = if specifier.ends_with(".mtek") {
                format!("./{specifier}")
            } else {
                format!("./{specifier}.mtek")
            };
            Diagnostic::new(
                Code::E2034,
                format!(
                    "Package imports are not supported in v0.1: \"{specifier}\" is a bare specifier."
                ),
            )
            .at(span)
            .help(format!(
                "to import a file of this project, write a relative path such as \"{suggestion}\""
            ))
        }
        SpecifierError::OutsideRoot => Diagnostic::new(
            Code::E2031,
            format!("The import \"{specifier}\" resolves to a path outside the project root."),
        )
        .at(span)
        .note(format!(
            "relative to '{importer}', the path climbs above the directory that contains mtek.toml"
        ))
        .help("modules can only import files inside the project"),
        SpecifierError::Reserved(path) => Diagnostic::new(
            Code::E2031,
            format!(
                "The import \"{specifier}\" resolves to '{path}', inside the directory 'std/', which is reserved for the embedded standard library."
            ),
        )
        .at(span)
        .note("standard-library names are in scope in every module without an import")
        .help("move the module to another directory"),
    }
}

/// `E2032` or `E2036` for an imported file that could not be read.
fn not_readable(
    view: &dyn Fs,
    specifier: &str,
    path: &ProjectPath,
    error: &FsError,
    span: Span,
) -> Diagnostic {
    match error {
        FsError::NotFound(_) | FsError::NotADirectory(_) => {
            if let Some(found) = path_differing_in_case(view, path) {
                return Diagnostic::new(
                    Code::E2032,
                    format!(
                        "The import \"{specifier}\" names '{path}', but the file is spelled '{found}'."
                    ),
                )
                .at(span)
                .note("file names in imports must match the file system exactly, even where it ignores case, so that the project builds everywhere")
                .help(format!("use the spelling '{found}' in the specifier"));
            }
            Diagnostic::new(
                Code::E2036,
                format!("The imported file '{path}' was not found."),
            )
            .at(span)
            .note(format!(
                "\"{specifier}\" is resolved relative to the directory of the importing file"
            ))
        }
        FsError::IsADirectory(_) => Diagnostic::new(
            Code::E2036,
            format!("The import \"{specifier}\" names '{path}', which is a directory, not a file."),
        )
        .at(span),
        FsError::Other { message, .. } => Diagnostic::new(
            Code::E2036,
            format!("Could not read the imported file '{path}': {message}."),
        )
        .at(span),
    }
}

/// Report every import cycle of `project` (`E2035`), once, at the import
/// that closes it: the message spells out the whole path, and every module
/// of the cycle is a related span at its import of the next module.
pub fn report_cycles(project: &Project, cycles: &[ImportCycle], sink: &mut Diagnostics) {
    for cycle in cycles {
        let path_of = |id: ModuleId| {
            project
                .modules
                .get(id)
                .map_or_else(String::new, |m| m.path().as_str().to_owned())
        };
        let names: Vec<String> = cycle.modules.iter().map(|m| path_of(*m)).collect();
        let message = match names.as_slice() {
            [single] => format!("Import cycle: '{single}' imports itself."),
            _ => {
                let mut chain = names.clone();
                if let Some(first) = names.first() {
                    chain.push(first.clone());
                }
                format!("Import cycle: {}.", chain.join(" -> "))
            }
        };
        let mut diagnostic = Diagnostic::new(Code::E2035, message).at(cycle.closing.span);
        for (index, module) in cycle.modules.iter().enumerate() {
            let next = cycle
                .modules
                .get(index + 1)
                .or_else(|| cycle.modules.first())
                .copied()
                .unwrap_or(*module);
            let span = if index + 1 == cycle.modules.len() {
                Some(cycle.closing.span)
            } else {
                project.modules.get(*module).and_then(|m| {
                    m.imports()
                        .iter()
                        .find(|import| import.target == next)
                        .map(|import| import.span)
                })
            };
            if let Some(span) = span {
                diagnostic = diagnostic.related(
                    span,
                    format!("'{}' imports '{}' here", path_of(*module), path_of(next)),
                );
            }
        }
        sink.push(diagnostic.help(
            "modules cannot import each other in a cycle; move the declarations they share into a module that both import",
        ));
    }
}

#[cfg(test)]
mod tests;
