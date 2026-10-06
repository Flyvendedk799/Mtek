//! Tests of project loading against in-memory file systems.

use super::*;
use crate::source::MemFs;

const MINIMAL: &str = "[project]\nname = \"demo\"\nlanguage = \"0.1\"\n";

fn p(s: &str) -> ProjectPath {
    ProjectPath::new(s).unwrap()
}

fn project_fs(toml: &str, entry: &str) -> MemFs {
    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml"), toml)
        .insert(p("src/main.mtek"), entry);
    fs
}

fn load(fs: &dyn Fs, root: &ProjectRoot) -> (Option<Project>, Vec<Diagnostic>) {
    let mut diagnostics = Diagnostics::new();
    let project = Project::load(root, fs, &mut diagnostics);
    (project, diagnostics.finish().diagnostics)
}

/// The single diagnostic of a failed load.
fn failure(fs: &dyn Fs, root: &ProjectRoot) -> Diagnostic {
    let (project, mut diagnostics) = load(fs, root);
    assert!(project.is_none());
    assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
    diagnostics.remove(0)
}

#[test]
fn a_minimal_project_loads_with_the_entry_as_its_only_module() {
    let fs = project_fs(MINIMAL, "scene Demo { }\n");
    let (project, diagnostics) = load(&fs, &ProjectRoot::at_base());
    assert!(diagnostics.is_empty(), "{diagnostics:#?}");
    let project = project.unwrap();

    assert_eq!(project.config.project.name, "demo");
    assert_eq!(&*project.config_text, MINIMAL);

    assert_eq!(project.sources.len(), 1);
    let entry = project.sources.get(project.entry_file()).unwrap();
    assert_eq!(entry.path(), &p("src/main.mtek"));
    assert_eq!(entry.text(), "scene Demo { }\n");

    assert_eq!(project.modules.len(), 1);
    let module = project.modules.entry();
    assert_eq!(module.path(), &p("src/main.mtek"));
    assert_eq!(module.file(), project.entry_file());
    assert!(module.imports().is_empty());
    assert!(project.modules.find_cycles().is_empty());
}

#[test]
fn a_custom_entry_is_loaded_instead_of_the_default() {
    let mut fs = MemFs::new();
    fs.insert(
        p("mtek.toml"),
        format!("{MINIMAL}entry = \"game/start.mtek\"\n"),
    )
    .insert(p("game/start.mtek"), "// start\n")
    .insert(p("src/main.mtek"), "// not the entry\n");
    let (project, diagnostics) = load(&fs, &ProjectRoot::at_base());
    assert!(diagnostics.is_empty());
    let project = project.unwrap();
    assert_eq!(project.modules.entry().path(), &p("game/start.mtek"));
    assert_eq!(
        project.sources.get(project.entry_file()).map(|f| f.text()),
        Some("// start\n")
    );
}

#[test]
fn paths_are_relative_to_the_project_root_not_the_file_system_base() {
    let mut fs = MemFs::new();
    fs.insert(p("work/demo/mtek.toml"), MINIMAL)
        .insert(p("work/demo/src/main.mtek"), "x")
        .insert(p("src/main.mtek"), "wrong project")
        .insert(
            p("mtek.toml"),
            "[project]\nname = \"x\"\nlanguage = \"0.1\"\n",
        );
    let mut diagnostics = Diagnostics::new();
    let root = ProjectRoot::discover(&fs, &p("work/demo/src"), &mut diagnostics).unwrap();
    let (project, diagnostics) = load(&fs, &root);
    assert!(diagnostics.is_empty());
    let project = project.unwrap();
    assert_eq!(project.modules.entry().path(), &p("src/main.mtek"));
    assert_eq!(
        project.sources.get(project.entry_file()).map(|f| f.text()),
        Some("x")
    );
}

#[test]
fn a_missing_project_file_is_e9004() {
    let mut fs = MemFs::new();
    fs.insert(p("src/main.mtek"), "");
    let d = failure(&fs, &ProjectRoot::at_base());
    assert_eq!(d.code, Code::E9004);
    assert_eq!(d.message, "The project file mtek.toml was not found.");
    assert!(d.primary.is_none());
}

#[test]
fn a_directory_called_mtek_toml_is_e9004() {
    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml/x"), "");
    let d = failure(&fs, &ProjectRoot::at_base());
    assert_eq!(d.code, Code::E9004);
    assert_eq!(
        d.message,
        "The project file mtek.toml is a directory, not a file."
    );
}

/// A file system in which reading one path fails with an I/O error.
struct FailingRead {
    inner: MemFs,
    path: ProjectPath,
}

impl Fs for FailingRead {
    fn read(&self, p: &ProjectPath) -> Result<Vec<u8>, FsError> {
        if *p == self.path {
            Err(FsError::Other {
                path: p.clone(),
                message: "disk on fire".to_owned(),
            })
        } else {
            self.inner.read(p)
        }
    }
    fn exact_case_exists(&self, p: &ProjectPath) -> bool {
        self.inner.exact_case_exists(p)
    }
    fn list_dir(&self, p: &ProjectPath) -> Result<Vec<String>, FsError> {
        self.inner.list_dir(p)
    }
}

#[test]
fn an_unreadable_project_file_is_e9004_with_the_reason() {
    let fs = FailingRead {
        inner: project_fs(MINIMAL, ""),
        path: p("mtek.toml"),
    };
    let d = failure(&fs, &ProjectRoot::at_base());
    assert_eq!(d.code, Code::E9004);
    assert_eq!(
        d.message,
        "Could not read the project file: 'mtek.toml': disk on fire."
    );
}

#[test]
fn a_project_file_that_is_not_utf8_is_e9001() {
    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml"), b"[project]\nname = \"\xFF\"\n".to_vec());
    let d = failure(&fs, &ProjectRoot::at_base());
    assert_eq!(d.code, Code::E9001);
    assert_eq!(
        d.message,
        "Invalid project configuration: mtek.toml is not valid UTF-8 (invalid byte sequence at byte 18)."
    );
}

#[test]
fn an_invalid_configuration_stops_loading_and_reports_every_problem() {
    let fs = project_fs(
        "[project]\nname = \"Bad\"\nlanguage = \"0.1\"\n[dev]\nport = 0\n",
        "",
    );
    let (project, diagnostics) = load(&fs, &ProjectRoot::at_base());
    assert!(project.is_none());
    let codes: Vec<Code> = diagnostics.iter().map(|d| d.code).collect();
    assert_eq!(codes, [Code::E9001, Code::E9001]);
}

#[test]
fn host_inputs_are_kept_while_loading() {
    let fs = project_fs(
        &format!(
            "{MINIMAL}[host.inputs]
tint = \"Demo.tint\"
"
        ),
        "scene Demo { }
",
    );
    let (project, diagnostics) = load(&fs, &ProjectRoot::at_base());
    assert!(
        diagnostics.iter().all(|d| d.code != Code::E9010),
        "{diagnostics:#?}"
    );
    let project = project.unwrap();
    assert_eq!(
        project.config.host_inputs.get("tint").map(String::as_str),
        Some("Demo.tint")
    );
}

#[test]
fn a_missing_entry_is_e9005() {
    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml"), MINIMAL);
    let d = failure(&fs, &ProjectRoot::at_base());
    assert_eq!(d.code, Code::E9005);
    assert_eq!(d.message, "Entry file 'src/main.mtek' not found.");
    assert_eq!(
        d.notes,
        ["help: create the file or set project.entry in mtek.toml to the entry module"]
    );
    assert!(d.primary.is_none());
}

#[test]
fn a_missing_entry_that_exists_with_other_letter_case_gets_a_hint() {
    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml"), MINIMAL)
        .insert(p("src/Main.mtek"), "");
    let d = failure(&fs, &ProjectRoot::at_base());
    assert_eq!(d.code, Code::E9005);
    assert_eq!(d.message, "Entry file 'src/main.mtek' not found.");
    assert_eq!(
        d.notes[0],
        "help: 'src/Main.mtek' exists; file names are case-sensitive, so use that spelling in project.entry"
    );

    // A directory with a different case, and several candidates: the first in
    // sorted order wins whatever the enumeration order is.
    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml"), MINIMAL)
        .insert(p("SRC/main.mtek"), "")
        .insert(p("Src/MAIN.mtek"), "")
        .insert(p("Src/Main.mtek"), "");
    let hints: Vec<String> = (0..4)
        .map(|seed| {
            let shuffled = fs.clone().with_shuffled_listing(seed);
            failure(&shuffled, &ProjectRoot::at_base()).notes[0].clone()
        })
        .collect();
    assert!(
        hints.iter().all(|h| h == &hints[0]),
        "hint depends on listing order: {hints:?}"
    );
    assert!(
        hints[0].starts_with("help: 'SRC/main.mtek' exists;"),
        "{hints:?}"
    );
}

#[test]
fn no_case_hint_when_nothing_similar_exists() {
    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml"), MINIMAL)
        .insert(p("src/app.mtek"), "");
    let d = failure(&fs, &ProjectRoot::at_base());
    assert_eq!(d.notes.len(), 1);
    assert!(d.notes[0].starts_with("help: create the file"));
}

#[test]
fn an_entry_that_is_a_directory_is_e9005() {
    let mut fs = MemFs::new();
    fs.insert(
        p("mtek.toml"),
        format!("{MINIMAL}entry = \"src/game.mtek\"\n"),
    )
    .insert(p("src/game.mtek/inner.mtek"), "");
    let d = failure(&fs, &ProjectRoot::at_base());
    assert_eq!(d.code, Code::E9005);
    assert_eq!(
        d.message,
        "Entry 'src/game.mtek' is a directory, not a file."
    );
}

#[test]
fn an_entry_below_a_file_is_not_found() {
    let mut fs = MemFs::new();
    fs.insert(
        p("mtek.toml"),
        format!("{MINIMAL}entry = \"src/main.mtek/x.mtek\"\n"),
    )
    .insert(p("src/main.mtek"), "");
    let d = failure(&fs, &ProjectRoot::at_base());
    assert_eq!(d.code, Code::E9005);
    assert_eq!(d.message, "Entry file 'src/main.mtek/x.mtek' not found.");
}

#[test]
fn an_unreadable_entry_is_e9005_with_the_reason() {
    let fs = FailingRead {
        inner: project_fs(MINIMAL, ""),
        path: p("src/main.mtek"),
    };
    let d = failure(&fs, &ProjectRoot::at_base());
    assert_eq!(d.code, Code::E9005);
    assert_eq!(
        d.message,
        "Could not read entry file 'src/main.mtek': 'src/main.mtek': disk on fire."
    );
}

#[test]
fn entry_text_problems_use_the_source_manager_codes() {
    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml"), MINIMAL)
        .insert(p("src/main.mtek"), vec![b'a', 0xFF, b'b']);
    let d = failure(&fs, &ProjectRoot::at_base());
    assert_eq!(d.code, Code::E0001);
    assert!(d.message.contains("src/main.mtek"), "{}", d.message);

    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml"), MINIMAL)
        .insert(p("src/main.mtek"), "a\u{FEFF}b");
    assert_eq!(failure(&fs, &ProjectRoot::at_base()).code, Code::E0002);

    let mut fs = MemFs::new();
    fs.insert(p("mtek.toml"), MINIMAL)
        .insert(p("src/main.mtek"), vec![b' '; 4 * 1024 * 1024 + 1]);
    assert_eq!(failure(&fs, &ProjectRoot::at_base()).code, Code::E0004);
}

#[test]
fn the_entry_text_is_kept_exactly_including_a_byte_order_mark_and_crlf() {
    let text = "\u{FEFF}scene A { }\r\n";
    let fs = project_fs(MINIMAL, text);
    let (project, diagnostics) = load(&fs, &ProjectRoot::at_base());
    assert!(diagnostics.is_empty());
    let project = project.unwrap();
    let entry = project.sources.get(project.entry_file()).unwrap();
    assert_eq!(entry.text(), text);
    assert_eq!(entry.content_start(), 3);
}

#[test]
fn loading_does_not_depend_on_the_directory_listing_order() {
    let build = |seed: u64| {
        let fs = project_fs(MINIMAL, "x").with_shuffled_listing(seed);
        let (project, diagnostics) = load(&fs, &ProjectRoot::at_base());
        assert!(diagnostics.is_empty());
        let project = project.unwrap();
        (
            project.config,
            project
                .sources
                .files()
                .map(|f| f.sha256_hex())
                .collect::<Vec<_>>(),
            project.modules,
        )
    };
    let first = build(0);
    for seed in 1..5 {
        assert_eq!(build(seed), first);
    }
}
