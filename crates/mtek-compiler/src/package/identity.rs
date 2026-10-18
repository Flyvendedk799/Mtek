//! Build identity and content hashes (`spec/runtime-abi.md` sections 2 and 5.3).
//!
//! `buildId = sha256(canonical JSON of the identity)`, where the identity is the compiler
//! version, the language version, the runtime ABI, the target profile, the enabled WebGPU
//! features (`requiredCapabilities.features`), the list of `[normalised path, sha256]` of every
//! source and asset sorted by path, and the text of `mtek.toml`. The canonical JSON is compact,
//! with object keys in lexicographic order and strings escaped by `serde_json`. Nothing else
//! (no time, no absolute path, no file-system order) enters it.

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

/// SHA-256 of `bytes` as 64 lowercase hex digits.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The first 16 hex digits of the SHA-256 of `bytes`: the `<h16>` of content-addressed file
/// names.
#[must_use]
pub fn h16(bytes: &[u8]) -> String {
    let mut hex = sha256_hex(bytes);
    hex.truncate(16);
    hex
}

/// What the build identity covers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuildIdentity<'a> {
    pub compiler_version: &'a str,
    pub language_version: &'a str,
    pub runtime_abi: u32,
    pub target_profile: &'a str,
    pub features: &'a [String],
    /// `(normalised path, sha256 hex)` of every source file, in any order.
    pub sources: Vec<(String, String)>,
    /// `(normalised path, sha256 hex)` of every asset, in any order (none before M4).
    pub assets: Vec<(String, String)>,
    /// `mtek.toml` exactly as stored.
    pub config: &'a str,
    /// The loop budget of a `preview` build (decision 0075); `None` for every other mode, whose
    /// identity is then exactly what it was before previews existed.
    pub preview_loop_budget: Option<u32>,
}

impl BuildIdentity<'_> {
    /// The canonical JSON text that is hashed.
    #[must_use]
    pub fn canonical_json(&self) -> String {
        let sorted = |list: &[(String, String)]| -> Value {
            let mut list = list.to_vec();
            list.sort();
            Value::Array(
                list.into_iter()
                    .map(|(path, hash)| json!([path, hash]))
                    .collect(),
            )
        };
        let mut features = self.features.to_vec();
        features.sort();
        // Keys in lexicographic order (the map keeps insertion order).
        let mut identity = Map::new();
        identity.insert("assets".to_owned(), sorted(&self.assets));
        identity.insert("compilerVersion".to_owned(), json!(self.compiler_version));
        identity.insert("config".to_owned(), json!(self.config));
        identity.insert("features".to_owned(), json!(features));
        identity.insert("languageVersion".to_owned(), json!(self.language_version));
        // Only a preview build has the key, so every other identity is what it always was.
        if let Some(budget) = self.preview_loop_budget {
            identity.insert("previewLoopBudget".to_owned(), json!(budget));
        }
        identity.insert("runtimeAbi".to_owned(), json!(self.runtime_abi));
        identity.insert("sources".to_owned(), sorted(&self.sources));
        identity.insert("targetProfile".to_owned(), json!(self.target_profile));
        Value::Object(identity).to_string()
    }

    /// The build id: SHA-256 of [`BuildIdentity::canonical_json`], 64 lowercase hex digits.
    #[must_use]
    pub fn build_id(&self) -> String {
        sha256_hex(self.canonical_json().as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(sources: Vec<(String, String)>, config: &str) -> String {
        BuildIdentity {
            compiler_version: "0.1.0-dev",
            language_version: "0.1",
            runtime_abi: 1,
            target_profile: "webgpu-core-2026",
            features: &[],
            sources,
            assets: Vec::new(),
            config,
            preview_loop_budget: None,
        }
        .build_id()
    }

    fn pair(path: &str, hash: &str) -> (String, String) {
        (path.to_owned(), hash.to_owned())
    }

    #[test]
    fn hashes_match_known_vectors() {
        assert_eq!(sha256_hex(b"// mtek test runtime stub\n").len(), 64);
        assert_eq!(h16(b"abc"), "ba7816bf8f01cfea");
    }

    #[test]
    fn the_canonical_form_is_sorted_and_compact() {
        let identity = BuildIdentity {
            compiler_version: "0.1.0-dev",
            language_version: "0.1",
            runtime_abi: 1,
            target_profile: "webgpu-core-2026",
            features: &[],
            sources: vec![
                pair("std/materials.mtek", "bb"),
                pair("src/main.mtek", "aa"),
            ],
            assets: Vec::new(),
            config: "[project]\nname = \"a\"\n",
            preview_loop_budget: None,
        };
        assert_eq!(
            identity.canonical_json(),
            r#"{"assets":[],"compilerVersion":"0.1.0-dev","config":"[project]\nname = \"a\"\n","features":[],"languageVersion":"0.1","runtimeAbi":1,"sources":[["src/main.mtek","aa"],["std/materials.mtek","bb"]],"targetProfile":"webgpu-core-2026"}"#
        );
    }

    #[test]
    fn a_preview_budget_enters_the_identity_and_its_absence_changes_nothing() {
        let with = |budget| BuildIdentity {
            compiler_version: "0.1.0-dev",
            language_version: "0.1",
            runtime_abi: 1,
            target_profile: "webgpu-core-2026",
            features: &[],
            sources: vec![pair("src/main.mtek", "aa")],
            assets: Vec::new(),
            config: "x",
            preview_loop_budget: budget,
        };
        let release = with(None);
        assert!(!release.canonical_json().contains("previewLoopBudget"));
        let preview = with(Some(100));
        assert!(
            preview
                .canonical_json()
                .contains(r#""previewLoopBudget":100,"runtimeAbi":1"#),
            "{}",
            preview.canonical_json()
        );
        assert_ne!(release.build_id(), preview.build_id());
        assert_ne!(with(Some(100)).build_id(), with(Some(101)).build_id());
    }

    #[test]
    fn the_id_depends_on_contents_not_on_order() {
        let a = identity(vec![pair("a.mtek", "1"), pair("b.mtek", "2")], "x");
        let b = identity(vec![pair("b.mtek", "2"), pair("a.mtek", "1")], "x");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
        assert_ne!(
            a,
            identity(vec![pair("a.mtek", "1"), pair("b.mtek", "3")], "x")
        );
        assert_ne!(
            a,
            identity(vec![pair("a.mtek", "1"), pair("b.mtek", "2")], "y")
        );
    }
}
