//! Fitting a context into `--max-bytes` (`spec/ai-and-benchmarks.md` section 2, decision 0072
//! item 8).
//!
//! The context is rendered, and if the text is longer than the budget the lowest-priority items
//! are dropped and recorded in `truncated`; the order, lowest priority first:
//!
//! 1. **examples**, the least relevant first (the list is most relevant first);
//! 2. **neighbour symbols**, the last in file order first;
//! 3. **sections of the built-in library** (`reference`, cold-start projects only), in the order of
//!    [`REFERENCE_SECTIONS`](super::model::REFERENCE_SECTIONS);
//! 4. **schemas**, the last by name first;
//! 5. **the requested symbols** (or the entry scene's declarations), the last first.
//!
//! An item of a later phase is only dropped once every item of the phases before it is gone, and
//! within a phase the fewest items are dropped that make the text fit. The version fields,
//! `supported`, `syntax`, `project` and `diagnosticsGuide` are never dropped. If the text is
//! still too long with everything droppable gone, there is no context for that budget and the
//! caller learns the smallest budget that works.
//!
//! The number of items to drop in a phase is found by bisection (dropping more items always makes
//! the text shorter: an item is longer than the name `truncated` keeps of it), so the cost is a
//! handful of renderings however large the project is.

use super::model::{Context, render};

/// A context and which of its symbols are neighbours rather than requested.
#[derive(Clone, Debug)]
pub struct Draft {
    pub context: Context,
    /// `neighbour[i]` says whether `context.symbols[i]` is one reference away from the
    /// requested symbols rather than one of them.
    pub neighbour: Vec<bool>,
}

/// What can be dropped, in the order it is dropped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Examples,
    Neighbours,
    Reference,
    Schemas,
    Symbols,
}

const PHASES: [Phase; 5] = [
    Phase::Examples,
    Phase::Neighbours,
    Phase::Reference,
    Phase::Schemas,
    Phase::Symbols,
];

impl Draft {
    /// How many items `phase` can still drop.
    fn available(&self, phase: Phase) -> usize {
        match phase {
            Phase::Examples => self.context.examples.len(),
            Phase::Neighbours => self.neighbour.iter().filter(|n| **n).count(),
            Phase::Reference => self.context.reference.sections().len(),
            Phase::Schemas => self.context.schemas.len(),
            Phase::Symbols => self.neighbour.iter().filter(|n| !**n).count(),
        }
    }

    /// A copy without the last `count` items of `phase`, recorded in `truncated`.
    fn dropping(&self, phase: Phase, count: usize) -> Draft {
        let mut draft = self.clone();
        let mut dropped = draft.context.truncated.take().unwrap_or_default();
        for _ in 0..count {
            match phase {
                Phase::Examples => {
                    if let Some(example) = draft.context.examples.pop() {
                        dropped.examples.push(example.title);
                    }
                }
                Phase::Neighbours | Phase::Symbols => {
                    let wanted = phase == Phase::Neighbours;
                    if let Some(index) = draft.neighbour.iter().rposition(|n| *n == wanted) {
                        draft.neighbour.remove(index);
                        let symbol = draft.context.symbols.remove(index);
                        match phase {
                            Phase::Neighbours => dropped.neighbours.push(symbol.name),
                            _ => dropped.symbols.push(symbol.name),
                        }
                    }
                }
                Phase::Reference => {
                    if let Some(section) = draft.context.reference.sections().first().copied() {
                        draft.context.reference.clear(section);
                        dropped.reference.push(section.to_owned());
                    }
                }
                Phase::Schemas => {
                    if let Some(schema) = draft.context.schemas.pop() {
                        dropped.schemas.push(schema.name);
                    }
                }
            }
        }
        draft.context.truncated = Some(dropped).filter(|dropped| !dropped.is_empty());
        draft
    }
}

/// Fit `draft` into `max_bytes`: the context and its text. `Err(minimum)` is the size of the
/// smallest context there is, when that is still larger than `max_bytes`.
pub fn fit(draft: Draft, max_bytes: usize) -> Result<(Context, String), usize> {
    let text = render(&draft.context);
    if text.len() <= max_bytes {
        return Ok((draft.context, text));
    }
    let mut current = draft;
    for phase in PHASES {
        let available = current.available(phase);
        let all = current.dropping(phase, available);
        if render(&all.context).len() > max_bytes {
            // Not even all of this phase is enough: drop it and go on to the next.
            current = all;
            continue;
        }
        // Some number of items from 1 to `available` makes the text fit (none does not):
        // the smallest such number.
        let (mut low, mut high) = (1, available);
        while low < high {
            let middle = low + (high - low) / 2;
            if render(&current.dropping(phase, middle).context).len() <= max_bytes {
                high = middle;
            } else {
                low = middle + 1;
            }
        }
        let fitted = current.dropping(phase, low).context;
        let text = render(&fitted);
        return Ok((fitted, text));
    }
    Err(render(&current.context).len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::model::{
        ExampleEntry, ProjectSection, Reference, SchemaEntry, Supported, SymbolEntry,
        SyntaxSection,
    };

    fn symbol(name: &str) -> SymbolEntry {
        SymbolEntry {
            name: name.to_owned(),
            kind: "entity".to_owned(),
            ty: "entity".to_owned(),
            doc: format!("The entity {name}."),
            file: "src/main.mtek".to_owned(),
            line: 1,
        }
    }

    /// Five symbols (two of them neighbours), three schemas and four examples.
    fn draft() -> Draft {
        let schemas = ["A", "B", "C"].map(|name| SchemaEntry {
            name: name.to_owned(),
            doc: None,
            fields: vec!["size: vec3 [C]".to_owned()],
        });
        let examples = ["one", "two", "three", "four"].map(|title| ExampleEntry {
            title: title.to_owned(),
            source: format!("// {title}\n// {}\nscene Demo {{}}\n", "x".repeat(300)),
        });
        Draft {
            context: Context {
                language_version: "0.1",
                compiler_version: "0.1.0-dev",
                context_format: 2,
                supported: Supported {
                    features: vec!["scenes".to_owned()],
                    not_supported: vec!["while".to_owned()],
                },
                syntax: SyntaxSection {
                    keywords: vec!["fn".to_owned()],
                    precedence: vec!["level 1: ||".to_owned()],
                    rules: vec!["End with ';'.".to_owned()],
                },
                project: ProjectSection {
                    entry: "src/main.mtek".to_owned(),
                    scene: Some("Demo".to_owned()),
                    modules: vec!["src/main.mtek".to_owned()],
                },
                symbols: ["n0", "s0", "s1", "n1", "s2"].map(symbol).to_vec(),
                schema_guide: "Read the lines.",
                schemas: schemas.to_vec(),
                reference: Reference::default(),
                examples: examples.to_vec(),
                diagnostics_guide: "Read the diagnostics.",
                truncated: None,
            },
            neighbour: vec![true, false, false, true, false],
        }
    }

    /// The obvious algorithm: drop one item at a time, in order, until the text fits.
    fn one_by_one(draft: &Draft, max_bytes: usize) -> Result<(Context, String), usize> {
        let mut current = draft.clone();
        loop {
            let text = render(&current.context);
            if text.len() <= max_bytes {
                return Ok((current.context, text));
            }
            match PHASES.iter().find(|phase| current.available(**phase) > 0) {
                Some(phase) => current = current.dropping(*phase, 1),
                None => return Err(text.len()),
            }
        }
    }

    #[test]
    fn bisection_drops_exactly_what_dropping_one_at_a_time_drops() {
        let draft = draft();
        let full = render(&draft.context).len();
        let mut fitted = 0;
        for max_bytes in 0..=full + 10 {
            let by_bisection = fit(draft.clone(), max_bytes);
            let by_hand = one_by_one(&draft, max_bytes);
            match (&by_bisection, &by_hand) {
                (Ok(a), Ok(b)) => {
                    assert_eq!(a.1, b.1, "{max_bytes}");
                    assert!(a.1.len() <= max_bytes);
                    fitted += 1;
                }
                (Err(a), Err(b)) => assert_eq!(a, b, "{max_bytes}"),
                _ => panic!("{max_bytes}: {by_bisection:?} against {by_hand:?}"),
            }
        }
        assert!(fitted > 100);
    }

    #[test]
    fn items_are_dropped_in_the_documented_order() {
        let draft = draft();
        let dropped = |max_bytes| {
            fit(draft.clone(), max_bytes)
                .unwrap()
                .0
                .truncated
                .unwrap_or_default()
        };
        let full = render(&draft.context).len();
        // One example short: the last one only.
        let one = fit(draft.clone(), full - 1).unwrap().0.truncated.unwrap();
        assert_eq!(one.examples.count, 1);
        assert_eq!(one.examples.names, ["four"]);
        assert!(one.neighbours.is_empty() && one.schemas.is_empty() && one.symbols.is_empty());
        // Everything down to the last example is dropped before a neighbour is.
        let none = render(&draft.dropping(Phase::Examples, 4).context).len();
        let t = dropped(none);
        assert_eq!(t.examples.names, ["four", "three", "two", "one"]);
        assert!(t.neighbours.is_empty());
        let t = dropped(none - 1);
        assert_eq!(t.neighbours.names, ["n1"]);
        assert!(t.schemas.is_empty() && t.symbols.is_empty());
    }

    #[test]
    fn nothing_dropped_means_no_truncated_field() {
        let draft = draft();
        let full = render(&draft.context);
        let (context, text) = fit(draft, full.len()).unwrap();
        assert!(context.truncated.is_none());
        assert_eq!(text, full);
        assert!(!text.contains("truncated"));
    }
}
