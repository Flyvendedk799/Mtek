//! Tags (decision 0150): `tag: "name";` on an entity or prefab, and the built-ins that find
//! entities by it.
//!
//! * A tag is a string constant of 1 to 32 lowercase letters, digits and `_`, starting with a
//!   letter (`E5220`).
//! * The tag argument of `count_tagged`, `first_tagged`, `nearest_tagged`, `has_tag`, `tagged`
//!   and `destroy_tagged` is a string constant (`E5221`) that some entity or prefab of the program
//!   declares (`E5222`, checked over the whole program by [`check_tags`]).
//! * `destroy_tagged` removes spawned entities; a tag that a named entity has (its own, or its
//!   prefab's for a placed instance) cannot be destroyed (`E5223`).
//! * `tagged(tag)` is only the iterable of a `for` loop (`E5224`): `for r in tagged("rock") { .. }`.

use std::collections::BTreeMap;

use super::check::Checker;
use super::consteval::Folded;
use super::prefab::strip_parens;
use super::scene::{CheckedEntity, CheckedField, FieldOrigin};
use super::ty::TyId;
use super::value::ConstValue;
use super::{PrefabKey, Typeck};
use crate::diagnostics::{Code, Diagnostic, Diagnostics};
use crate::source::Span;
use crate::syntax::ast::{Expr, ExprKind};

/// The built-ins that take a tag, with the index of the tag argument.
pub(crate) const TAG_FUNCTIONS: [(&str, usize); 6] = [
    ("count_tagged", 0),
    ("first_tagged", 0),
    ("nearest_tagged", 0),
    ("has_tag", 1),
    ("tagged", 0),
    ("destroy_tagged", 0),
];

/// The longest tag.
pub const MAX_TAG_LEN: usize = 32;

/// One use of a tag by a built-in, with a constant tag.
#[derive(Clone, Debug, PartialEq)]
pub struct TagUse {
    pub function: &'static str,
    /// The tag argument.
    pub span: Span,
    pub tag: String,
}

/// Whether `tag` is a valid tag: `[a-z][a-z0-9_]*`, at most [`MAX_TAG_LEN`] bytes.
#[must_use]
pub fn valid_tag(tag: &str) -> bool {
    let mut chars = tag.chars();
    tag.len() <= MAX_TAG_LEN
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

impl Checker<'_> {
    /// Before a call of the tag built-in `name` is checked: `tagged` outside the iterable of a
    /// `for` loop is `E5224`; answers `false` then (the call is not checked further).
    pub(super) fn tag_call_allowed(&mut self, expr: &Expr, name: &str, args: &[Expr]) -> bool {
        if name != "tagged" || self.tagged_iterables.contains(&expr.id) {
            return true;
        }
        self.synth_args(args);
        let example = args.first().map_or_else(
            || "\"rock\"".to_owned(),
            |arg| self.snippet(arg.span).to_owned(),
        );
        self.report(
            Diagnostic::new(
                Code::E5224,
                "`tagged(..)` is not a value: it can only be the iterable of a `for` loop.",
            )
            .at(expr.span)
            .expected("`for r in tagged(..) { .. }`")
            .actual("`tagged(..)` used as a value")
            .note("the entities with a tag change as they are spawned and destroyed, so they are visited by a loop, not kept")
            .help(format!(
                "write `for r in tagged({example}) {{ .. }}`, or use `count_tagged({example})`, `first_tagged({example})` or `nearest_tagged({example}, point)`"
            )),
        );
        false
    }

    /// After a call of the tag built-in `name` was checked: its tag argument is a string
    /// constant (`E5221`); records the use for [`check_tags`].
    pub(super) fn note_tag_argument(&mut self, name: &'static str, args: &[Expr]) {
        let Some(&(_, index)) = TAG_FUNCTIONS.iter().find(|(n, _)| *n == name) else {
            return;
        };
        let Some(arg) = args.get(index) else {
            return;
        };
        if self.ty_of(arg.id) != Some(TyId::STRING) {
            return;
        }
        match self.fold(arg) {
            Folded::Value(ConstValue::Str(tag)) => {
                self.out.tag_uses.push(TagUse {
                    function: name,
                    span: arg.span,
                    tag,
                });
            }
            Folded::Unknown => {}
            _ => {
                let found = match &strip_parens(arg).kind {
                    ExprKind::Name(_) => "a name that is not a constant",
                    _ => "an expression computed at run time",
                };
                self.report(
                    Diagnostic::new(
                        Code::E5221,
                        format!("The tag argument of `{name}` must be a string constant, but it is {found}."),
                    )
                    .at(arg.span)
                    .expected("a string literal such as \"rock\", or a `const` string")
                    .actual(found)
                    .note("tags are fixed where entities and prefabs declare them, so every use is checked against them when the program is built")
                    .help("write the tag itself, for example `count_tagged(\"rock\")`"),
                );
            }
        }
    }
}

/// A tag some entity or prefab declares.
struct Declared {
    /// The `tag: ..;` member.
    span: Span,
    /// A named entity has it (its own tag, or its prefab's for a placed instance).
    named: Option<(String, Span)>,
}

/// The tag of a checked body, with the span of its `tag: ..;` member.
fn tag_of(fields: &[CheckedField]) -> Option<(&str, Span)> {
    let field = fields.iter().find(|f| f.name == "tag")?;
    let FieldOrigin::Written { span, .. } = field.origin else {
        return None;
    };
    match &field.value {
        Some(ConstValue::Str(tag)) => Some((tag, span)),
        _ => None,
    }
}

/// The tag rules over the whole program (decision 0150): `E5220`, `E5222` and `E5223`.
pub fn check_tags(typecks: &[&Typeck], sink: &mut Diagnostics) {
    // The tag of every prefab, by its key.
    let mut prefab_tags: BTreeMap<PrefabKey, (String, Span)> = BTreeMap::new();
    let mut declared: BTreeMap<String, Declared> = BTreeMap::new();
    let mut invalid = Vec::new();
    for typeck in typecks {
        for prefab in typeck.checked_prefabs() {
            let Some((tag, span)) = tag_of(&prefab.fields) else {
                continue;
            };
            if !valid_tag(tag) {
                invalid.push((tag.to_owned(), span));
                continue;
            }
            if let Some(info) = prefab.def.and_then(|def| typeck.prefab(def)) {
                prefab_tags.insert(info.key, (tag.to_owned(), span));
            }
            declared
                .entry(tag.to_owned())
                .or_insert(Declared { span, named: None });
        }
    }
    for typeck in typecks {
        for scene in typeck.scenes() {
            let mut pending: Vec<&CheckedEntity> = scene.entities.iter().collect();
            while let Some(entity) = pending.pop() {
                pending.extend(entity.children.iter());
                let own = tag_of(&entity.fields).map(|(tag, span)| (tag.to_owned(), span));
                let carried = own.or_else(|| {
                    entity
                        .instance
                        .as_ref()
                        .and_then(|instance| prefab_tags.get(&instance.prefab).cloned())
                });
                let Some((tag, span)) = carried else {
                    continue;
                };
                if !valid_tag(&tag) {
                    if entity.instance.is_none() {
                        invalid.push((tag, span));
                    }
                    continue;
                }
                let entry = declared
                    .entry(tag)
                    .or_insert(Declared { span, named: None });
                if entry.named.is_none() {
                    entry.named = Some((entity.name.clone(), entity.name_span));
                }
            }
        }
    }
    invalid.sort_by_key(|(_, span)| (span.file, span.start));
    for (tag, span) in invalid {
        sink.push(
            Diagnostic::new(Code::E5220, format!("'{tag}' is not a valid tag."))
                .at(span)
                .expected(format!(
                    "1 to {MAX_TAG_LEN} lowercase letters, digits and `_`, starting with a letter"
                ))
                .actual(format!("{tag:?}"))
                .help(format!("for example `tag: \"{}\";`", suggest(&tag))),
        );
    }
    for typeck in typecks {
        for used in typeck.tag_uses() {
            match declared.get(&used.tag) {
                None => sink.push(unknown_tag(used, &declared)),
                Some(Declared {
                    named: Some((entity, entity_span)),
                    ..
                }) if used.function == "destroy_tagged" => sink.push(
                    Diagnostic::new(
                        Code::E5223,
                        format!(
                            "`destroy_tagged` cannot remove the tag '{}': the named entity '{entity}' has it.",
                            used.tag
                        ),
                    )
                    .at(used.span)
                    .related(*entity_span, format!("the entity '{entity}' is declared here"))
                    .note("named entities are part of the scene and cannot be destroyed; `destroy_tagged` removes spawned entities")
                    .help(format!("give the spawned entities a tag of their own, for example `tag: \"{}_spawned\";` in their prefab, and destroy that one", used.tag)),
                ),
                Some(_) => {}
            }
        }
    }
}

fn unknown_tag(used: &TagUse, declared: &BTreeMap<String, Declared>) -> Diagnostic {
    let mut diagnostic = Diagnostic::new(
        Code::E5222,
        format!(
            "No entity or prefab of the program has the tag '{}'.",
            used.tag
        ),
    )
    .at(used.span)
    .expected("a tag declared with `tag: \"..\";`")
    .actual(format!("{:?}", used.tag));
    let close = declared
        .keys()
        .filter(|tag| crate::project::edit_distance(tag, &used.tag) <= 2)
        .min_by_key(|tag| crate::project::edit_distance(tag, &used.tag));
    if let Some(close) = close {
        diagnostic = diagnostic
            .related(
                declared[close].span,
                format!("the tag '{close}' is declared here"),
            )
            .help(format!("did you mean \"{close}\"?"));
    } else if declared.is_empty() {
        diagnostic = diagnostic.help(format!(
            "declare the tag on the entities or prefabs to find: `tag: \"{}\";`",
            used.tag
        ));
    } else {
        let list: Vec<String> = declared.keys().map(|t| format!("\"{t}\"")).collect();
        diagnostic = diagnostic.help(format!("the tags of the program are {}", list.join(", ")));
    }
    diagnostic
}

/// A valid tag close to `tag`, for advice.
fn suggest(tag: &str) -> String {
    let lowered: String = tag
        .chars()
        .map(|c| c.to_ascii_lowercase())
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let word = lowered.trim_matches('_');
    let word = match word.chars().next() {
        None => "tag".to_owned(),
        Some(c) if c.is_ascii_lowercase() => word.to_owned(),
        Some(_) => format!("t{word}"),
    };
    word.chars().take(MAX_TAG_LEN).collect()
}

#[cfg(test)]
mod tests {
    use super::{suggest, valid_tag};

    #[test]
    fn tags_are_lowercase_words() {
        assert!(valid_tag("rock"));
        assert!(valid_tag("enemy_2"));
        assert!(!valid_tag(""));
        assert!(!valid_tag("Rock"));
        assert!(!valid_tag("2fast"));
        assert!(!valid_tag("a-b"));
        assert!(!valid_tag(&"a".repeat(33)));
        assert!(valid_tag(&suggest("Big Rock")));
        assert!(valid_tag(&suggest("2fast")));
        assert!(valid_tag(&suggest("")));
    }
}
