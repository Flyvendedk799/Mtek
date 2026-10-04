// The codegen fixtures as the Vitest global setup builds them with the **real** runtime bundle
// (`.out/programs/<name>/`, by the compiler's `codegen_programs` example; spec/testing.md
// section 4.1, decision 0040): their `dist/` tree, typed IR and imported program module.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { codegenDir, outDir } from "./fixtures.js";

/** Where the global setup builds the codegen fixtures. */
export const programsDir = resolve(outDir, "programs");

/** The codegen fixtures: directories under tests/codegen with an mtek.toml, sorted. */
export function codegenFixtures(): string[] {
  return readdirSync(codegenDir)
    .filter((name) => existsSync(resolve(codegenDir, name, "mtek.toml")))
    .sort();
}

/** The parts of the manifest the tests read. */
export interface Manifest {
  readonly entryScene: string;
  readonly sources: readonly { readonly id: number; readonly path: string }[];
  readonly spans: readonly { readonly file: number; readonly start: number; readonly end: number }[];
  readonly symbols: readonly { readonly id: string; readonly kind: string; readonly span: number }[];
  readonly layouts: readonly {
    readonly id: string;
    readonly wgslStruct: string;
    readonly root: { readonly members: readonly { readonly name: string }[] };
  }[];
  readonly materials: readonly { readonly id: string; readonly layout: string | null }[];
  readonly scene: {
    readonly entities: readonly {
      readonly index: number;
      readonly material: { readonly id: string; readonly instance: number } | null;
    }[];
  };
}

/** A program module of a fixture, built with the real runtime bundle. */
export interface BuiltProgram {
  readonly name: string;
  /** `.out/programs/<name>`. */
  readonly dir: string;
  readonly appUrl: string;
  readonly appText: string;
  /** The runtime bundle's hashed file name. */
  readonly runtimeFile: string;
  readonly module: Readonly<Record<string, unknown>>;
  readonly manifest: Manifest;
  /** The typed IR (`mtek inspect --ir --format json`). */
  readonly ir: unknown;
}

const RUNTIME_LINE = /^import \* as rt from "\.\/(runtime\.[0-9a-f]{16}\.js)";$/m;

export function record(value: unknown, where: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

const loaded = new Map<string, Promise<BuiltProgram>>();

async function importProgram(name: string): Promise<BuiltProgram> {
  const dir = resolve(programsDir, name);
  const appFile = resolve(dir, "app.js");
  const appText = readFileSync(appFile, "utf8");
  const runtimeFile = RUNTIME_LINE.exec(appText)?.[1];
  if (runtimeFile === undefined) throw new Error(`${name}: app.js has no runtime import line`);
  const appUrl = pathToFileURL(appFile).href;
  const module = record(await import(/* @vite-ignore */ appUrl), name);
  const manifest = JSON.parse(readFileSync(resolve(dir, "program.manifest.json"), "utf8")) as Manifest;
  const ir: unknown = JSON.parse(readFileSync(resolve(dir, "ir.json"), "utf8"));
  return { name, dir, appUrl, appText, runtimeFile, module, manifest, ir };
}

/** The fixture `name` as built by the global setup (imported once per test file). */
export function loadProgram(name: string): Promise<BuiltProgram> {
  let program = loaded.get(name);
  if (program === undefined) {
    program = importProgram(name);
    loaded.set(name, program);
  }
  return program;
}

/** The source text of a manifest span (the fixture's own sources). */
export function spanText(program: BuiltProgram, spanId: number): string {
  const span = program.manifest.spans[spanId];
  if (span === undefined) throw new Error(`${program.name}: no span ${spanId}`);
  const source = program.manifest.sources.find((s) => s.id === span.file);
  if (source === undefined) throw new Error(`${program.name}: span ${spanId} has an unknown file`);
  const bytes = readFileSync(resolve(codegenDir, program.name, source.path));
  return bytes.subarray(span.start, span.end).toString("utf8");
}
