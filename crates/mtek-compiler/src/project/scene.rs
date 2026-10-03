//! Choosing the entry scene (`spec/tooling.md` section 3, `project.scene`).
//!
//! The rule is independent of the parser, so it lives with the configuration:
//! the checker passes the names of the scenes the entry module declares and
//! turns the answer into `E9006` with the spans it has.

/// The outcome of [`select_scene`].
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SceneSelection {
    /// The scene at this index of the declared scenes.
    Selected(usize),
    /// `project.scene` names no declared scene, or no scene is declared and
    /// none was configured: `E9006`.
    NotFound,
    /// Several scenes are declared and `project.scene` is not set: `E9006`.
    Ambiguous,
}

/// Select the entry scene from the scenes `declared` by the entry module, in
/// source order.
///
/// With `project.scene` set (`configured`), the scene of that name is
/// selected whatever else is declared. Without it, the module must declare
/// exactly one scene ("required if the entry module declares more than one
/// scene"). If a name is declared twice (itself an error elsewhere) the first
/// one is selected.
#[must_use]
pub fn select_scene<S: AsRef<str>>(configured: Option<&str>, declared: &[S]) -> SceneSelection {
    match configured {
        Some(name) => declared
            .iter()
            .position(|scene| scene.as_ref() == name)
            .map_or(SceneSelection::NotFound, SceneSelection::Selected),
        None => match declared.len() {
            0 => SceneSelection::NotFound,
            1 => SceneSelection::Selected(0),
            _ => SceneSelection::Ambiguous,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_single_scene_needs_no_configuration() {
        assert_eq!(select_scene(None, &["Demo"]), SceneSelection::Selected(0));
    }

    #[test]
    fn several_scenes_need_a_configured_name() {
        assert_eq!(
            select_scene(None, &["Menu", "Demo"]),
            SceneSelection::Ambiguous
        );
        assert_eq!(
            select_scene(Some("Demo"), &["Menu", "Demo"]),
            SceneSelection::Selected(1)
        );
    }

    #[test]
    fn a_configured_name_must_be_declared() {
        assert_eq!(
            select_scene(Some("Missing"), &["Menu", "Demo"]),
            SceneSelection::NotFound
        );
        assert_eq!(
            select_scene(Some("Missing"), &["Demo"]),
            SceneSelection::NotFound
        );
        assert_eq!(
            select_scene(Some("demo"), &["Demo"]),
            SceneSelection::NotFound,
            "names are case-sensitive"
        );
    }

    #[test]
    fn no_scene_is_not_found() {
        let none: [&str; 0] = [];
        assert_eq!(select_scene(None, &none), SceneSelection::NotFound);
        assert_eq!(select_scene(Some("Demo"), &none), SceneSelection::NotFound);
    }

    #[test]
    fn a_configured_name_selects_the_only_scene_when_it_matches() {
        assert_eq!(
            select_scene(Some("Demo"), &["Demo"]),
            SceneSelection::Selected(0)
        );
    }

    #[test]
    fn a_duplicate_name_selects_the_first() {
        assert_eq!(
            select_scene(Some("Demo"), &["Demo", "Demo"]),
            SceneSelection::Selected(0)
        );
    }

    #[test]
    fn owned_names_work_too() {
        let declared = vec!["A".to_owned(), "B".to_owned()];
        assert_eq!(
            select_scene(Some("B"), &declared),
            SceneSelection::Selected(1)
        );
    }
}
