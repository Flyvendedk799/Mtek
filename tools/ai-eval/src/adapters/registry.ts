// The only place that loads an adapter, lazily and by name. A run with `--client replay` never loads
// the others, so a missing optional dependency of `anthropic` cannot break a replay run, and the core
// of the harness never imports a provider (the boundary is enforced by `check-boundary.ts`).
//
// Rules this file keeps, which the boundary check enforces:
//   - the optional adapters are reached only through `import("./NAME.ts")` expressions here;
//   - no other module of `src/` (outside `src/adapters/`) names an optional adapter file.
import type { AdapterDeps, AdapterFactory, AdapterOptions } from "../adapter-options.ts";
import type { ModelClient } from "../model-client.ts";
import { createReplayClient, loadTranscript } from "./replay.ts";

export const ADAPTER_NAMES = ["replay", "anthropic", "openai-compatible", "llama-cpp"] as const;
export type AdapterName = (typeof ADAPTER_NAMES)[number];

export function isAdapterName(name: string): name is AdapterName {
  return (ADAPTER_NAMES as readonly string[]).includes(name);
}

const replayFactory: AdapterFactory = (options) => {
  if (options.transcript === undefined || options.transcript === "") throw new Error("adapter 'replay': --transcript is required");
  return createReplayClient(loadTranscript(options.transcript), {
    ...(options.model === undefined ? {} : { model: options.model }),
    acceptGrammar: options.acceptGrammar === true,
  });
};

async function loadOptional(name: Exclude<AdapterName, "replay">): Promise<AdapterFactory> {
  try {
    switch (name) {
      case "anthropic":
        return (await import("./anthropic.ts")).createClient;
      case "openai-compatible":
        return (await import("./openai-compatible.ts")).createClient;
      case "llama-cpp":
        return (await import("./llama-cpp.ts")).createClient;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`adapter '${name}' could not be loaded: ${reason}`, { cause: error });
  }
}

/** The factory of an adapter. Only the named adapter's module is loaded. */
export async function loadAdapter(name: string): Promise<AdapterFactory> {
  if (!isAdapterName(name)) throw new Error(`unknown adapter '${name}' (known: ${ADAPTER_NAMES.join(", ")})`);
  return name === "replay" ? replayFactory : loadOptional(name);
}

export async function createClient(name: string, options: AdapterOptions, deps: AdapterDeps = {}): Promise<ModelClient> {
  return (await loadAdapter(name))(options, deps);
}
