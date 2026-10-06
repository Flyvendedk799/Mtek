//! `mtek new NAME`: scaffold a project from the built-in Demo template
//! (`spec/tooling.md` section 1).
//!
//! Writes `mtek.toml` (with `[host.inputs] tint = "Demo.tint"`), `src/main.mtek`
//! (the blueprint §3.1 `Demo`), and `.gitignore` into a new directory named `NAME`.

use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::{EXIT_ERRORS, EXIT_INTERNAL, EXIT_USAGE, Outcome};

/// The `.gitignore` written into every new project.
pub const GITIGNORE: &str = include_str!("../templates/gitignore");

/// The body of `src/main.mtek`: the blueprint §3.1 complete `Demo`.
pub const MAIN_MTEK: &str = include_str!("../templates/main.mtek");

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

/// Contents of `mtek.toml` for a project named `name`.
pub fn mtek_toml(name: &str) -> String {
    let title = title_for(name);
    format!(
        "\
[project]
name = \"{name}\"
language = \"0.1\"
entry = \"src/main.mtek\"
scene = \"Demo\"

[build]
target = \"web\"
title = \"{title}\"

[host.inputs]
tint = \"Demo.tint\"
"
    )
}

/// The three files a scaffold writes, as `(relative path, contents)`.
pub fn template_files(name: &str) -> [(&'static str, String); 3] {
    [
        ("mtek.toml", mtek_toml(name)),
        ("src/main.mtek", MAIN_MTEK.to_owned()),
        (".gitignore", GITIGNORE.to_owned()),
    ]
}

/// Create the scaffold under `cwd/name`.
pub fn create(cwd: &Path, name: &str) -> Outcome {
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
    for (rel, contents) in template_files(name) {
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
    Outcome::stdout(format!(
        "created '{name}' with the Demo scene (mtek.toml, src/main.mtek, .gitignore)\n"
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
