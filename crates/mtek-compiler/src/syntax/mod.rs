//! The syntax stage: the lexer (tokens, literals, comments and lexical
//! diagnostics, `spec/grammar.ebnf` section 1), the AST of the whole v0.1
//! language, and the parser: the Pratt expression parser and the recursive
//! descent parser of types, items, members and statements with error recovery
//! ([`parse_module`]).

pub mod ast;
mod dump;
mod lexer;
#[cfg(test)]
mod lexer_tests;
mod parser;
mod token;
mod walk;

pub use dump::{dump_expr, dump_module};
pub use lexer::{FloatFix, Lexed, MAX_LEXICAL_DIAGNOSTICS, lex, lex_str};
pub use parser::{
    CandidateEdit, MAX_NESTING_DEPTH, ParsedExpr, ParsedModule, parse_expression,
    parse_expression_no_desc, parse_module,
};
pub use token::{
    KEYWORDS, PUNCTUATION, RESERVED_WORDS, Token, TokenKind, TokenValue, Trivia, TriviaItem,
    TriviaKind, is_reserved_word, keyword_kind,
};
pub use walk::{NodeInfo, walk_expr, walk_module};
