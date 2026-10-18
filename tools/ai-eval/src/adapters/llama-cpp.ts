// The `llama-cpp` adapter: a local `llama-server` (llama.cpp) through its OpenAI-style endpoint
// `POST {baseUrl}/chat/completions`, default base URL `http://127.0.0.1:8080/v1`. Optional and
// isolated: nothing but `registry.ts` imports this file.
//
// It forwards `request.grammar` (GBNF) as the `grammar` member of the body, which is llama.cpp's
// extension. Forwarding is all it claims: whether a server honours the grammar is the business of the
// `GrammarCapability` (`grammar.ts`), and the harness runs no constrained trial unless that check
// says available. This adapter was tested against a fake transport only, never against a server.
import { requireOption, type AdapterDeps, type AdapterOptions } from "../adapter-options.ts";
import { createChatCompletionsClient } from "../chat-completions.ts";
import type { ModelClient } from "../model-client.ts";

export const NAME = "llama-cpp";
export const DEFAULT_BASE_URL = "http://127.0.0.1:8080/v1";

export function createClient(options: AdapterOptions, deps: AdapterDeps): ModelClient {
  const env = deps.env ?? process.env;
  return createChatCompletionsClient({
    provider: NAME,
    // The server serves one model whatever the field says; the id is recorded, so the operator names it.
    model: requireOption(options.model, "--model", NAME),
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    apiKey: env[options.apiKeyEnv ?? "LLAMA_API_KEY"],
    fetch: deps.fetch ?? globalThis.fetch,
    capabilities: { grammar: true, seed: true },
    sendGrammar: true,
  });
}
