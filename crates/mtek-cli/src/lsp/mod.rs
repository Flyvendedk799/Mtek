//! `mtek lsp`: the language server (`spec/tooling.md` section 7, decision 0076).

mod analysis;
mod clock;
mod completion;
mod definition;
mod hover;
mod overlay;
mod position;
mod prelude_doc;
mod semantic;
mod transport;
mod uri;

#[cfg(test)]
mod completion_tests;
#[cfg(test)]
mod feature_tests;
#[cfg(test)]
mod testkit;
