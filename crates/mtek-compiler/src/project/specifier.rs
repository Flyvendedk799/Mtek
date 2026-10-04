//! Import specifiers (`spec/language.md` section 9.1, decision 0036).
//!
//! [`resolve_specifier`] turns the string of `import { … } from "<specifier>";`
//! into the project path of the imported module, or says which rule it
//! breaks. It is pure: whether the file exists, and whether its case matches
//! (`E2032`, `E2036`), is the loader's question ([`super::modules`]).
//!
//! The rules, checked in this order (the first that fails is reported):
//!
//! 1. the specifier is not empty, has no backslash, is not absolute (`/…`,
//!    `C:…`) — otherwise `E2030`;
//! 2. it starts with `./` or `../`; a specifier that starts with neither and
//!    not with `.` is a *bare* specifier, a package import (`E2034`); one
//!    that starts with `.` otherwise (`.hidden.mtek`, `..`) is `E2030`;
//! 3. it has no control character and no `:`, ends in `.mtek` after a
//!    non-empty file name, and has no empty segment — otherwise `E2030`;
//! 4. resolved against the importing file's directory and normalised, it
//!    stays inside the project root (`E2031`) and outside the top-level
//!    directory `std/`, which is reserved for the embedded standard library
//!    (`E2031` as well; decision 0030 item 7).

use std::fmt;

use super::config::{RESERVED_DIRECTORY, SOURCE_EXTENSION};
use crate::source::{PathError, ProjectPath};

/// Why a specifier has an invalid form (`E2030`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InvalidSpecifier {
    Empty,
    Backslash,
    Absolute,
    /// Starts with `.` but not with `./` or `../`.
    NotRelative,
    /// Contains a control character or `:`.
    Character(char),
    /// Does not end in `.mtek` after a non-empty file name.
    Extension,
    /// Contains `//` or ends in `/`.
    EmptySegment,
}

impl fmt::Display for InvalidSpecifier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InvalidSpecifier::Empty => f.write_str("the specifier is empty"),
            InvalidSpecifier::Backslash => {
                f.write_str("paths are separated by `/`, not by backslashes")
            }
            InvalidSpecifier::Absolute => {
                f.write_str("absolute paths are not allowed; a specifier starts with `./` or `../`")
            }
            InvalidSpecifier::NotRelative => f.write_str("a specifier starts with `./` or `../`"),
            InvalidSpecifier::Character(c) => {
                write!(f, "the path contains the character {c:?}")
            }
            InvalidSpecifier::Extension => write!(
                f,
                "the imported file must be named with the extension `{SOURCE_EXTENSION}`"
            ),
            InvalidSpecifier::EmptySegment => f.write_str("the path contains an empty segment"),
        }
    }
}

/// Why a specifier does not name a module of the project.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum SpecifierError {
    /// `E2030`.
    Invalid(InvalidSpecifier),
    /// `E2034`: a bare specifier such as `"physics"`.
    Bare,
    /// `E2031`: `..` segments climb above the project root.
    OutsideRoot,
    /// `E2031`: the path is inside the reserved top-level directory `std/`.
    Reserved(ProjectPath),
}

/// The project path that `specifier`, written in the module `importer`,
/// names. See the module documentation for the rules.
///
/// # Errors
/// The first rule `specifier` breaks.
pub fn resolve_specifier(
    importer: &ProjectPath,
    specifier: &str,
) -> Result<ProjectPath, SpecifierError> {
    use InvalidSpecifier as I;
    let invalid = |reason| Err(SpecifierError::Invalid(reason));
    if specifier.is_empty() {
        return invalid(I::Empty);
    }
    if specifier.contains('\\') {
        return invalid(I::Backslash);
    }
    let mut chars = specifier.chars();
    let (first, second) = (chars.next(), chars.next());
    if first == Some('/') || (first.is_some_and(|c| c.is_ascii_alphabetic()) && second == Some(':'))
    {
        return invalid(I::Absolute);
    }
    if !(specifier.starts_with("./") || specifier.starts_with("../")) {
        return if first == Some('.') {
            invalid(I::NotRelative)
        } else {
            Err(SpecifierError::Bare)
        };
    }
    if let Some(c) = specifier.chars().find(|c| c.is_control() || *c == ':') {
        return invalid(I::Character(c));
    }
    let file_name = specifier.rsplit('/').next().unwrap_or("");
    if !(file_name.len() > SOURCE_EXTENSION.len() && file_name.ends_with(SOURCE_EXTENSION)) {
        return invalid(I::Extension);
    }
    if specifier.split('/').any(str::is_empty) {
        return invalid(I::EmptySegment);
    }
    let path = importer
        .join_relative(specifier)
        .map_err(|error| match error {
            PathError::EscapesRoot => SpecifierError::OutsideRoot,
            PathError::Absolute => SpecifierError::Invalid(I::Absolute),
            PathError::Backslash => SpecifierError::Invalid(I::Backslash),
            PathError::InvalidCharacter(c) => SpecifierError::Invalid(I::Character(c)),
            // The checks above rule these out; a file name ending in `.mtek`
            // cannot normalise to the root.
            PathError::Empty | PathError::EmptySegment => SpecifierError::Invalid(I::EmptySegment),
        })?;
    if path.segments().next() == Some(RESERVED_DIRECTORY) {
        return Err(SpecifierError::Reserved(path));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> ProjectPath {
        ProjectPath::new(s).unwrap()
    }

    fn resolve(importer: &str, spec: &str) -> Result<String, SpecifierError> {
        resolve_specifier(&p(importer), spec).map(|path| path.as_str().to_owned())
    }

    #[test]
    fn relative_specifiers_resolve_against_the_importing_file() {
        assert_eq!(
            resolve("src/main.mtek", "./palette.mtek"),
            Ok("src/palette.mtek".into())
        );
        assert_eq!(
            resolve("src/main.mtek", "./lib/../lib/./a.mtek"),
            Ok("src/lib/a.mtek".into())
        );
        assert_eq!(
            resolve("src/scenes/demo.mtek", "../shared.mtek"),
            Ok("src/shared.mtek".into())
        );
        assert_eq!(resolve("main.mtek", "./a.mtek"), Ok("a.mtek".into()));
        assert_eq!(
            resolve("src/main.mtek", "../other/x.mtek"),
            Ok("other/x.mtek".into())
        );
        assert_eq!(
            resolve("src/main.mtek", "./ünï.mtek"),
            Ok("src/ünï.mtek".into())
        );
    }

    #[test]
    fn the_form_rules_are_e2030() {
        use InvalidSpecifier as I;
        let cases = [
            ("", I::Empty),
            (".\\palette.mtek", I::Backslash),
            ("..\\x\\y.mtek", I::Backslash),
            ("/src/palette.mtek", I::Absolute),
            ("C:/palette.mtek", I::Absolute),
            (".palette.mtek", I::NotRelative),
            ("..", I::NotRelative),
            (".", I::NotRelative),
            ("./pal\tette.mtek", I::Character('\t')),
            ("./a:b.mtek", I::Character(':')),
            ("./palette", I::Extension),
            ("./palette.MTEK", I::Extension),
            ("./palette.mtek.txt", I::Extension),
            ("./.mtek", I::Extension),
            ("./", I::Extension),
            ("./lib/", I::Extension),
            (".//palette.mtek", I::EmptySegment),
            ("./lib//a.mtek", I::EmptySegment),
        ];
        for (spec, reason) in cases {
            assert_eq!(
                resolve("src/main.mtek", spec),
                Err(SpecifierError::Invalid(reason)),
                "{spec:?}"
            );
        }
    }

    #[test]
    fn bare_specifiers_are_package_imports() {
        for spec in [
            "physics",
            "physics.mtek",
            "physics/vec.mtek",
            "@scope/pkg",
            "~x",
        ] {
            assert_eq!(
                resolve("src/main.mtek", spec),
                Err(SpecifierError::Bare),
                "{spec:?}"
            );
        }
    }

    #[test]
    fn escaping_the_root_is_e2031() {
        assert_eq!(
            resolve("src/main.mtek", "../../outside.mtek"),
            Err(SpecifierError::OutsideRoot)
        );
        assert_eq!(
            resolve("main.mtek", "../main.mtek"),
            Err(SpecifierError::OutsideRoot)
        );
        // Climbing out and back in is still a climb above the root.
        assert_eq!(
            resolve("src/main.mtek", "../../app/src/main.mtek"),
            Err(SpecifierError::OutsideRoot)
        );
    }

    #[test]
    fn the_reserved_std_directory_cannot_be_imported() {
        assert_eq!(
            resolve("src/main.mtek", "../std/materials.mtek"),
            Err(SpecifierError::Reserved(p("std/materials.mtek")))
        );
        assert_eq!(
            resolve("main.mtek", "./std/x.mtek"),
            Err(SpecifierError::Reserved(p("std/x.mtek")))
        );
        // Only the top-level directory is reserved.
        assert_eq!(
            resolve("src/main.mtek", "./std/x.mtek"),
            Ok("src/std/x.mtek".into())
        );
    }

    #[test]
    fn reasons_read_as_clauses() {
        assert_eq!(
            InvalidSpecifier::Extension.to_string(),
            "the imported file must be named with the extension `.mtek`"
        );
        assert_eq!(
            InvalidSpecifier::Character('\t').to_string(),
            "the path contains the character '\\t'"
        );
    }
}
