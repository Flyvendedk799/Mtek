//! `mtek new NAME [--template demo|game]`: scaffold a project (`spec/tooling.md` section 1).
//!
//! `demo` writes `mtek.toml` (with `[host.inputs] tint = "Demo.tint"`), `src/main.mtek`
//! (the blueprint §3.1 `Demo`), and `.gitignore`. `game` writes a two-scene game and no host input.

use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::{EXIT_ERRORS, EXIT_INTERNAL, EXIT_USAGE, Outcome};

/// The `.gitignore` written into every new project.
pub const GITIGNORE: &str = include_str!("../templates/gitignore");

/// The body of `src/main.mtek`: the blueprint §3.1 complete `Demo`.
pub const MAIN_MTEK: &str = include_str!("../templates/main.mtek");

/// The body of `src/main.mtek` for `--template game`.
pub const GAME_MTEK: &str = include_str!("../templates/game.mtek");

/// Which scaffold `mtek new --template` writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectTemplate {
    /// The pulse-cube Demo.
    Demo,
    /// Title and Play, with tags, a saved best score and a pause key.
    Game,
}

/// Whether `name` is a valid project / directory name (`[a-z0-9-]+`).
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Human title for `[build].title`: hyphenated segments capitalised.
pub fn title_for(name: &str) -> String {
    name.split('-')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    let mut out = first.to_uppercase().collect::<String>();
                    out.push_str(chars.as_str());
                    out
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Contents of `mtek.toml` for a project named `name` (the Demo template).
pub fn mtek_toml(name: &str) -> String {
    mtek_toml_for(name, ProjectTemplate::Demo, None)
}

/// A fresh save id for `mtek new --template game` (decision 0179): 8 lowercase hexadecimal digits
/// from the clock and the randomly seeded hasher of the standard library. It only has to differ
/// between two projects of one name.
pub fn new_save_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    hasher.write_u128(nanos);
    hasher.write_u32(std::process::id());
    format!("{:08x}", hasher.finish() & 0xffff_ffff)
}

/// Contents of `mtek.toml` for `template`; `id` is the save id of a game (decision 0179).
pub fn mtek_toml_for(name: &str, template: ProjectTemplate, id: Option<&str>) -> String {
    let title = title_for(name);
    let scene = match template {
        ProjectTemplate::Demo => "Demo",
        ProjectTemplate::Game => "Title",
    };
    let host = match template {
        ProjectTemplate::Demo => "\n[host.inputs]\ntint = \"Demo.tint\"\n",
        ProjectTemplate::Game => "\n",
    };
    let id = id.map_or_else(String::new, |id| format!("id = \"{id}\"\n"));
    format!(
        "\
[project]
name = \"{name}\"
language = \"0.1\"
entry = \"src/main.mtek\"
scene = \"{scene}\"
{id}
[build]
target = \"web\"
title = \"{title}\"
{host}"
    )
}

/// The three files a scaffold writes, as `(relative path, contents)`.
pub fn template_files(
    name: &str,
    template: ProjectTemplate,
    id: Option<&str>,
) -> [(&'static str, String); 3] {
    let main = match template {
        ProjectTemplate::Demo => MAIN_MTEK,
        ProjectTemplate::Game => GAME_MTEK,
    };
    let toml = match template {
        ProjectTemplate::Demo => mtek_toml(name),
        ProjectTemplate::Game => mtek_toml_for(name, template, id),
    };
    [
        ("mtek.toml", toml),
        ("src/main.mtek", main.to_owned()),
        (".gitignore", GITIGNORE.to_owned()),
    ]
}

/// Create the scaffold under `cwd/name`.
pub fn create(cwd: &Path, name: &str, template: ProjectTemplate) -> Outcome {
    if !valid_name(name) {
        return Outcome {
            stdout: String::new(),
            stderr: format!(
                "error: project name '{name}' must be a non-empty name of lowercase letters, digits and hyphens ([a-z0-9-]+)\n"
            ),
            code: EXIT_USAGE,
        };
    }
    let dir: PathBuf = cwd.join(name);
    if dir.exists() {
        return Outcome {
            stdout: String::new(),
            stderr: format!(
                "error: cannot create '{name}': path already exists ({})\n",
                dir.display()
            ),
            code: EXIT_ERRORS,
        };
    }
    if let Err(error) = fs::create_dir_all(dir.join("src")) {
        return Outcome {
            stdout: String::new(),
            stderr: format!("error: cannot create '{name}': {error}\n"),
            code: EXIT_INTERNAL,
        };
    }
    let id = (template == ProjectTemplate::Game).then(new_save_id);
    for (rel, contents) in template_files(name, template, id.as_deref()) {
        let path = dir.join(rel);
        if let Err(error) = fs::write(&path, contents) {
            let _ = fs::remove_dir_all(&dir);
            return Outcome {
                stdout: String::new(),
                stderr: format!("error: cannot write '{}': {error}\n", path.display()),
                code: EXIT_INTERNAL,
            };
        }
    }
    let label = match template {
        ProjectTemplate::Demo => "the Demo scene",
        ProjectTemplate::Game => "the small-game template",
    };
    Outcome::stdout(format!(
        "created '{name}' with {label} (mtek.toml, src/main.mtek, .gitignore)\n"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_names() {
        assert!(valid_name("pulse-cube"));
        assert!(valid_name("a"));
        assert!(valid_name("x0"));
        assert!(!valid_name(""));
        assert!(!valid_name("Pulse"));
        assert!(!valid_name("pulse_cube"));
        assert!(!valid_name("pulse cube"));
        assert!(!valid_name("../evil"));
    }

    #[test]
    fn a_game_gets_a_save_id_and_a_demo_does_not() {
        let id = new_save_id();
        assert_eq!(id.len(), 8);
        assert!(
            id.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        );
        assert_ne!(
            id,
            new_save_id(),
            "two scaffolds of one name must not share an id"
        );
        let game = mtek_toml_for("my-game", ProjectTemplate::Game, Some(&id));
        assert!(
            game.contains(&format!("scene = \"Title\"\nid = \"{id}\"\n")),
            "{game}"
        );
        assert!(!mtek_toml("my-game").contains("id ="));
    }

    #[test]
    fn title_capitalises_segments() {
        assert_eq!(title_for("pulse-cube"), "Pulse Cube");
        assert_eq!(title_for("demo"), "Demo");
    }

    #[test]
    fn toml_has_host_input_and_scene() {
        let text = mtek_toml("pulse-cube");
        assert!(text.contains("name = \"pulse-cube\""));
        assert!(text.contains("scene = \"Demo\""));
        assert!(text.contains("tint = \"Demo.tint\""));
        assert!(text.contains("title = \"Pulse Cube\""));
    }

    #[test]
    fn main_is_the_blueprint_demo() {
        assert!(MAIN_MTEK.contains("fn pulse("));
        assert!(MAIN_MTEK.contains("material Pulse"));
        assert!(MAIN_MTEK.contains("scene Demo"));
        assert!(MAIN_MTEK.contains("bind(frame.time)"));
        assert!(MAIN_MTEK.contains("on key_down(Key.Space)"));
        assert!(MAIN_MTEK.contains("update(dt: f32)"));
        assert!(MAIN_MTEK.contains("speed = -speed"));
    }
}
