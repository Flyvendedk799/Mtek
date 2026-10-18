//! The example library: complete programs that `mtek check` accepts, each shown to an agent when
//! the neighbourhood it works in uses the features the example is about (decision 0072 item 7).
//!
//! The sources are the files in `examples/` next to this module, embedded with `include_str!`.
//! The *tags* are not written down anywhere: the features of an example are computed from its
//! syntax tree and name resolution by the code that computes the features of a project
//! ([`Program::used_features`]), so a tag cannot name something the example does not use, and
//! the examples a neighbourhood gets are those that share its features.
//!
//! Every example is checked by `tests/context.rs` on every build, and so is every example in an
//! emitted context.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use super::program::{ModuleCtx, Program};
use crate::diagnostics::Diagnostics;
use crate::resolve::resolve_module;
use crate::source::{ProjectPath, SourceMap};
use crate::syntax::{lex, parse_module};

/// One example.
#[derive(Clone, Copy, Debug)]
pub struct Example {
    /// What the example shows, as a short sentence.
    pub title: &'static str,
    /// A complete entry module.
    pub source: &'static str,
}

/// The example library, in the order of its files.
pub const LIBRARY: [Example; 11] = [
    Example {
        title: "A scene with a camera and a cube",
        source: include_str!("examples/01-scene-camera-cube.mtek"),
    },
    Example {
        title: "Bind a material parameter to scene state",
        source: include_str!("examples/02-bind-material-parameter.mtek"),
    },
    Example {
        title: "Animate an entity in update",
        source: include_str!("examples/03-update-lifecycle.mtek"),
    },
    Example {
        title: "React to a key press",
        source: include_str!("examples/04-key-handler.mtek"),
    },
    Example {
        title: "Constants, structs and functions",
        source: include_str!("examples/05-functions-constants-structs.mtek"),
    },
    Example {
        title: "A material with a fragment stage",
        source: include_str!("examples/06-material-fragment.mtek"),
    },
    Example {
        title: "Lights and the Pbr material",
        source: include_str!("examples/07-lights-pbr.mtek"),
    },
    Example {
        title: "Prefabs and prefab instances",
        source: include_str!("examples/08-prefab-instances.mtek"),
    },
    Example {
        title: "Spawn and destroy entities",
        source: include_str!("examples/09-spawn-destroy.mtek"),
    },
    Example {
        title: "Physics bodies and collision events",
        source: include_str!("examples/10-physics-collision.mtek"),
    },
    Example {
        title: "Pointer events and arrays",
        source: include_str!("examples/11-pointer-arrays.mtek"),
    },
];

/// The most examples one context carries.
pub const MAX_EXAMPLES: usize = 4;

/// The features `example` uses, named as in `supported.features`.
#[must_use]
pub fn features_of(example: &Example) -> BTreeSet<String> {
    let mut sources = SourceMap::new();
    let Ok(path) = ProjectPath::new("src/main.mtek") else {
        return BTreeSet::new();
    };
    let Ok(file) = sources.add(path, example.source.as_bytes()) else {
        return BTreeSet::new();
    };
    let Some(source) = sources.get(file) else {
        return BTreeSet::new();
    };
    let mut sink = Diagnostics::new();
    let lexed = lex(source);
    let parsed = parse_module(source.text(), &lexed.tokens, &lexed.trivia, &mut sink);
    let resolution = resolve_module(&parsed.module, &mut sink);
    let ctx = ModuleCtx::new(
        source.path().to_string(),
        source,
        &parsed.module,
        &resolution,
        None,
    );
    let program = Program::new(vec![Some(ctx)]);
    let everything: BTreeSet<usize> = (0..program.decls.len()).collect();
    program.used_features(&everything)
}

/// The features of every example of [`LIBRARY`], computed once.
fn library_features() -> &'static [BTreeSet<String>] {
    static FEATURES: OnceLock<Vec<BTreeSet<String>>> = OnceLock::new();
    FEATURES.get_or_init(|| LIBRARY.iter().map(features_of).collect())
}

/// The examples that share features with `used`, most relevant first: at most [`MAX_EXAMPLES`].
///
/// The score of an example is the weighted Jaccard similarity of its features and `used`: the
/// weight of the features they share over the weight of the features either has. A feature
/// weighs the more the fewer examples use it (a feature every example has, such as `scenes`, says
/// little). Ties go to the shorter example, then to the order of the library.
#[must_use]
pub fn select(used: &BTreeSet<String>) -> Vec<&'static Example> {
    let features = library_features();
    let mut users: BTreeMap<&str, u64> = BTreeMap::new();
    for set in features {
        for feature in set {
            *users.entry(feature.as_str()).or_default() += 1;
        }
    }
    let weight = |feature: &String| 1000 / users.get(feature.as_str()).copied().unwrap_or(1).max(1);
    let mut scored: Vec<(u64, usize)> = features
        .iter()
        .enumerate()
        .filter_map(|(index, set)| {
            let shared: u64 = set.intersection(used).map(weight).sum();
            let either: u64 = set.union(used).map(weight).sum();
            (shared > 0).then(|| (1_000_000 * shared / either.max(1), index))
        })
        .collect();
    scored.sort_by_key(|(score, index)| {
        (
            std::cmp::Reverse(*score),
            LIBRARY
                .get(*index)
                .map_or(0, |example| example.source.len()),
            *index,
        )
    });
    scored
        .into_iter()
        .take(MAX_EXAMPLES)
        .filter_map(|(_, index)| LIBRARY.get(index))
        .collect()
}
