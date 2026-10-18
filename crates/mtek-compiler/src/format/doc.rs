//! The document model of the printer and its layout algorithm.
//!
//! A [`Doc`] describes text together with the places where a line may break.
//! [`render`] lays it out in a maximum width: a [`Doc::Group`] is printed flat
//! (its [`Doc::Line`] as a space, its [`Doc::SoftLine`] as nothing) when all of
//! it, up to the next possible line break after it, fits in the remaining
//! width, and broken (every line of the group a newline) otherwise. A
//! [`Doc::HardLine`], a [`Doc::EnsureLine`] or a multi-line [`Doc::Verbatim`]
//! inside a group forces it to break. The algorithm is the one of Wadler's
//! "A prettier printer" with the "rest of the line" lookahead of Prettier.
//!
//! The layout depends on the document only, never on how the source was laid
//! out; that is what makes the formatter idempotent.
//!
//! Three details keep comments from being damaged: a [`Doc::Line`] or
//! [`Doc::SoftLine`] that breaks is not printed on a line that is still empty
//! (a comment that ended its line already broke it), a [`Doc::Space`] never
//! starts a line or doubles a space, and [`Doc::EnsureLine`] starts a line
//! unless the current one is empty.

/// Spaces per indentation level (`spec/tooling.md` section 5).
pub(super) const INDENT: usize = 4;

/// A piece of the output.
#[derive(Clone, Debug)]
pub(super) enum Doc {
    /// Nothing.
    Nil,
    /// Text without a line break.
    Text(String),
    /// A space that separates two things: not printed at the start of a line
    /// or after a space.
    Space,
    /// Text that contains line breaks (a multi-line block comment), printed as
    /// it is. It forces the groups around it to break.
    Verbatim(String),
    /// The documents one after the other.
    Concat(Vec<Doc>),
    /// The document with one more level of indentation after each of its line
    /// breaks.
    Indent(Box<Doc>),
    /// The document indented one more level if the line it starts on has
    /// something on it already, else as it is (what follows a comment that
    /// ended a line hangs from the line it continues, but not from a line it
    /// starts).
    Hang(Box<Doc>),
    /// The document as one unit that is printed on one line if it fits; the
    /// flag says that the document forces a break (computed once by
    /// [`Doc::group`], so that nested groups are not scanned again and again).
    Group(Box<Doc>, bool),
    /// A space in a flat group, a line break in a broken one.
    Line,
    /// Nothing in a flat group, a line break in a broken one.
    SoftLine,
    /// A line break, always. Forces the enclosing groups to break.
    HardLine,
    /// A line break unless the current line is empty. Forces the enclosing
    /// groups to break.
    EnsureLine,
    /// `broken` if the enclosing group is printed broken, `flat` otherwise.
    IfBreak { broken: Box<Doc>, flat: Box<Doc> },
}

impl Doc {
    pub(super) fn text(text: impl Into<String>) -> Doc {
        Doc::Text(text.into())
    }

    pub(super) fn concat(parts: Vec<Doc>) -> Doc {
        Doc::Concat(parts)
    }

    pub(super) fn indent(doc: Doc) -> Doc {
        Doc::Indent(Box::new(doc))
    }

    pub(super) fn hang(doc: Doc) -> Doc {
        Doc::Hang(Box::new(doc))
    }

    pub(super) fn group(doc: Doc) -> Doc {
        let forced = doc.forces_break();
        Doc::Group(Box::new(doc), forced)
    }

    /// `doc` if the group is broken, nothing otherwise.
    pub(super) fn if_break(broken: Doc) -> Doc {
        Doc::IfBreak {
            broken: Box::new(broken),
            flat: Box::new(Doc::Nil),
        }
    }

    /// True if printing the document in a group forces that group to break.
    fn forces_break(&self) -> bool {
        match self {
            Doc::Nil | Doc::Text(_) | Doc::Space | Doc::Line | Doc::SoftLine => false,
            Doc::Verbatim(_) | Doc::HardLine | Doc::EnsureLine => true,
            Doc::Concat(parts) => parts.iter().any(Doc::forces_break),
            Doc::Indent(doc) | Doc::Hang(doc) => doc.forces_break(),
            Doc::Group(_, forced) => *forced,
            Doc::IfBreak { broken, flat } => broken.forces_break() || flat.forces_break(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Flat,
    Break,
}

/// The width of `text` in columns: one per character.
fn width_of(text: &str) -> usize {
    text.chars().count()
}

/// The width of the first line of `text`, and whether it has more lines.
fn first_line(text: &str) -> (usize, bool) {
    match text.split_once('\n') {
        Some((first, _)) => (width_of(first), true),
        None => (width_of(text), false),
    }
}

type Command<'a> = (usize, Mode, &'a Doc);

/// Whether `next` (printed flat) and the rest of the line after it fit in
/// `remaining` columns. `rest` are the commands that follow `next`, the last
/// one first.
fn fits(next: Command<'_>, rest: &[Command<'_>], mut remaining: isize) -> bool {
    let mut stack = vec![next];
    let mut rest_index = rest.len();
    loop {
        if remaining < 0 {
            return false;
        }
        let (indent, mode, doc) = match stack.pop() {
            Some(command) => command,
            None => {
                if rest_index == 0 {
                    return true;
                }
                rest_index -= 1;
                match rest.get(rest_index) {
                    Some(command) => *command,
                    None => return true,
                }
            }
        };
        match doc {
            Doc::Nil => {}
            Doc::Text(text) => remaining -= width_of(text) as isize,
            Doc::Space => remaining -= 1,
            Doc::Verbatim(text) => {
                let (first, multi_line) = first_line(text);
                remaining -= first as isize;
                if multi_line {
                    return remaining >= 0;
                }
            }
            Doc::Concat(parts) => {
                for part in parts.iter().rev() {
                    stack.push((indent, mode, part));
                }
            }
            Doc::Indent(doc) | Doc::Hang(doc) => stack.push((indent + INDENT, mode, doc)),
            Doc::Group(doc, forced) => {
                let mode = if *forced { Mode::Break } else { mode };
                stack.push((indent, mode, doc));
            }
            Doc::Line => match mode {
                Mode::Flat => remaining -= 1,
                Mode::Break => return true,
            },
            Doc::SoftLine => {
                if mode == Mode::Break {
                    return true;
                }
            }
            Doc::HardLine | Doc::EnsureLine => return true,
            Doc::IfBreak { broken, flat } => {
                let chosen: &Doc = match mode {
                    Mode::Break => broken,
                    Mode::Flat => flat,
                };
                stack.push((indent, mode, chosen));
            }
        }
    }
}

struct Output {
    text: String,
    column: usize,
    /// Something was printed on the current line (indentation does not count).
    line_has_content: bool,
}

impl Output {
    fn push_text(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        self.text.push_str(text);
        self.column += width_of(text);
        self.line_has_content = true;
    }

    fn push_space(&mut self) {
        if self.line_has_content && !self.text.ends_with(' ') {
            self.push_text(" ");
        }
    }

    fn push_verbatim(&mut self, text: &str) {
        self.text.push_str(text);
        self.column = match text.rsplit_once('\n') {
            Some((_, last)) => width_of(last),
            None => self.column + width_of(text),
        };
        self.line_has_content = true;
    }

    /// End the line: drop its trailing spaces, break it, indent the next.
    fn newline(&mut self, indent: usize) {
        let kept = self.text.trim_end_matches(' ').len();
        self.text.truncate(kept);
        self.text.push('\n');
        self.text.extend(std::iter::repeat_n(' ', indent));
        self.column = indent;
        self.line_has_content = false;
    }

    /// A line break that is not wanted on an empty line, which is only indented
    /// as the break asks.
    fn newline_unless_empty(&mut self, indent: usize) {
        if self.line_has_content {
            self.newline(indent);
        } else {
            let kept = self.text.trim_end_matches(' ').len();
            self.text.truncate(kept);
            self.text.extend(std::iter::repeat_n(' ', indent));
            self.column = indent;
        }
    }
}

/// Lay `doc` out in `width` columns. The result has no trailing newline and
/// no trailing spaces on any line it breaks itself.
pub(super) fn render(doc: &Doc, width: usize) -> String {
    let mut out = Output {
        text: String::new(),
        column: 0,
        line_has_content: false,
    };
    let mut commands: Vec<Command<'_>> = vec![(0, Mode::Break, doc)];
    while let Some((indent, mode, doc)) = commands.pop() {
        match doc {
            Doc::Nil => {}
            Doc::Text(text) => out.push_text(text),
            Doc::Space => out.push_space(),
            Doc::Verbatim(text) => out.push_verbatim(text),
            Doc::Concat(parts) => {
                for part in parts.iter().rev() {
                    commands.push((indent, mode, part));
                }
            }
            Doc::Indent(doc) => commands.push((indent + INDENT, mode, doc)),
            Doc::Hang(doc) => {
                let indent = if out.line_has_content {
                    indent + INDENT
                } else {
                    indent
                };
                commands.push((indent, mode, doc));
            }
            Doc::Group(inner, forced) => {
                let flat = !*forced
                    && match mode {
                        Mode::Flat => true,
                        Mode::Break => {
                            let remaining = width as isize - out.column as isize;
                            fits((indent, Mode::Flat, inner), &commands, remaining)
                        }
                    };
                let mode = if flat { Mode::Flat } else { Mode::Break };
                commands.push((indent, mode, inner));
            }
            Doc::Line => match mode {
                Mode::Flat => out.push_text(" "),
                Mode::Break => out.newline_unless_empty(indent),
            },
            Doc::SoftLine => {
                if mode == Mode::Break {
                    out.newline_unless_empty(indent);
                }
            }
            Doc::HardLine => out.newline(indent),
            Doc::EnsureLine => out.newline_unless_empty(indent),
            Doc::IfBreak { broken, flat } => {
                let chosen: &Doc = match mode {
                    Mode::Break => broken,
                    Mode::Flat => flat,
                };
                commands.push((indent, mode, chosen));
            }
        }
    }
    let kept = out.text.trim_end_matches(' ').len();
    out.text.truncate(kept);
    out.text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(name: &str, args: &[&str]) -> Doc {
        let mut parts = vec![Doc::text(name), Doc::text("(")];
        let mut inner = vec![Doc::SoftLine];
        for (index, arg) in args.iter().enumerate() {
            if index > 0 {
                inner.push(Doc::text(","));
                inner.push(Doc::Line);
            }
            inner.push(Doc::text(*arg));
        }
        parts.push(Doc::indent(Doc::concat(inner)));
        parts.push(Doc::if_break(Doc::text(",")));
        parts.push(Doc::SoftLine);
        parts.push(Doc::text(")"));
        Doc::group(Doc::concat(parts))
    }

    #[test]
    fn a_group_that_fits_stays_on_one_line() {
        let doc = Doc::concat(vec![call("f", &["a", "b"]), Doc::text(";")]);
        assert_eq!(render(&doc, 20), "f(a, b);");
    }

    #[test]
    fn a_group_that_does_not_fit_breaks_every_line() {
        let doc = Doc::concat(vec![call("f", &["aaaa", "bbbb"]), Doc::text(";")]);
        assert_eq!(render(&doc, 8), "f(\n    aaaa,\n    bbbb,\n);");
    }

    #[test]
    fn the_rest_of_the_line_counts() {
        // `f(a, b)` is 7 wide; the `;` after the group makes it 8.
        let doc = Doc::concat(vec![call("f", &["a", "b"]), Doc::text(";")]);
        assert_eq!(render(&doc, 8), "f(a, b);");
        assert_eq!(render(&doc, 7), "f(\n    a,\n    b,\n);");
    }

    #[test]
    fn a_hard_line_breaks_the_groups_around_it() {
        let doc = Doc::group(Doc::concat(vec![
            Doc::text("a"),
            Doc::Line,
            Doc::text("b"),
            Doc::HardLine,
            Doc::text("c"),
        ]));
        assert_eq!(render(&doc, 80), "a\nb\nc");
    }

    #[test]
    fn a_broken_line_is_not_printed_on_an_empty_line() {
        let doc = Doc::group(Doc::concat(vec![
            Doc::text("a // c"),
            Doc::HardLine,
            Doc::Line,
            Doc::text("b"),
        ]));
        assert_eq!(render(&doc, 80), "a // c\nb");
    }

    #[test]
    fn a_space_never_starts_a_line_or_doubles() {
        let doc = Doc::concat(vec![
            Doc::Space,
            Doc::text("a "),
            Doc::Space,
            Doc::text("b"),
            Doc::HardLine,
            Doc::Space,
            Doc::text("c"),
        ]);
        assert_eq!(render(&doc, 80), "a b\nc");
    }

    #[test]
    fn ensure_line_starts_a_line_unless_one_is_just_started() {
        let doc = Doc::concat(vec![
            Doc::text("a"),
            Doc::EnsureLine,
            Doc::text("b"),
            Doc::HardLine,
            Doc::EnsureLine,
            Doc::text("c"),
        ]);
        assert_eq!(render(&doc, 80), "a\nb\nc");
    }

    #[test]
    fn a_hang_indents_only_a_line_that_has_something_on_it() {
        let hang = |text: &str| Doc::hang(Doc::concat(vec![Doc::text("// c"), Doc::HardLine, Doc::text(text)]));
        let doc = Doc::concat(vec![
            Doc::text("x ="),
            Doc::Space,
            hang("1;"),
            Doc::indent(Doc::concat(vec![Doc::HardLine, hang("2;")])),
        ]);
        assert_eq!(render(&doc, 80), "x = // c\n    1;\n    // c\n    2;");
    }

    #[test]
    fn trailing_spaces_are_dropped_at_line_breaks() {
        let doc = Doc::concat(vec![Doc::text("a "), Doc::HardLine, Doc::text("b")]);
        assert_eq!(render(&doc, 80), "a\nb");
    }

    #[test]
    fn indentation_follows_the_nesting() {
        let doc = Doc::concat(vec![
            Doc::text("{"),
            Doc::indent(Doc::concat(vec![
                Doc::HardLine,
                Doc::text("x;"),
                Doc::indent(Doc::concat(vec![Doc::HardLine, Doc::text("y;")])),
            ])),
            Doc::HardLine,
            Doc::text("}"),
        ]);
        assert_eq!(render(&doc, 80), "{\n    x;\n        y;\n}");
    }

    #[test]
    fn verbatim_text_is_kept_and_breaks_its_group() {
        let doc = Doc::group(Doc::concat(vec![
            Doc::text("a"),
            Doc::Line,
            Doc::Verbatim("/* x\n   y */".to_owned()),
        ]));
        assert_eq!(render(&doc, 80), "a\n/* x\n   y */");
    }
}
