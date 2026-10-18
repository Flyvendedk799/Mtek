// What every adapter factory receives. Shared by the registry and the adapters; knows no provider.
import type { FetchLike, ModelClient } from "./model-client.ts";

/** Options of a client, as given on the command line (`--client NAME --model M --base-url U ...`). */
export interface AdapterOptions {
  /** The model id exactly as the provider is to receive it. Required by every adapter but `replay`. */
  model?: string | undefined;
  /** Base URL of a server (`openai-compatible`, `llama-cpp`) or an API override (`anthropic`). */
  baseUrl?: string | undefined;
  /** The name of the environment variable that holds the API key. Keys are read from the environment at run time only. */
  apiKeyEnv?: string | undefined;
  /** `replay`: the path of the transcript (JSONL). */
  transcript?: string | undefined;
  /** `replay`: whether the client forwards a grammar. */
  acceptGrammar?: boolean | undefined;
}

/** What an adapter may use besides its options. Both are injected so that tests never touch a network or the real environment. */
export interface AdapterDeps {
  fetch?: FetchLike | undefined;
  env?: Readonly<Record<string, string | undefined>> | undefined;
}

export type AdapterFactory = (options: AdapterOptions, deps: AdapterDeps) => ModelClient;

export function requireOption(value: string | undefined, name: string, adapter: string): string {
  if (value === undefined || value === "") throw new Error(`adapter '${adapter}': ${name} is required`);
  return value;
}
