/**
 * `src/runtime.d.ts` is hand-maintained (spec/runtime-abi.md section 6.1). These tests prove that
 *  - a host snippet written against it compiles with `tsc --strict`, and wrong usage does not;
 *  - it agrees with the implementation's own types in both directions, so the two cannot drift;
 *  - `npm run build` copies it to `dist/runtime.d.ts`.
 */
/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("./", import.meta.url));
const PACKAGE_DIR = path.resolve(SRC_DIR, "..");
const SNIPPET = path.join(SRC_DIR, "__host-snippet.ts");

function compile(source: string, options: ts.CompilerOptions = {}): string[] {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    types: [],
    // The declarations under test are checked by the tests that pass `skipLibCheck: false`.
    skipLibCheck: true,
    ...options,
  };
  const host = ts.createCompilerHost(compilerOptions);
  const realGetSourceFile = host.getSourceFile.bind(host);
  const realFileExists = host.fileExists.bind(host);
  const realReadFile = host.readFile.bind(host);
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreate) =>
    path.resolve(fileName) === SNIPPET
      ? ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true)
      : realGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate);
  host.fileExists = (fileName) => path.resolve(fileName) === SNIPPET || realFileExists(fileName);
  host.readFile = (fileName) => (path.resolve(fileName) === SNIPPET ? source : realReadFile(fileName));
  const program = ts.createProgram([SNIPPET], compilerOptions, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => {
      const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      const where = d.file === undefined ? "" : `${path.basename(d.file.fileName)}: `;
      return `${where}TS${String(d.code)} ${text}`;
    });
}

describe("runtime.d.ts with tsc --strict", () => {
  it("accepts the host usage of spec/runtime-abi.md section 6", () => {
    const problems = compile(`
      import { mountMtek, MtekMountError } from "./runtime.js";
      import type { MtekApp, MtekDebug, MtekDiagnostic, MtekInputResult, MtekMountOptions, MtekProgram, MtekTestOptions } from "./runtime.js";

      interface Inputs { tint: \`#\${string}\`; speed: number }
      declare const program: MtekProgram<Inputs>;
      declare const canvas: HTMLCanvasElement;

      const test: MtekTestOptions = { manualClock: true, renderTarget: { width: 64, height: 64 } };
      const options: MtekMountOptions<Inputs> = {
        inputs: { tint: "#ff0000" },
        onDiagnostic: (d: MtekDiagnostic) => { console.log(d.code, d.severity, d.message, d.source?.file, d.phase); },
        failureDisplay: "overlay",
        seed: 7,
        pauseWhenHidden: true,
        devicePixelRatio: "auto",
        test,
      };

      export async function run(): Promise<void> {
        try {
          const app: MtekApp<Inputs> = await mountMtek(canvas, program, options);
          const result: MtekInputResult = app.setInput("speed", 2);
          if (!result.ok) console.log(result.error.code, result.error.message);
          app.pause();
          app.resume();
          const state: "running" | "paused" | "recovering" | "failed" | "disposed" = app.state;
          const debug: MtekDebug | undefined = app.debug;
          debug?.step(3, 1 / 60);
          const pixels = await debug?.readPixels();
          console.log(pixels?.format, pixels?.data.length, debug?.counters()["liveBuffers"], debug?.scene().entities[0]?.name, state);
          app.dispose();
        } catch (error) {
          if (error instanceof MtekMountError) {
            const kind: "webgpu-unavailable" | "adapter-unavailable" | "device-failed" | "incompatible-program"
              | "manifest-invalid" | "shader-failed" | "asset-failed" | "allocation-failed" = error.kind;
            console.log(kind, error.diagnostics[0]?.code);
          }
        }
      }
      // Options are all optional, and the default Inputs type accepts any key.
      export const minimal = (p: MtekProgram) => mountMtek(canvas, p);
    `, { skipLibCheck: false });
    expect(problems).toEqual([]);
  });

  it("matches the generated app.d.ts shape of spec/runtime-abi.md section 6.4", () => {
    const problems = compile(`
      import type { MtekProgram } from "./runtime.js";
      export interface Inputs { tint: \`#\${string}\` }
      declare const program: MtekProgram<Inputs>;
      export default program;
      export { mountMtek } from "./runtime.js";
    `);
    expect(problems).toEqual([]);
  });

  const wrong: Array<[string, string, RegExp]> = [
    [
      "a wrongly typed input value",
      `import type { MtekApp } from "./runtime.js";
       declare const app: MtekApp<{ speed: number }>;
       app.setInput("speed", "fast");`,
      /TS2345/,
    ],
    [
      "an unknown input name",
      `import type { MtekApp } from "./runtime.js";
       declare const app: MtekApp<{ speed: number }>;
       app.setInput("nope", 1);`,
      /TS2345/,
    ],
    [
      "an invalid failureDisplay",
      `import type { MtekMountOptions } from "./runtime.js";
       export const o: MtekMountOptions = { failureDisplay: "banner" };`,
      /TS2322/,
    ],
    [
      "an unknown mount option",
      `import type { MtekMountOptions } from "./runtime.js";
       export const o: MtekMountOptions = { autoplay: true };`,
      /TS2353/,
    ],
    [
      "inputs of the wrong type",
      `import type { MtekMountOptions } from "./runtime.js";
       export const o: MtekMountOptions<{ speed: number }> = { inputs: { speed: "fast" } };`,
      /TS2322/,
    ],
    [
      "a program that is not an MtekProgram",
      `import { mountMtek } from "./runtime.js";
       declare const canvas: HTMLCanvasElement;
       void mountMtek(canvas, { abi: 2 });`,
      /TS2322|TS2345/,
    ],
    [
      "comparing the error kind with an unknown kind",
      `import { MtekMountError } from "./runtime.js";
       export const f = (e: MtekMountError) => e.kind === "shader-broken";`,
      /TS2367/,
    ],
    [
      "assigning the readonly state",
      `import type { MtekApp } from "./runtime.js";
       declare const app: MtekApp;
       app.state = "running";`,
      /TS2540/,
    ],
    [
      "a render target without a height",
      `import type { MtekTestOptions } from "./runtime.js";
       export const t: MtekTestOptions = { renderTarget: { width: 8 } };`,
      /TS2741/,
    ],
    [
      "a devicePixelRatio that is neither a number nor 'auto'",
      `import type { MtekMountOptions } from "./runtime.js";
       export const o: MtekMountOptions = { devicePixelRatio: "retina" };`,
      /TS2322/,
    ],
  ];
  for (const [name, source, expected] of wrong) {
    it(`rejects ${name}`, () => {
      const problems = compile(source);
      expect(problems.join("\n")).toMatch(expected);
    });
  }

  it("is self-contained: it compiles with only the DOM library and imports nothing", () => {
    const text = readFileSync(path.join(SRC_DIR, "runtime.d.ts"), "utf8");
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(compile(`import type {} from "./runtime.js";`, { skipLibCheck: false })).toEqual([]);
  });
});

describe("runtime.d.ts agrees with the implementation", () => {
  it("every public type is mutually assignable with its implementation type, and mountMtek has the same signature", () => {
    const problems = compile(
      `
      import type * as D from "./runtime.js";
      import type * as H from "./host/types.js";
      import type * as G from "./diagnostics/types.js";
      import type { mountMtek as implMount } from "./host/mount.js";

      type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
      type Inputs = { tint: string; speed: number };

      export const mountOptions: Mutual<D.MtekMountOptions<Inputs>, H.MtekMountOptions<Inputs>> = true;
      export const testOptions: Mutual<D.MtekTestOptions, H.MtekTestOptions> = true;
      export const debug: Mutual<D.MtekDebug, H.MtekDebug> = true;
      export const inputResult: Mutual<D.MtekInputResult, H.MtekInputResult> = true;
      export const app: Mutual<D.MtekApp<Inputs>, H.MtekApp<Inputs>> = true;
      export const program: Mutual<D.MtekProgram<Inputs>, H.MtekMountProgram<Inputs>> = true;
      export const diagnostic: Mutual<D.MtekDiagnostic, G.MtekDiagnostic> = true;
      export const source: Mutual<D.MtekSourceSpan, G.MtekSourceSpan> = true;
      export const related: Mutual<D.MtekRelatedSpan, G.MtekRelatedSpan> = true;
      export const edit: Mutual<D.MtekSuggestedEdit, G.MtekSuggestedEdit> = true;
      export const mountError: Mutual<D.MtekMountError, G.MtekMountError> = true;
      export const mountKind: Mutual<D.MtekMountError["kind"], G.MtekMountErrorKind> = true;
      export const mountFn: Mutual<typeof D.mountMtek<Inputs>, typeof implMount<Inputs>> = true;
      `,
      { types: ["@webgpu/types"], skipLibCheck: true },
    );
    expect(problems).toEqual([]);
  });

  it("the check can fail: a deliberately different type is detected", () => {
    const problems = compile(
      `
      import type * as D from "./runtime.js";
      type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
      export const different: Mutual<D.MtekApp, { state: string }> = true;
      `,
    );
    expect(problems.join("\n")).toMatch(/TS2322/);
  });
});

describe("npm run build", () => {
  it("copies src/runtime.d.ts byte for byte to dist/runtime.d.ts next to the bundle", () => {
    execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: PACKAGE_DIR, stdio: "pipe" });
    const source = readFileSync(path.join(SRC_DIR, "runtime.d.ts"));
    const copy = readFileSync(path.join(PACKAGE_DIR, "dist", "runtime.d.ts"));
    expect(copy.equals(source)).toBe(true);
    const bundle = readFileSync(path.join(PACKAGE_DIR, "dist", "runtime.js"), "utf8");
    expect(bundle).toMatch(/export\s*\{[^}]*\bmountMtek\b/);
  }, 60_000);
});
