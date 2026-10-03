//! The syntax stage: the lexer (tokens, literals, comments and lexical
//! diagnostics, `spec/grammar.ebnf` section 1) and the AST of the whole v0.1
//! language. The parser arrives in the commits that follow.

pub mod ast;
mod dump;
mod lexer;
#[cfg(test)]
mod lexer_tests;
mod token;
mod walk;

pub use dump::{dump_expr, dump_module};
pub use lexer::{FloatFix, Lexed, MAX_LEXICAL_DIAGNOSTICS, lex, lex_str};
pub use token::{
    KEYWORDS, PUNCTUATION, RESERVED_WORDS, Token, TokenKind, TokenValue, Trivia, TriviaItem,
    TriviaKind, is_reserved_word, keyword_kind,
};
pub use walk::{NodeInfo, walk_expr, walk_module};
