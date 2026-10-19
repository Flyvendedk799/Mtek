//! Shared helpers for diagnostics that say what to write instead
//! (decision 0113): the members of a finite set nearest to a name that does not
//! belong to it, and short human lists.
//!
//! The ranking is deterministic and depends only on the written name and the
//! candidates, never on hash order or the host.

use crate::project::edit_distance;

/// How a candidate relates to the written name; the lower the closer.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Tier {
    /// The same name up to letter case (`Key.space`).
    Case,
    /// Within edit distance 1 or 2 (`identty` for `identity`).
    Typo,
    /// The written name is a prefix, a suffix or a part of the candidate
    /// (`Up` for `ArrowUp`), ignoring letter case.
    Part,
}

/// The tier of `candidate` for the written `name`, with the edit distance;
/// `None` when the candidate is not near.
fn tier(name: &str, candidate: &str) -> Option<(Tier, usize)> {
    if name == candidate {
        return None;
    }
    let (lower_name, lower_candidate) = (name.to_lowercase(), candidate.to_lowercase());
    let distance = edit_distance(name, candidate);
    if lower_name == lower_candidate {
        return Some((Tier::Case, distance));
    }
    // A typo is a small change to a name of some length: "U" is not a typo of "Up".
    let longest = name.chars().count().max(candidate.chars().count());
    if (1..=2).contains(&distance) && distance * 2 < longest {
        return Some((Tier::Typo, distance));
    }
    if lower_name.chars().count() >= 2 && lower_candidate.contains(&lower_name) {
        return Some((Tier::Part, distance));
    }
    None
}

/// Up to `limit` of `candidates` nearest to `name`: the same name in another
/// letter case, then names within edit distance 2, then names that contain it
/// (`Up` for `ArrowUp`). Ties go by edit distance, then alphabetically.
pub(crate) fn nearest<'a>(
    name: &str,
    candidates: impl IntoIterator<Item = &'a str>,
    limit: usize,
) -> Vec<&'a str> {
    let mut near: Vec<(Tier, usize, &str)> = candidates
        .into_iter()
        .filter_map(|c| tier(name, c).map(|(t, d)| (t, d, c)))
        .collect();
    near.sort();
    near.dedup();
    near.into_iter().take(limit).map(|(_, _, c)| c).collect()
}

/// The one candidate a mechanical edit may rename `name` to: the only one of
/// the closest non-empty tier, `None` when that tier has two or more or when
/// nothing is near.
pub(crate) fn unambiguous<'a>(
    name: &str,
    candidates: impl IntoIterator<Item = &'a str>,
) -> Option<&'a str> {
    let mut near: Vec<(Tier, &str)> = candidates
        .into_iter()
        .filter_map(|c| tier(name, c).map(|(t, _)| (t, c)))
        .collect();
    near.sort();
    near.dedup();
    let best = near.first()?.0;
    let mut in_tier = near.iter().filter(|(t, _)| *t == best);
    let first = in_tier.next()?;
    if in_tier.next().is_some() {
        return None;
    }
    Some(first.1)
}

/// `a, b and c` for items already formatted.
pub(crate) fn and_list(items: &[String]) -> String {
    match items.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} and {last}", rest.join(", ")),
        Some((last, _)) => last.clone(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEYS: [&str; 8] = [
        "A",
        "ArrowDown",
        "ArrowUp",
        "Escape",
        "ShiftLeft",
        "ShiftRight",
        "Space",
        "Tab",
    ];

    #[test]
    fn part_matches_find_the_arrow_keys() {
        assert_eq!(nearest("Up", KEYS, 5), ["ArrowUp"]);
        assert_eq!(unambiguous("Up", KEYS), Some("ArrowUp"));
        assert_eq!(nearest("Down", KEYS, 5), ["ArrowDown"]);
    }

    #[test]
    fn typos_rank_before_parts_and_case_before_typos() {
        assert_eq!(nearest("space", KEYS, 5), ["Space"]);
        assert_eq!(nearest("Spce", KEYS, 5), ["Space"]);
        assert_eq!(nearest("Esc", KEYS, 5), ["Escape"]);
        assert_eq!(unambiguous("Esc", KEYS), Some("Escape"));
    }

    #[test]
    fn two_equally_near_candidates_are_ambiguous() {
        assert_eq!(nearest("Shift", KEYS, 5), ["ShiftLeft", "ShiftRight"]);
        assert_eq!(unambiguous("Shift", KEYS), None);
        assert_eq!(unambiguous("Zzzz", KEYS), None);
        assert!(nearest("Zzzz", KEYS, 5).is_empty());
    }

    #[test]
    fn the_exact_name_is_not_its_own_suggestion() {
        assert!(nearest("Tab", KEYS, 5).is_empty());
    }

    #[test]
    fn and_list_joins() {
        let items: Vec<String> = ["a", "b", "c"].iter().map(|s| (*s).to_owned()).collect();
        assert_eq!(and_list(&items), "a, b and c");
        assert_eq!(and_list(&items[..1]), "a");
        assert_eq!(and_list(&[]), "");
    }
}
