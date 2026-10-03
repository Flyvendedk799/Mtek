/**
 * Startup shader loading (`spec/runtime-abi.md` sections 5.4 and 6.1): fetch each shader's WGSL file and
 * span map, create the module inside a validation error scope, await `getCompilationInfo()` and turn
 * every compilation error into an `E8051` diagnostic mapped to Mtek source through the span map.
 * Pipelines are created from these modules by M1-18; M1-14 stops at the shader modules.
 */
import type { MtekManifest, MtekShader } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import type { ResourceRegistry } from "../gpu/registry.js";
import type { FetchResponseLike } from "./environment.js";
import { resolveSpan, spanOfSymbol } from "./failures.js";

/** One entry of a WGSL span map. Lines and columns are 1-based; `colEnd` is exclusive. */
export interface SpanMapEntry {
  readonly wgsl: { readonly line: number; readonly colStart: number; readonly colEnd: number };
  readonly span: number;
  readonly symbol?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Parses and checks a `shaders/<h16>.mtek-map.json` document. Returns the entries, or a reason string
 * when the text is not a valid span map for the shader with hash `shaderHash`.
 */
export function parseSpanMap(text: string, shaderHash: string): { entries: readonly SpanMapEntry[] } | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return `not valid JSON (${error instanceof Error ? error.message : String(error)})`;
  }
  if (!isRecord(value) || !Array.isArray(value["entries"])) return "missing the `entries` array";
  if (value["shader"] !== shaderHash) return "its `shader` hash does not match the manifest";
  const entries: SpanMapEntry[] = [];
  for (const raw of value["entries"] as unknown[]) {
    if (!isRecord(raw)) return "an entry is not an object";
    const wgsl = raw["wgsl"];
    if (!isRecord(wgsl) || !isFiniteInteger(wgsl["line"]) || !isFiniteInteger(wgsl["colStart"]) || !isFiniteInteger(wgsl["colEnd"])) {
      return "an entry has no valid `wgsl` location";
    }
    if (!isFiniteInteger(raw["span"])) return "an entry has no valid `span`";
    const entry: SpanMapEntry = {
      wgsl: { line: wgsl["line"], colStart: wgsl["colStart"], colEnd: wgsl["colEnd"] },
      span: raw["span"],
      ...(typeof raw["symbol"] === "string" ? { symbol: raw["symbol"] } : {}),
    };
    entries.push(entry);
  }
  return { entries };
}

/**
 * The span-map entry that covers a WGSL location: same line, `colStart <= column < colEnd`; the narrowest
 * such entry wins (the most specific expression), the first in file order on a tie.
 */
export function findSpanMapEntry(entries: readonly SpanMapEntry[], line: number, column: number): SpanMapEntry | undefined {
  let best: SpanMapEntry | undefined;
  for (const entry of entries) {
    if (entry.wgsl.line !== line || column < entry.wgsl.colStart || column >= entry.wgsl.colEnd) continue;
    if (best === undefined || entry.wgsl.colEnd - entry.wgsl.colStart < best.wgsl.colEnd - best.wgsl.colStart) best = entry;
  }
  return best;
}

export interface ShaderLoadOptions {
  readonly manifest: MtekManifest;
  readonly baseUrl: URL;
  readonly device: Pick<GPUDevice, "pushErrorScope" | "popErrorScope">;
  readonly registry: ResourceRegistry;
  readonly fetch: (url: string) => Promise<FetchResponseLike>;
}

export interface ShaderLoadResult {
  /** Created modules by shader hash (including modules that failed validation; the registry owns them). */
  readonly modules: ReadonlyMap<string, GPUShaderModule>;
  /** One `E8051` per failure, in manifest order; empty on success. */
  readonly diagnostics: readonly MtekDiagnostic[];
}

type TextResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

async function fetchText(options: ShaderLoadOptions, relative: string): Promise<TextResult> {
  const url = new URL(relative, options.baseUrl).href;
  try {
    const response = await options.fetch(url);
    if (!response.ok) return { ok: false, reason: `HTTP ${String(response.status)} for ${url}` };
    return { ok: true, text: await response.text() };
  } catch (error) {
    return { ok: false, reason: `${url}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function describeFailure(manifest: MtekManifest, shader: MtekShader, message: string, notes: string[]): MtekDiagnostic {
  const spanId = spanOfSymbol(manifest, shader.material);
  return makeRuntimeDiagnostic("E8051", {
    phase: "runtime:mount",
    message: `Shader for material '${shader.material}' failed: ${message}`,
    source: spanId === undefined ? null : resolveSpan(manifest, spanId),
    notes,
  });
}

/** Loads every startup shader. Never throws for shader problems; they come back as diagnostics. */
export async function loadStartupShaders(options: ShaderLoadOptions): Promise<ShaderLoadResult> {
  const { manifest, device, registry } = options;
  const modules = new Map<string, GPUShaderModule>();
  const diagnostics: MtekDiagnostic[] = [];

  // Fetch everything concurrently, process in manifest order so diagnostics are deterministic.
  const fetched = await Promise.all(
    manifest.shaders.map(async (shader) => ({
      wgsl: await fetchText(options, shader.url),
      map: await fetchText(options, shader.map),
    })),
  );

  for (const [index, shader] of manifest.shaders.entries()) {
    const files = fetched[index];
    if (files === undefined) continue;
    if (!files.wgsl.ok) {
      diagnostics.push(describeFailure(manifest, shader, `the WGSL file could not be loaded (${files.wgsl.reason}).`, []));
      continue;
    }

    let mapEntries: readonly SpanMapEntry[] | undefined;
    let mapProblem: string | undefined;
    if (files.map.ok) {
      const parsed = parseSpanMap(files.map.text, shader.hash);
      if (typeof parsed === "string") mapProblem = `the span map ${shader.map} is unusable: ${parsed}`;
      else mapEntries = parsed.entries;
    } else {
      mapProblem = `the span map could not be loaded (${files.map.reason})`;
    }

    device.pushErrorScope("validation");
    let module: GPUShaderModule | undefined;
    let compileErrors: readonly GPUCompilationMessage[] = [];
    let thrown: string | undefined;
    try {
      module = registry.createShaderModule({ label: `mtek shader ${shader.hash.slice(0, 16)}`, code: files.wgsl.text });
      const info = await module.getCompilationInfo();
      compileErrors = info.messages.filter((message) => message.type === "error");
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    let scopeError: string | undefined;
    try {
      const error = await device.popErrorScope();
      if (error !== null) scopeError = error.message;
    } catch {
      // popErrorScope rejects when the device is lost; the loss is reported through device.lost.
    }
    if (module !== undefined) modules.set(shader.hash, module);

    for (const message of compileErrors) {
      const notes: string[] = [];
      let spanId = spanOfSymbol(manifest, shader.material);
      if (message.lineNum > 0) {
        notes.push(`WGSL location: ${shader.url}:${String(message.lineNum)}:${String(message.linePos)}`);
        if (mapEntries !== undefined) {
          const entry = findSpanMapEntry(mapEntries, message.lineNum, message.linePos);
          if (entry === undefined) {
            notes.push("no Mtek source span maps to this WGSL location; showing the material declaration");
          } else {
            spanId = entry.span;
            if (entry.symbol !== undefined) notes.push(`generated from ${entry.symbol}`);
          }
        }
      }
      if (mapProblem !== undefined) notes.push(`${mapProblem}; showing the material declaration`);
      diagnostics.push(
        makeRuntimeDiagnostic("E8051", {
          phase: "runtime:mount",
          message: `Shader for material '${shader.material}' failed to compile: ${message.message}`,
          source: spanId === undefined ? null : resolveSpan(manifest, spanId),
          notes,
        }),
      );
    }
    if (compileErrors.length === 0 && (thrown !== undefined || scopeError !== undefined)) {
      diagnostics.push(describeFailure(manifest, shader, thrown ?? scopeError ?? "validation error", []));
    }
  }

  return { modules, diagnostics };
}
