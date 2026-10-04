//! Tests of module loading against in-memory file systems; the diagnostics
//! of every specifier rule are pinned by the fixtures in
//! `tests/semantics/fail/e203*`.

use super::*;
use crate::diagnostics::Report;
use crate::source::MemFs;

const MINIMAL: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";

fn p(s: &str) -> ProjectPath {
    ProjectPath::new(s).unwrap()
}

/// A project with `mtek.toml` and `files` (path, text).
fn project_fs(files: &[(&str, &str)]) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml"), MINIMAL);
    for (path, text) in files {
        fs.insert(p(path), *text);
    }
    fs
}

/// Load the project of `fs` with all its modules and report its cycles.
fn load_all(fs: &dyn Fs) -> (Project, Vec<LoadedModule>, Report) {
    let root = ProjectRoot::at_base();
    let mut sink = Diagnostics::new();
    let mut project = Project::load(&root, fs, &mut sink).expect("the project loads");
    let loaded = load_modules(&mut project, &root, fs, &mut sink);
    report_cycles(&project, &project.modules.find_cycles(), &mut sink);
    (project, loaded, sink.finish())
}

fn paths(project: &Project) -> Vec<&str> {
    project
        .modules
        .modules()
        .iter()
        .map(|m| m.path().as_str())
        .collect()
}

fn codes(report: &Report) -> Vec<&'static str> {
    report.diagnostics.iter().map(|d| d.code.short()).collect()
}

#[test]
fn modules_are_loaded_depth_first_in_import_order() {
    let fs = project_fs(&[
        (
            "src/main.mtek",
            "import { B } from \"./b.mtek\";\nimport { A } from \"./a.mtek\";\n",
        ),
        (
            "src/b.mtek",
            "import { C } from \"./lib/c.mtek\";\nexport const B = C;\n",
        ),
        (
            "src/a.mtek",
            "import { C } from \"./lib/c.mtek\";\nexport const A = C;\n",
        ),
        ("src/lib/c.mtek", "export const C = 1.0;\n"),
    ]);
    let (project, loaded, report) = load_all(&fs);
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);
    assert_eq!(
        paths(&project),
        [
            "src/main.mtek",
            "src/b.mtek",
            "src/lib/c.mtek",
            "src/a.mtek"
        ]
    );
    // File ids follow the same order (`spec/compiler-architecture.md` 5).
    for module in project.modules.modules() {
        assert_eq!(module.file().0 as usize, module.id().index());
        assert_eq!(
            project.sources.get(module.file()).map(|f| f.path()),
            Some(module.path())
        );
    }
    assert_eq!(loaded.len(), 4);
    let targets: Vec<Option<usize>> = loaded[0]
        .imports
        .iter()
        .map(|link| link.target.map(ModuleId::index))
        .collect();
    assert_eq!(targets, [Some(1), Some(3)]);
    // `c` is loaded once and imported twice.
    assert_eq!(loaded[1].imports[0].target, loaded[3].imports[0].target);
    assert!(project.modules.find_cycles().is_empty());
}

#[test]
fn two_spellings_of_one_path_are_one_module() {
    let fs = project_fs(&[
        (
            "src/main.mtek",
            "import { A } from \"./a.mtek\";\nimport { B } from \"../src/./lib/../a.mtek\";\n",
        ),
        (
            "src/a.mtek",
            "export const A = 1.0;\nexport const B = 2.0;\n",
        ),
    ]);
    let (project, _, report) = load_all(&fs);
    assert!(report.diagnostics.is_empty(), "{:#?}", report.diagnostics);
    assert_eq!(paths(&project), ["src/main.mtek", "src/a.mtek"]);
    assert_eq!(project.modules.entry().imports().len(), 2);
}

#[test]
fn loading_does_not_depend_on_directory_listings() {
    let files = [
        (
            "src/main.mtek",
            "import { B } from \"./b.mtek\";\nimport { A } from \"./a.mtek\";\nimport { X } from \"./x.mtek\";\n",
        ),
        (
            "src/b.mtek",
            "import { A } from \"./a.mtek\";\nexport const B = A;\n",
        ),
        ("src/a.mtek", "export const A = 1.0;\n"),
        // Two spellings that differ from the import only in case: the
        // suggestion is the first in sorted order, not in listing order.
        ("src/X.mtek", "export const X = 1.0;\n"),
        ("src/x.MTEK", ""),
        ("src/zz.mtek", ""),
        ("src/aa.mtek", ""),
    ];
    let reference = load_all(&project_fs(&files));
    for seed in 0..8 {
        let mut fs = project_fs(&files).with_shuffled_listing(seed);
        fs.insert(p("src/main.mtek"), files[0].1);
        let shuffled = load_all(&fs);
        assert_eq!(paths(&shuffled.0), paths(&reference.0), "seed {seed}");
        assert_eq!(shuffled.2, reference.2, "seed {seed}");
    }
    assert_eq!(codes(&reference.2), ["E2032"]);
    assert_eq!(
        reference.2.diagnostics[0].message,
        "The import \"./x.mtek\" names 'src/x.mtek', but the file is spelled 'src/X.mtek'."
    );
}

#[test]
fn a_file_system_that_ignores_case_is_still_held_to_the_exact_spelling() {
    /// A view that finds files whatever the case, as a case-insensitive
    /// file system would, but answers `exact_case_exists` truthfully.
    struct CaseBlind(MemFs);
    impl Fs for CaseBlind {
        fn read(&self, p: &ProjectPath) -> Result<Vec<u8>, FsError> {
            self.0.read(p).or_else(|_| {
                self.0
                    .read(&ProjectPath::new(&p.as_str().replace("palette", "Palette")).unwrap())
            })
        }
        fn exact_case_exists(&self, p: &ProjectPath) -> bool {
            self.0.exact_case_exists(p)
        }
        fn list_dir(&self, p: &ProjectPath) -> Result<Vec<String>, FsError> {
            self.0.list_dir(p)
        }
    }
    let fs = CaseBlind(project_fs(&[
        ("src/main.mtek", "import { A } from \"./palette.mtek\";\n"),
        ("src/Palette.mtek", "export const A = 1.0;\n"),
    ]));
    let (project, _, report) = load_all(&fs);
    assert_eq!(codes(&report), ["E2032"]);
    assert_eq!(project.modules.len(), 1);
}

#[test]
fn an_imported_directory_is_e2036() {
    let fs = project_fs(&[
        ("src/main.mtek", "import { A } from \"./lib.mtek\";\n"),
        ("src/lib.mtek/inner.mtek", ""),
    ]);
    let (_, loaded, report) = load_all(&fs);
    assert_eq!(codes(&report), ["E2036"]);
    assert_eq!(
        report.diagnostics[0].message,
        "The import \"./lib.mtek\" names 'src/lib.mtek', which is a directory, not a file."
    );
    assert_eq!(loaded[0].imports[0].target, None);
}

#[test]
fn an_imported_file_the_source_manager_rejects_has_its_code_and_the_import_as_related() {
    let mut fs = project_fs(&[("src/main.mtek", "import { A } from \"./bad.mtek\";\n")]);
    fs.insert(p("src/bad.mtek"), b"export const A = 1;\xFF\n".to_vec());
    let (project, _, report) = load_all(&fs);
    assert_eq!(codes(&report), ["E0001"]);
    let diagnostic = &report.diagnostics[0];
    assert!(diagnostic.primary.is_none());
    assert_eq!(diagnostic.related.len(), 1);
    assert_eq!(
        diagnostic.related[0].message.as_deref(),
        Some("'src/bad.mtek' is imported here")
    );
    assert_eq!(project.modules.len(), 1);
    assert_eq!(project.sources.len(), 1);
}

#[test]
fn a_specifier_that_did_not_lex_is_not_reported_again() {
    let fs = project_fs(&[("src/main.mtek", "import { A } from \"./a\\q.mtek\";\n")]);
    let (_, loaded, report) = load_all(&fs);
    assert!(
        !codes(&report).iter().any(|c| c.starts_with("E203")),
        "{:#?}",
        report.diagnostics
    );
    assert_eq!(loaded[0].imports[0].target, None);
}

#[test]
fn more_than_the_module_limit_is_e9002() {
    // The entry imports `MAX_MODULES` other modules: the last one is one too
    // many (`spec/compiler-architecture.md` section 9).
    let mut entry = String::new();
    let mut files = Vec::new();
    for i in 1..=MAX_MODULES {
        entry.push_str(&format!("import {{ M{i} }} from \"./m{i}.mtek\";\n"));
        files.push((
            format!("src/m{i}.mtek"),
            format!("export const M{i} = 1.0;\n"),
        ));
    }
    let mut fs = project_fs(&[("src/main.mtek", entry.as_str())]);
    for (path, text) in &files {
        fs.insert(p(path), text.as_str());
    }
    let (project, loaded, report) = load_all(&fs);
    assert_eq!(codes(&report), ["E9002"]);
    let diagnostic = &report.diagnostics[0];
    assert_eq!(
        diagnostic.message,
        "Cannot load 'src/m1024.mtek': the project has more than 1024 modules."
    );
    assert!(diagnostic.primary.is_none());
    assert_eq!(diagnostic.related.len(), 1);
    assert_eq!(project.modules.len(), MAX_MODULES);
    assert_eq!(project.sources.len(), MAX_MODULES);
    assert_eq!(loaded.len(), MAX_MODULES);
    assert_eq!(loaded[0].imports.last().and_then(|l| l.target), None);
}

#[test]
fn a_module_that_imports_itself_is_a_cycle_of_one() {
    let fs = project_fs(&[
        ("src/main.mtek", "import { A } from \"./a.mtek\";\n"),
        (
            "src/a.mtek",
            "import { B } from \"./a.mtek\";\nexport const B = 1.0;\n",
        ),
    ]);
    let (_, _, report) = load_all(&fs);
    let cycle: Vec<_> = report
        .diagnostics
        .iter()
        .filter(|d| d.code.short() == "E2035")
        .collect();
    assert_eq!(cycle.len(), 1);
    assert_eq!(
        cycle[0].message,
        "Import cycle: 'src/a.mtek' imports itself."
    );
    assert_eq!(cycle[0].related.len(), 1);
    assert_eq!(
        cycle[0].related[0].message.as_deref(),
        Some("'src/a.mtek' imports 'src/a.mtek' here")
    );
}

#[test]
fn a_long_cycle_is_reported_once_with_every_module() {
    let count = 6;
    let mut fs = project_fs(&[("src/main.mtek", "import { A } from \"./m0.mtek\";\n")]);
    for i in 0..count {
        let next = (i + 1) % count;
        fs.insert(
            p(&format!("src/m{i}.mtek")),
            format!("import {{ A }} from \"./m{next}.mtek\";\n"),
        );
    }
    let (_, _, report) = load_all(&fs);
    assert_eq!(codes(&report), ["E2035"]);
    let diagnostic = &report.diagnostics[0];
    assert_eq!(
        diagnostic.message,
        "Import cycle: src/m0.mtek -> src/m1.mtek -> src/m2.mtek -> src/m3.mtek -> src/m4.mtek -> src/m5.mtek -> src/m0.mtek."
    );
    assert_eq!(diagnostic.related.len(), count);
    assert_eq!(
        diagnostic.primary.as_ref().map(|l| l.span),
        diagnostic.related.last().map(|l| l.span),
        "reported at the import that closes the cycle"
    );
}
