// Loads the fixture dump produced by the `layout_fixtures` example (`tests/codegen/.out/`):
// the layout record and the generated writer module of every layout fixture.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CpuValue } from "./cpu-value.js";
import { type LayoutRecord, parseLayoutRecord } from "./layout.js";

const here = dirname(fileURLToPath(import.meta.url));

/** `tests/codegen`. */
export const codegenDir = resolve(here, "..");
/** The directory the Vitest global setup dumps the fixtures into. */
export const outDir = resolve(codegenDir, ".out");
/** The hand-maintained layout goldens and fixture types. */
export const gpuLayoutDir = resolve(codegenDir, "..", "gpu-layout");
/** The golden writer files compared by the Rust tests. */
export const goldenWritersDir = resolve(codegenDir, "writers");

/** The typed-array views a writer receives: all three over one `ArrayBuffer`. */
export interface Views {
  readonly f32: Float32Array;
  readonly u32: Uint32Array;
  readonly i32: Int32Array;
}

export type Writer = (m: Views, base: number, v: CpuValue) => void;

/** One entry of the generated `writers` table. */
export interface WriterEntry {
  readonly all: Writer;
  readonly fields: Readonly<Record<string, Writer>>;
}

export function makeViews(buffer: ArrayBuffer): Views {
  return {
    f32: new Float32Array(buffer),
    u32: new Uint32Array(buffer),
    i32: new Int32Array(buffer),
  };
}

export interface Fixture {
  readonly name: string;
  /** The record the example dumped (computed by the layout engine). */
  readonly record: LayoutRecord;
  /** The hand-maintained golden record from `tests/gpu-layout/`. */
  readonly golden: LayoutRecord;
  /** Everything the generated module exports, by name. */
  readonly exports: Readonly<Record<string, unknown>>;
  /** The generated `writers` table. */
  readonly table: Readonly<Record<string, WriterEntry>>;
  /** The text of the generated module. */
  readonly source: string;
}

function isWriter(value: unknown): value is Writer {
  return typeof value === "function";
}

function isRecordOfWriters(value: unknown): value is Record<string, Writer> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => isWriter(entry))
  );
}

function toTable(value: unknown, name: string): Record<string, WriterEntry> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`fixture ${name}: the module exports no \`writers\` table`);
  }
  const table: Record<string, WriterEntry> = {};
  for (const [id, entry] of Object.entries(value)) {
    const candidate = entry as { all?: unknown; fields?: unknown };
    if (!isWriter(candidate.all) || !isRecordOfWriters(candidate.fields)) {
      throw new Error(`fixture ${name}: malformed writers table entry \`${id}\``);
    }
    table[id] = { all: candidate.all, fields: candidate.fields };
  }
  return table;
}

/** Names of the dumped fixtures (`<name>.layout.json` in the output directory), sorted. */
export function dumpedFixtureNames(): string[] {
  return readdirSync(outDir)
    .filter((file) => file.endsWith(".layout.json"))
    .map((file) => file.slice(0, -".layout.json".length))
    .sort();
}

/** Loads one fixture: its record, the golden record and the generated module. */
export async function loadFixture(name: string): Promise<Fixture> {
  const record = parseLayoutRecord(readFileSync(resolve(outDir, `${name}.layout.json`), "utf8"));
  const golden = parseLayoutRecord(
    readFileSync(resolve(gpuLayoutDir, `${name}.layout.json`), "utf8"),
  );
  const file = resolve(outDir, `${name}.writers.js`);
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<
    string,
    unknown
  >;
  return {
    name,
    record,
    golden,
    exports: loaded,
    table: toTable(loaded["writers"], name),
    source: readFileSync(file, "utf8"),
  };
}
