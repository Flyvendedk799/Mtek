//! Module paths cannot turn user structs into compiler-owned WGSL types.
#![allow(clippy::unwrap_used, clippy::panic)]

use mtek_compiler::emit_wgsl::validate_wgsl;
use mtek_compiler::layout::user_struct_name;
use mtek_compiler::project::ProjectRoot;
use mtek_compiler::source::{MemFs, ProjectPath};
use mtek_compiler::{BuildMode, CompileOptions, analyze, build};

#[test]
fn mtek_prefixed_entry_and_import_paths_keep_user_struct_mangling() {
    for (entry, declaration_path, import, export) in [
        ("Mtek.mtek", "Mtek.mtek", "", ""),
        (
            "src/main.mtek",
            "MtekTypes.mtek",
            "import { Pair } from \"../MtekTypes.mtek\";",
            "export ",
        ),
        (
            "Mtek/main.mtek",
            "Mtek/types.mtek",
            "import { Pair } from \"./types.mtek\";",
            "export ",
        ),
    ] {
        let mut fs = MemFs::new();
        fs.insert(
            ProjectPath::new("mtek.toml").unwrap(),
            format!("[project]\nname = \"names\"\nlanguage = \"0.1\"\nentry = \"{entry}\"\n"),
        );
        let declaration = format!("{export}struct Pair {{ target: f32; value: f32; }}");
        let source = format!(
            "{import}\nmaterial M {{ param p: Pair = Pair {{ target: 0.25; value: 0.5; }}; fragment(input: SurfaceInput) -> color {{ let copy = Pair {{ target: p.target; value: p.value; }}; return color.linear(vec3(copy.target + copy.value), 1.0); }} }}\nscene Demo {{ camera Main {{}} entity E {{ mesh: Box {{}}; material: M {{}}; }} }}"
        );
        if declaration_path == entry {
            fs.insert(
                ProjectPath::new(entry).unwrap(),
                format!("{declaration}\n{source}"),
            );
        } else {
            fs.insert(ProjectPath::new(declaration_path).unwrap(), declaration);
            fs.insert(ProjectPath::new(entry).unwrap(), source);
        }
        let checked = analyze(&ProjectRoot::at_base(), &fs);
        assert!(!checked.has_errors(), "{entry}: {:#?}", checked.report);
        let built = build(
            &ProjectRoot::at_base(),
            &fs,
            &CompileOptions::with_stub_runtime(BuildMode::Release),
        );
        assert!(!built.has_errors(), "{entry}: {:#?}", built.report);
        for (_, bytes) in built
            .files
            .iter()
            .filter(|(path, _)| path.ends_with(".wgsl"))
        {
            let module = validate_wgsl(std::str::from_utf8(bytes).unwrap()).unwrap();
            let expected = user_struct_name(declaration_path, "Pair");
            let ty = module
                .types
                .iter()
                .find(|(_, ty)| ty.name.as_deref() == Some(&expected))
                .unwrap()
                .1;
            let naga::TypeInner::Struct { members, .. } = &ty.inner else {
                panic!("expected user struct")
            };
            assert_eq!(
                members
                    .iter()
                    .map(|member| member.name.as_deref().unwrap())
                    .collect::<Vec<_>>(),
                ["u_target", "u_value"]
            );
        }
    }
}
