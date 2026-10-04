//! Identity and naming of module-qualified blocks (`spec/gpu-layout.md` section 5).
//!
//! `<hash8>` is the first 8 lowercase hex digits of the SHA-256 of the normalised module
//! path (for example `src/main.mtek`, or `std/materials.mtek` for the prelude). It makes
//! generated names unique across modules: two materials called `Pulse` in different files
//! never collide.
//!
//! Every emitter takes module-qualified names from here (decision 0036): the WGSL struct of
//! a material block ([`material_params_struct`]), the `<qual>` of its JavaScript writers
//! ([`material_writer_qualifier`], which the writer emitter derives from the layout id with
//! [`split_material_layout_id`]) and the WGSL struct of a user struct
//! ([`user_struct_name`]). A user struct's layout type is named by its symbol
//! (`src/a.mtek::Shape`, [`qualified_name`]); `emit_wgsl::blocks::wgsl_struct_name` turns
//! such a name into `S_<hash8>_<Name>`.

use sha2::{Digest, Sha256};

/// The `<hash8>` of a normalised module path: the first 8 lowercase hex digits of the
/// SHA-256 of its UTF-8 bytes.
pub fn hash8(module_path: &str) -> String {
    let digest = Sha256::digest(module_path.as_bytes());
    digest
        .iter()
        .take(4)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The layout record id of a material's parameter block: `material:<module path>::<Name>`.
pub fn material_layout_id(module_path: &str, material: &str) -> String {
    format!("material:{module_path}::{material}")
}

/// The WGSL struct of a material's parameter block: `MtekParams_<hash8>_<Name>`.
pub fn material_params_struct(module_path: &str, material: &str) -> String {
    format!("MtekParams_{}_{material}", hash8(module_path))
}

/// The `<qual>` of a material block's JavaScript writers (`spec/gpu-layout.md` section 7):
/// `<hash8>_<Name>`, so the block writer is `w_<hash8>_<Name>` and a field writer
/// `w_<hash8>_<Name>_<field>`.
pub fn material_writer_qualifier(module_path: &str, material: &str) -> String {
    format!("{}_{material}", hash8(module_path))
}

/// The module path and material name of a material layout id
/// (`material:<module path>::<Name>`), or `None` for any other id.
pub fn split_material_layout_id(id: &str) -> Option<(&str, &str)> {
    let rest = id.strip_prefix("material:")?;
    let (module_path, material) = rest.rsplit_once("::")?;
    (!module_path.is_empty() && !material.is_empty()).then_some((module_path, material))
}

/// The WGSL struct of the user struct `name` declared in `module_path`: `S_<hash8>_<Name>`.
pub fn user_struct_name(module_path: &str, name: &str) -> String {
    format!("S_{}_{name}", hash8(module_path))
}

/// The symbol of a module item: `<module path>::<Name>` (decision 0028 item 3).
pub fn qualified_name(module_path: &str, name: &str) -> String {
    format!("{module_path}::{name}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash8_is_the_sha256_prefix_of_the_path() {
        // printf 'src/main.mtek' | sha256sum -> e2cab98bf7bb4a7d...
        assert_eq!(hash8("src/main.mtek"), "e2cab98b");
        // printf 'std/materials.mtek' | sha256sum -> 2b212d154422d807...
        assert_eq!(hash8("std/materials.mtek"), "2b212d15");
        assert_eq!(hash8(""), "e3b0c442");
    }

    #[test]
    fn material_block_names_are_module_qualified() {
        assert_eq!(
            material_layout_id("std/materials.mtek", "Unlit"),
            "material:std/materials.mtek::Unlit"
        );
        assert_eq!(
            material_params_struct("std/materials.mtek", "Unlit"),
            "MtekParams_2b212d15_Unlit"
        );
        assert_ne!(
            material_params_struct("src/a.mtek", "Pulse"),
            material_params_struct("src/b.mtek", "Pulse")
        );
    }

    #[test]
    fn writer_qualifiers_and_user_structs_carry_the_module_hash() {
        assert_eq!(
            material_writer_qualifier("src/main.mtek", "Pulse"),
            "e2cab98b_Pulse"
        );
        assert_eq!(
            user_struct_name("src/main.mtek", "Shape"),
            "S_e2cab98b_Shape"
        );
        assert_eq!(
            qualified_name("src/main.mtek", "Shape"),
            "src/main.mtek::Shape"
        );
        assert_ne!(
            material_writer_qualifier("src/a.mtek", "Pulse"),
            material_writer_qualifier("src/b.mtek", "Pulse")
        );
        assert_ne!(
            user_struct_name("src/a.mtek", "Pulse"),
            user_struct_name("src/b.mtek", "Pulse")
        );
    }

    #[test]
    fn material_layout_ids_split_into_module_and_name() {
        assert_eq!(
            split_material_layout_id(&material_layout_id("src/a/b.mtek", "Glow")),
            Some(("src/a/b.mtek", "Glow"))
        );
        for other in [
            "builtin:frame",
            "fixture:mixed",
            "material:",
            "material:::Glow",
            "material:src/a.mtek::",
            "material:src/a.mtek",
        ] {
            assert_eq!(split_material_layout_id(other), None, "{other}");
        }
    }
}
