// The `openai-compatible` adapter: any server that speaks `POST {baseUrl}/chat/completions`
// (hosted or local). Optional and isolated: nothing but `registry.ts` imports this file, and it uses
// no provider library, only an injected `fetch`. The API key, when there is one, is read from the
// environment variable named by `apiKeyEnv` (default `OPENAI_API_KEY`) when the client is created.
import { requireOption, type AdapterDeps, type AdapterOptions } from "../adapter-options.ts";
import { createChatCompletionsClient } from "../chat-completions.ts";
import type { ModelClient } from "../model-client.ts";

export const NAME = "openai-compatible";

export function createClient(options: AdapterOptions, deps: AdapterDeps): ModelClient {
  const env = deps.env ?? process.env;
  return createChatCompletionsClient({
    provider: NAME,
    model: requireOption(options.model, "--model", NAME),
    baseUrl: requireOption(options.baseUrl, "--base-url", NAME),
    apiKey: env[options.apiKeyEnv ?? "OPENAI_API_KEY"],
    fetch: deps.fetch ?? globalThis.fetch,
    // Servers differ in what they honour; a seed is forwarded (best effort, said so in the README), a grammar never.
    capabilities: { grammar: false, seed: true },
    sendGrammar: false,
  });
}
