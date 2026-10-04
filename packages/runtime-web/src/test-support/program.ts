/**
 * Programs for runtime tests.
 *
 *  - `loadGoldenProgram(name)` imports a codegen golden `app.js` (`tests/codegen/<name>/expected/`,
 *    decision 0030) in Node with a stand-in for the runtime bundle, exactly as `tests/codegen/app.test.ts`
 *    does, so runtime tests execute the compiler's real output.
 *  - `layoutWriters(layout)` is a data-driven writer built from a layout record alone (a `DataView` walk,
 *    sharing nothing with generated writers), for synthetic programs of hand-made manifests.
 *  - `syntheticProgram(manifest, init)` combines both into a program module object.
 */
/// <reference types="node" />
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkManifest } from "../abi/validate.js";
import type { MtekLayoutNode, MtekLayoutRecord, MtekManifest } from "../abi/manifest-types.js";
import type { MtekWriterMemory } from "../abi/program.js";

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const CODEGEN_DIR = resolve(REPO_ROOT, "tests", "codegen");

/** The codegen fixtures with a golden `expected/` directory. */
export const CODEGEN_FIXTURES: readonly string[] = readdirSync(CODEGEN_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => {
    try {
      readFileSync(resolve(CODEGEN_DIR, name, "expected", "app.js"));
      return true;
    } catch {
      return false;
    }
  })
  .sort();

/** A program module object as `mountMtek` receives it. */
export interface TestProgram {
  readonly abi: 1;
  readonly baseUrl: URL;
  readonly manifestUrl: URL;
  readonly writers: unknown;
  readonly functions: unknown;
  readonly scenes: unknown;
  readonly prefabs: unknown;
}

export interface GoldenProgram {
  /** The default export of the golden `app.js`. */
  readonly program: TestProgram;
  readonly manifest: MtekManifest;
  /** Every file of the golden `dist/` (minus the bundle) by its URL below `program.baseUrl`. */
  readonly files: ReadonlyMap<string, string>;
}

const RUNTIME_LINE = /^export \{ mountMtek \} from "\.\/(runtime\.[0-9a-f]{16}\.js)";$/m;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** Imports `tests/codegen/<name>/expected/app.js` from a temporary copy with a stand-in runtime bundle. */
export async function loadGoldenProgram(name: string): Promise<GoldenProgram> {
  const source = resolve(CODEGEN_DIR, name, "expected");
  const target = mkdtempSync(join(tmpdir(), `mtek-runtime-${name}-`));
  cpSync(source, target, { recursive: true });
  // app.js.map names the project-relative sources (decision 0030); put them where it says.
  cpSync(resolve(CODEGEN_DIR, name, "src"), join(target, "src"), { recursive: true });
  const appFile = join(target, "app.js");
  const bundle = RUNTIME_LINE.exec(readFileSync(appFile, "utf8"))?.[1];
  if (bundle === undefined) throw new Error(`${name}: app.js has no runtime re-export line`);
  writeFileSync(join(target, bundle), 'export function mountMtek() { throw new Error("test stand-in for the runtime"); }\n');
  const module = (await import(/* @vite-ignore */ pathToFileURL(appFile).href)) as { default: TestProgram };
  const program = module.default;
  const parsed = checkManifest(JSON.parse(readFileSync(join(target, "program.manifest.json"), "utf8")));
  if (!parsed.ok) throw new Error(`${name}: the golden manifest is not accepted: ${JSON.stringify(parsed.failures)}`);
  const files = new Map<string, string>();
  for (const file of listFiles(source)) {
    const rel = relative(source, file).split("\\").join("/");
    files.set(new URL(rel, program.baseUrl).href, readFileSync(file, "utf8"));
  }
  return { program, manifest: parsed.manifest, files };
}

type Writer = (m: MtekWriterMemory, base: number, value: unknown) => void;

function fail(where: string, what: string): never {
  throw new TypeError(`test writer: ${where} is not ${what}`);
}

function component(value: unknown, key: string, where: string): number {
  const item = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
  return typeof item === "number" ? item : fail(`${where}.${key}`, "a number");
}

function writeScalar(view: DataView, address: number, scalar: string, value: unknown, where: string): void {
  if (scalar === "bool32") {
    if (typeof value !== "boolean") fail(where, "a boolean");
    view.setUint32(address, value ? 1 : 0, true);
    return;
  }
  if (typeof value !== "number") fail(where, "a number");
  if (scalar === "f32") view.setFloat32(address, value, true);
  else if (scalar === "i32") view.setInt32(address, value, true);
  else view.setUint32(address, value, true);
}

/** Writes `value` for `node`; `origin` is the block start (struct members) or the element start (arrays). */
function writeNode(view: DataView, node: MtekLayoutNode, mtekType: string, value: unknown, origin: number, where: string): void {
  const address = origin + node.offset;
  switch (node.kind) {
    case "scalar":
      writeScalar(view, address, node.scalar, value, where);
      return;
    case "vector": {
      const names = mtekType === "color" ? ["r", "g", "b", "a"] : ["x", "y", "z", "w"];
      for (let i = 0; i < node.components; i += 1) view.setFloat32(address + 4 * i, component(value, names[i] ?? "?", where), true);
      return;
    }
    case "matrix": {
      if (!(value instanceof Float32Array) || value.length !== 16) fail(where, "a Float32Array(16)");
      for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) view.setFloat32(address + column * node.columnStride + 4 * row, value[column * 4 + row] ?? 0, true);
      }
      return;
    }
    case "struct":
      for (const member of node.members) {
        const field = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[member.name] : undefined;
        writeNode(view, member.node, member.mtekType, field, origin, `${where}.${member.name}`);
      }
      return;
    case "array": {
      if (!Array.isArray(value) || value.length !== node.length) fail(where, `an array of ${String(node.length)}`);
      const elementType = /^array<(.+), \d+>$/.exec(mtekType)?.[1] ?? mtekType;
      value.forEach((item: unknown, index) => {
        writeNode(view, node.element, elementType, item, address + index * node.stride, `${where}[${String(index)}]`);
      });
      return;
    }
  }
}

function viewOf(m: MtekWriterMemory): DataView {
  return new DataView(m.f32.buffer, m.f32.byteOffset, m.f32.byteLength);
}

/** Writers for one layout record, shaped like a generated `writers` entry. */
export function layoutWriters(layout: MtekLayoutRecord): { all: Writer; fields: Record<string, Writer> } {
  const fields: Record<string, Writer> = {};
  for (const member of layout.root.members) {
    fields[member.name] = (m, base, value) => {
      writeNode(viewOf(m), member.node, member.mtekType, value, base, member.name);
    };
  }
  return {
    all: (m, base, value) => {
      writeNode(viewOf(m), layout.root, layout.id, value, base, layout.id);
    },
    fields,
  };
}

/** A program module for `manifest` whose entry scene runs `init`. */
export function syntheticProgram(manifest: MtekManifest, init: (ctx: object) => void, baseUrl: string): TestProgram {
  const writers = Object.fromEntries(manifest.layouts.map((layout) => [layout.id, layoutWriters(layout)]));
  const entities = manifest.scene.entities.map(() => null);
  return {
    abi: 1,
    baseUrl: new URL(baseUrl),
    manifestUrl: new URL("program.manifest.json", baseUrl),
    writers,
    functions: {},
    scenes: {
      [manifest.entryScene]: { init, update: null, fixedUpdate: null, entityUpdate: entities, entityFixedUpdate: entities, events: {}, bindings: [] },
    },
    prefabs: {},
  };
}
