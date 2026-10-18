//! Fitting a context into `--max-bytes` (`spec/ai-and-benchmarks.md` section 2, decision 0072
//! item 8).
//!
//! The context is rendered, and while the text is longer than the budget the lowest-priority
//! item that is left is dropped and recorded in `truncated`; the order, lowest priority first:
//!
//! 1. **examples**, the least relevant first (the list is most relevant first);
//! 2. **neighbour symbols**, the last in file order first;
//! 3. **schemas**, the last by name first;
//! 4. **the requested symbols** (or the entry scene's declarations), the last first.
//!
//! The version fields, `supported`, `syntax`, `project` and `diagnosticsGuide` are never
//! dropped. If the context is still too long with everything droppable gone, there is no
//! context for that budget and the caller learns the smallest budget that works.

use super::model::{Context, Truncated, render};

/// A context and which of its symbols are neighbours rather than requested.
pub struct Draft {
    pub context: Context,
    /// `neighbour[i]` says whether `context.symbols[i]` is one reference away from the
    /// requested symbols rather than one of them.
    pub neighbour: Vec<bool>,
}

/// Fit `draft` into `max_bytes`: the text and the context it renders. `Err(minimum)` is the size
/// of the smallest context there is, when that is still larger than `max_bytes`.
pub fn fit(draft: Draft, max_bytes: usize) -> Result<(Context, String), usize> {
    let Draft {
        mut context,
        mut neighbour,
    } = draft;
    let mut dropped = Truncated::default();
    let mut text = render(&context);
    while text.len() > max_bytes {
        if let Some(example) = context.examples.pop() {
            dropped.examples.push(example.title);
        } else if let Some(index) = neighbour.iter().rposition(|is_neighbour| *is_neighbour) {
            neighbour.remove(index);
            let symbol = context.symbols.remove(index);
            dropped.neighbours.push(symbol.name);
        } else if let Some(schema) = context.schemas.pop() {
            dropped.schemas.push(schema.name);
        } else if let Some(symbol) = context.symbols.pop() {
            neighbour.pop();
            dropped.symbols.push(symbol.name);
        } else {
            return Err(text.len());
        }
        context.truncated = Some(dropped.clone());
        text = render(&context);
    }
    Ok((context, text))
}
