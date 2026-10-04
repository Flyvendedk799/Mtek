//! Identity and naming of module-qualified blocks (`spec/gpu-layout.md` section 5).
//!
//! `<hash8>` is the first 8 lowercase hex digits of the SHA-256 of the normalised module
//! path (for example `src/main.mtek`, or `std/materials.mtek` for the prelude). It makes
//! generated names unique across modules: two materials called `Pulse` in different files
//! never collide.

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
}
