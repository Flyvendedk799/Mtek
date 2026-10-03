//! The syntax stage: the lexer (tokens, literals, comments and lexical
//! diagnostics) of `spec/grammar.ebnf` section 1. The parser and the AST
//! arrive with the following work items.

mod lexer;
#[cfg(test)]
mod lexer_tests;
mod token;

pub use lexer::{FloatFix, Lexed, MAX_LEXICAL_DIAGNOSTICS, lex, lex_str};
pub use token::{
    KEYWORDS, PUNCTUATION, RESERVED_WORDS, Token, TokenKind, TokenValue, Trivia, TriviaItem,
    TriviaKind, is_reserved_word, keyword_kind,
};
