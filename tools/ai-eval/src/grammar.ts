// The boundary with constrained decoding (spec/ai-and-benchmarks.md section 3).
//
// Task M6-06 builds the grammar adapter and with it the real capability check. This workspace does
// not depend on that code: it defines only the interface the loop needs, and an honest default that
// says "unavailable". The loop records constrained and unconstrained trials as separate trial kinds
// (the M6 exit gate requires that) and never runs a trial unconstrained when a constrained one was
// asked for: with the default, a constrained trial ends at once with the outcome `unavailable`.
import type { ModelClient } from "./model-client.ts";

/** The exact message of spec section 3. */
export const GRAMMAR_UNAVAILABLE_MESSAGE = "grammar-constrained mode unavailable";

/** The trial kinds, reported separately (spec 3 and 6.4). */
export type TrialKind = "unconstrained" | "constrained";

/**
 * The answer of a capability check. When available, the check supplies everything a constrained trial
 * needs, so the loop depends on no grammar code of its own:
 * - `grammar`: the GBNF text sent with every request;
 * - `backend`: a label for the record (backend, model and version of the one supported combination);
 * - `replyFormat`: what a conforming reply is: edit blocks (the usual format) or a whole module (the
 *   entry file's new content, for a grammar that describes a module).
 */
export type GrammarCheck =
  | { available: true; grammar: string; backend: string; replyFormat: "edit-blocks" | "module" }
  | { available: false; reason: string };

export interface GrammarCapability {
  check(client: ModelClient): Promise<GrammarCheck>;
}

/** What this build has: nothing. The orchestrator replaces it with M6-06's check once both are merged. */
export const defaultGrammarCapability: GrammarCapability = {
  check: () =>
    Promise.resolve({
      available: false,
      reason: "no grammar adapter is installed in this build of the harness (the adapter is task M6-06)",
    }),
};
