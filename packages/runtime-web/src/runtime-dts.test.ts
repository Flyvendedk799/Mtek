/**
 * `src/runtime.d.ts` is hand-maintained (spec/runtime-abi.md section 6.1). These tests prove that
 *  - a host snippet written against it compiles with `tsc --strict`, and wrong usage does not;
 *  - it agrees with the implementation's own types in both directions, so the two cannot drift;
 *  - `npm run build` ships the same declaration syntax without comments.
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
  // flavour.d.ts declares the build-time constant the implementation files refer to.
  const program = ts.createProgram([SNIPPET, path.join(SRC_DIR, "flavour.d.ts")], compilerOptions, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => {
      const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      const where = d.file === undefined ? "" : `${path.basename(d.file.fileName)}: `;
      return `${where}TS${String(d.code)} ${text}`;
    });
}

describe("runtime.d.ts with tsc --strict", () => {
  it("matches the copied spatial and animation diagnostic shapes", () => {
    expect(compile(`
      import type * as D from "./runtime.js";
      import type * as S from "./host/inspection.js";
      import type * as A from "./scene/animation-inspection.js";
      import type * as P from "./host/physics-api.js";
      type Mutual<X,Y>=[X] extends [Y]?([Y] extends [X]?true:false):false;
      export const scene:Mutual<D.SceneInspection,S.SceneInspection>=true;
      export const animation:Mutual<D.AnimationInspection,A.AnimationInspection>=true;
      export const body:Mutual<D.ScenePhysicsBody,S.ScenePhysicsBody>=true;
      export const physics:Mutual<D.MtekPhysics,P.MtekPhysics>=true;
      export const shape:Mutual<D.MtekQueryShape,P.MtekQueryShape>=true;
      export const options:Mutual<D.MtekQueryOptions,P.MtekQueryOptions>=true;
      export const rayHit:Mutual<D.MtekRayHit,P.MtekRayHit>=true;
      export const contact:Mutual<D.MtekContact,P.MtekContact>=true;
    `,{types:["@webgpu/types"],skipLibCheck:true})).toEqual([]);
  });
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
          const hit = app.physics?.castRay({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10, { includeSensors: true });
          const entityId: string | undefined = hit?.entityId;
          app.physics?.setCollisionGroups(entityId ?? "", 1, 0xffff);
          debug?.step(3, 1 / 60);
          const pixels = await debug?.readPixels();
          console.log(pixels?.format, pixels?.data.length, debug?.counters()["liveBuffers"], debug?.scene().entities[0]?.name, state);
          app.dispose();
        } catch (error) {
          if (error instanceof MtekMountError) {
            const kind: "webgpu-unavailable" | "adapter-unavailable" | "device-failed" | "incompatible-program"
              | "manifest-invalid" | "shader-failed" | "asset-failed" | "allocation-failed" | "physics-failed" | "budget-exceeded" = error.kind;
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

  it("infers typed outputs from a generated program without explicit mount type arguments", () => {
    const problems = compile(`
      import { mountMtek } from "./runtime.js";
      import type { MtekProgram } from "./runtime.js";
      interface Inputs { quantity: number }
      interface Outputs { total: number; selected: string; available: boolean; position: readonly [number, number, number] }
      declare const program: MtekProgram<Inputs, Outputs>;
      declare const canvas: HTMLCanvasElement;
      export async function run(): Promise<void> {
        const app = await mountMtek(canvas, program);
        const stop: () => void = app.onOutput("total", (value) => {
          const total: number = value;
          const valueIsAny: 0 extends (1 & typeof value) ? true : false = false;
          console.log(total, valueIsAny);
        });
        app.onOutput("selected", (value) => { const selected: string = value; console.log(selected); });
        app.onOutput("available", (value) => { const available: boolean = value; console.log(available); });
        app.onOutput("position", (value) => { const position: readonly [number, number, number] = value; console.log(position); });
        app.setInput("quantity", 2);
        stop();
      }
    `, { skipLibCheck: false });
    expect(problems).toEqual([]);
  });

  it("keeps one-generic host programs, handles and mount calls compatible with generated Outputs interfaces", () => {
    // An interface (including an empty one) is not implicitly assignable to Record<string, unknown>.
    // This must exercise the compiler's interface shape, rather than hiding the regression with a type alias.
    // Two complete tsc programs can exceed the default 5s under parallel CI load;
    // this checks compatibility, not compiler timing.
    for (const fields of ["", "total: number; position: readonly [number, number, number]"]) {
      const problems = compile(`
        import { mountMtek } from "./runtime.js";
        import type { MtekApp, MtekProgram } from "./runtime.js";
        import { mountMtek as implMount } from "./host/mount.js";
        import type { MtekApp as ImplApp, MtekMountProgram } from "./host/types.js";
        import type { MtekProgram as ImplProgram } from "./abi/program.js";
        interface Inputs { quantity: number }
        interface Outputs { ${fields} }
        declare const program: MtekProgram<Inputs, Outputs>;
        declare const generated: ImplProgram<Inputs, Outputs>;
        declare const canvas: HTMLCanvasElement;
        declare const app: MtekApp<Inputs, Outputs>;
        declare const implApp: ImplApp<Inputs, Outputs>;
        export const legacyProgram: MtekProgram<Inputs> = program;
        export const legacyGenerated: ImplProgram<Inputs> = generated;
        export const legacyMountProgram: MtekMountProgram<Inputs> = generated;
        export const legacyApp: MtekApp<Inputs> = app;
        export const legacyImplApp: ImplApp<Inputs> = implApp;
        export const explicit: Promise<MtekApp<Inputs>> = mountMtek<Inputs>(canvas, program);
        export const explicitImpl: Promise<ImplApp<Inputs>> = implMount<Inputs>(canvas, generated);
        export const inferred: Promise<MtekApp<Inputs>> = mountMtek(canvas, program);
        export const inferredImpl: Promise<ImplApp<Inputs>> = implMount(canvas, generated);
        legacyApp.onOutput("an-untyped-name", value => {
          const valueIsAny: 0 extends (1 & typeof value) ? true : false = false;
          const output: unknown = value;
          console.log(valueIsAny, output);
        });
      `, { types: ["@webgpu/types"] });
      expect(problems).toEqual([]);
    }
  }, 20_000);

  // The app.d.ts the compiler emits (M1-17 golden; no host inputs before M3).
  const compiledAppDts = readFileSync(
    path.resolve(PACKAGE_DIR, "../../tests/codegen/scene_a_target_camera_box/expected/app.d.ts"),
    "utf8",
  );
  const host = `
    import { mountMtek as mount } from "./runtime.js";
    declare const canvas: HTMLCanvasElement;
  `;

  it("accepts the compiler's app.d.ts and a host using it", () => {
    const problems = compile(
      `${compiledAppDts}${host}
      export async function run(): Promise<void> {
        const app = await mount(canvas, program, { failureDisplay: "overlay" });
        app.pause();
        app.dispose();
      }`,
      { skipLibCheck: false },
    );
    expect(problems).toEqual([]);
  });

  it("rejects setting an input the compiler's app.d.ts does not declare", () => {
    const problems = compile(
      `${compiledAppDts}${host}
      export async function run(): Promise<void> {
        const app = await mount(canvas, program);
        app.setInput("tint", "#ff0000");
      }`,
    );
    expect(problems.join("\n")).toMatch(/TS2345/);
  });

  const wrong: Array<[string, string, RegExp]> = [
    [
      "an unknown inferred output name",
      `import { mountMtek, type MtekProgram } from "./runtime.js";
       interface Outputs { total: number }
       declare const program: MtekProgram<{}, Outputs>;
       declare const canvas: HTMLCanvasElement;
       (await mountMtek(canvas, program)).onOutput("missing", () => undefined);`,
      /TS2345/,
    ],
    [
      "an incorrectly typed inferred output listener",
      `import { mountMtek, type MtekProgram } from "./runtime.js";
       interface Outputs { total: number }
       declare const program: MtekProgram<{}, Outputs>;
       declare const canvas: HTMLCanvasElement;
       (await mountMtek(canvas, program)).onOutput("total", (value: string) => { console.log(value); });`,
      /TS2345/,
    ],
    [
      "subscribing to an inferred empty Outputs interface",
      `import { mountMtek, type MtekProgram } from "./runtime.js";
       interface Outputs {}
       declare const program: MtekProgram<{}, Outputs>;
       declare const canvas: HTMLCanvasElement;
       (await mountMtek(canvas, program)).onOutput("missing", () => undefined);`,
      /TS2345/,
    ],
    [
      "an unknown output name",
      `import type { MtekApp } from "./runtime.js";
       declare const app: MtekApp<{}, { total: number }>;
       app.onOutput("missing", () => undefined);`,
      /TS2345/,
    ],
    [
      "an incorrectly typed output listener",
      `import type { MtekApp } from "./runtime.js";
       declare const app: MtekApp<{}, { total: number }>;
       app.onOutput("total", (value: string) => { console.log(value); });`,
      /TS2345/,
    ],
    [
      "writing to an exported vector snapshot",
      `import type { MtekApp } from "./runtime.js";
       declare const app: MtekApp<{}, { position: readonly [number, number, number] }>;
       app.onOutput("position", (value) => { value[0] = 5; });`,
      /TS2540/,
    ],
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
  it("accepts independently consumed animation and asset APIs with their implementation types",()=>{
    const problems=compile(`
      import type * as D from "./runtime.js";
      import * as A from "./animation.js";
      import {AssetPool} from "./assets/pool.js";
      declare const skin:D.MtekSkin;
      export const controller:D.AnimationController=A.createAnimationController(skin);
      export const pool:Pick<D.AssetPool,"load"|"snapshot"|"dispose">=new AssetPool({baseUrl:new URL("https://example.test/")});
      const loader:D.AssetLoader<string>={id:"text",apiVersion:1,decode:bytes=>new TextDecoder().decode(bytes)};
      export const lease:Promise<D.AssetLease<string>>=pool.load({url:"asset.txt"},loader);
      controller.setLayer("action",{clip:"wave",weight:0.5,mask:{arm:1}});
      controller.setIK("hand",{chain:["arm","elbow","hand"],target:[1,2,3]});
      controller.player.setRootMotion("hips");
      controller.setUpdatePolicy([{distance:0,interval:0},{distance:20,interval:0.1}]);
      controller.setLocomotion({samples:[{clip:"walk",threshold:1},{clip:"run",threshold:4}],parameter:2});
      controller.setLocomotionParameter(3);controller.update(0.016,false,25);
      controller.player.locomotion.pause();controller.player.locomotion.resume();
      controller.setIK("foot",{chain:["hip","knee","foot"],target:[0,0,0],rotation:[0,0,0,1],limits:{knee:{axis:[1,0,0],min:0,max:2}}});
      export const retargeted:D.MtekSkin=A.retargetSkin(skin,skin,{}, {rotationSpace:"world",nodeTranslationScales:{hips:1.2}});
      type Mutual<X,Y>=[X] extends [Y]?([Y] extends [X]?true:false):false;
      export const optionsMatch:Mutual<D.LocomotionOptions,A.LocomotionOptions>=true;
      export const limitsMatch:Mutual<D.IKConstraint,A.IKConstraint>=true;
      export const retargetMatch:Mutual<D.RetargetOptions,A.RetargetOptions>=true;
      export const delta=controller.player.consumeRootMotion();
      export const humanoid:D.HumanoidMap|{readonly error:string}=A.mapHumanoid(skin);
      export const humanoidRetargeted:D.MtekSkin=A.retargetHumanoid(skin,skin,{translationScale:2,restCorrection:false,maxKeyInterval:0.05});
      export const humanoidMatch:Mutual<D.HumanoidMap,A.HumanoidMap>=true;
      export const humanoidBoneMatch:Mutual<D.HumanoidBone,A.HumanoidBone>=true;
      export const humanoidOptionsMatch:Mutual<D.HumanoidRetargetOptions,A.HumanoidRetargetOptions>=true;
      export const humanoidMapFunction:Mutual<typeof D.mapHumanoid,typeof A.mapHumanoid>=true;
      export const humanoidRetargetFunction:Mutual<typeof D.retargetHumanoid,typeof A.retargetHumanoid>=true;
    `,{types:["@webgpu/types"],skipLibCheck:true});
    expect(problems).toEqual([]);
  });
  it("every public type is mutually assignable with its implementation type, and mountMtek has the same signature", () => {
    const problems = compile(
      `
      import type * as D from "./runtime.js";
      import type * as H from "./host/types.js";
      import type * as G from "./diagnostics/types.js";
      import type { mountMtek as implMount } from "./host/mount.js";

      type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
      type Inputs = { tint: string; speed: number };
      type Outputs = { total: number; position: readonly [number, number, number] };

      export const mountOptions: Mutual<D.MtekMountOptions<Inputs>, H.MtekMountOptions<Inputs>> = true;
      export const testOptions: Mutual<D.MtekTestOptions, H.MtekTestOptions> = true;
      export const debug: Mutual<D.MtekDebug, H.MtekDebug> = true;
      export const inputResult: Mutual<D.MtekInputResult, H.MtekInputResult> = true;
      export const app: Mutual<D.MtekApp<Inputs>, H.MtekApp<Inputs>> = true;
      export const outputApp: Mutual<D.MtekApp<Inputs, Outputs>, H.MtekApp<Inputs, Outputs>> = true;
      export const outputProgram: Mutual<D.MtekProgram<Inputs, Outputs>, H.MtekMountProgram<Inputs, Outputs>> = true;
      export const outputMount: Mutual<typeof D.mountMtek<Inputs, Outputs>, typeof implMount<Inputs, Outputs>> = true;
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
  it("ships every declaration unchanged while omitting comments from compiled app typings", () => {
    execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: PACKAGE_DIR, stdio: "pipe" });
    const source = readFileSync(path.join(SRC_DIR, "runtime.d.ts"), "utf8");
    const copy = readFileSync(path.join(PACKAGE_DIR, "dist", "runtime.d.ts"), "utf8");
    const syntax = (text: string): unknown => {
      const shape = (node: ts.Node): unknown => {
        const children: unknown[] = []; ts.forEachChild(node, (child) => { children.push(shape(child)); });
        const literal = ts.isIdentifier(node) || ts.isLiteralExpression(node) || ts.isTemplateLiteralToken(node) ? node.text : null;
        return [node.kind, literal, children];
      };
      return shape(ts.createSourceFile("runtime.d.ts", text, ts.ScriptTarget.ES2022, true));
    };
    expect(syntax(copy)).toEqual(syntax(source));
    expect(copy.length).toBeLessThan(source.length);
    expect(copy).not.toContain("/**");
    const declarationFile = path.join(PACKAGE_DIR, "dist", "runtime.d.ts");
    const declarationProgram = ts.createProgram([declarationFile], { noEmit: true, strict: true, skipLibCheck: false, types: [], lib: ["lib.es2022.d.ts", "lib.dom.d.ts"] });
    expect(ts.getPreEmitDiagnostics(declarationProgram).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    const bundle = readFileSync(path.join(PACKAGE_DIR, "dist", "runtime.js"), "utf8");
    expect(bundle).toMatch(/export\s*\{[^}]*\bmountMtek\b/);
  }, 60_000);
});
