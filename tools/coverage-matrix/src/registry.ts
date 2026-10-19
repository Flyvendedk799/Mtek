// The authoritative list of v0.1 features: what the compiler build itself says it supports
// (`mtek context`, `supported.features` and `supported.notSupported`; `spec/ai-and-benchmarks.md`
// section 2, decision 0072). That list is derived by the compiler from the resolver's construct table
// and the standard-library registry (`spec/stdlib-schema.json`), with nothing typed in by hand, so a new
// registry row appears in the matrix without anyone editing this tool.
import { join } from "node:path";
import { arr, parseJson } from "./json.ts";
import { run, type Runner } from "./tools.ts";

export interface SupportedFeatures {
  features: string[];
  notSupported: string[];
  languageVersion: string;
}

/** The example the context is asked for; the `supported` section does not depend on the project. */
const CONTEXT_PROJECT = "examples/pulse-cube";

export async function readSupported(root: string, mtek: string, runner: Runner = run): Promise<SupportedFeatures> {
  const entry = join(root, CONTEXT_PROJECT, "src", "main.mtek");
  // A budget far above the size of the export, so that nothing is left out to fit it.
  const result = await runner(mtek, ["context", "--entry", entry, "--max-bytes", "100000000"], { cwd: root });
  if (result.code !== 0) throw new Error(`mtek context failed: ${result.stderr.trim()}`);
  const context = parseJson(result.stdout, "the output of mtek context");
  const supported = typeof context === "object" && context !== null && !Array.isArray(context) ? context["supported"] : undefined;
  const features = arr(supported, "features").filter((f): f is string => typeof f === "string");
  const notSupported = arr(supported, "notSupported").filter((f): f is string => typeof f === "string");
  if (features.length === 0) throw new Error("mtek context lists no supported feature");
  const language = typeof context === "object" && context !== null && !Array.isArray(context) ? context["languageVersion"] : undefined;
  return { features, notSupported, languageVersion: typeof language === "string" ? language : "?" };
}
