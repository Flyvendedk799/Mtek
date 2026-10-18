// The dependency boundary is a real check: it passes on this repository and fails on a synthetic tree
// that violates each of its rules. If the scanner were a no-op, the second half of this file would fail.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBoundary, scanImports, type Violation } from "../src/check-boundary.ts";
import { REPO_ROOT, tempDir } from "./helpers.ts";

/** A minimal tree that satisfies the boundary: a language package, the harness core and its adapters. */
function cleanTree(): string {
  const root = tempDir("ai-eval-boundary-");
  const write = (path: string, text: string): void => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write("packages/runtime-web/package.json", JSON.stringify({ name: "@mtek/runtime-web", dependencies: {}, devDependencies: { esbuild: "1" } }));
  write("packages/runtime-web/src/index.ts", 'import { x } from "./x.ts";\nexport { x };\n');
  write("crates/mtek-cli/Cargo.toml", '[package]\nname = "mtek-cli"\n');
  write("tools/ai-eval/package.json", JSON.stringify({ name: "@mtek/ai-eval", optionalDependencies: { "@anthropic-ai/sdk": "1" } }));
  write("tools/ai-eval/src/cli.ts", 'import { createClient } from "./adapters/registry.ts";\nimport "./adapters/replay.ts";\n');
  write("tools/ai-eval/src/adapters/registry.ts", 'import { replay } from "./replay.ts";\nexport const load = () => import("./anthropic.ts");\nexport const loadB = () => import("./llama-cpp.ts");\n');
  write("tools/ai-eval/src/adapters/replay.ts", 'import type { M } from "../model-client.ts";\n');
  write("tools/ai-eval/src/adapters/anthropic.ts", 'import Anthropic from "@anthropic-ai/sdk";\nimport type { M } from "../model-client.ts";\n');
  write("tools/ai-eval/src/adapters/llama-cpp.ts", 'import { chat } from "../chat-completions.ts";\n');
  write("tools/ai-eval/src/adapters/openai-compatible.ts", 'import { chat } from "../chat-completions.ts";\n');
  return root;
}

function plant(root: string, path: string, text: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const rules = (violations: Violation[]): string[] => violations.map((v) => `${v.rule}:${v.file}`);

describe("the repository", () => {
  it("satisfies the boundary: no language package imports the harness, an adapter or a provider", () => {
    expect(checkBoundary(REPO_ROOT)).toEqual([]);
  });
});

describe("the check itself", () => {
  it("passes on a clean tree", () => {
    expect(checkBoundary(cleanTree())).toEqual([]);
  });

  describe("rule language-package", () => {
    it.each([
      ["a static import of an adapter by path", 'import { createClient } from "../../../tools/ai-eval/src/adapters/anthropic.ts";'],
      ["a static import of the registry", 'import { createClient } from "../../tools/ai-eval/src/adapters/registry.ts";'],
      ["an import of the harness package", 'import { RepairLoop } from "@mtek/ai-eval";'],
      ["a dynamic import of an adapter", 'const m = await import("../adapters/openai-compatible.ts");'],
      ["a require of a provider library", 'const Anthropic = require("@anthropic-ai/sdk");'],
      ["an import of a provider library", 'import OpenAI from "openai";'],
      ["a re-export from a provider library", 'export * from "node-llama-cpp";'],
      ["a multi-line import from a provider library", 'import {\n  a,\n  b,\n} from "ollama";'],
    ])("fails on %s in a language package", (_name, source) => {
      const root = cleanTree();
      plant(root, "packages/runtime-web/src/bad.ts", `${source}\n`);
      expect(rules(checkBoundary(root))).toEqual(["language-package:packages/runtime-web/src/bad.ts"]);
    });

    it("reports the line of the violation", () => {
      const root = cleanTree();
      plant(root, "packages/runtime-web/src/bad.ts", 'const a = 1;\n\nimport x from "@mtek/ai-eval/src/index.ts";\n');
      expect(checkBoundary(root)[0]).toMatchObject({ line: 3, rule: "language-package" });
    });

    it("fails when a language package declares a dependency on the harness or a provider", () => {
      for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        for (const name of ["@mtek/ai-eval", "@anthropic-ai/sdk", "openai"]) {
          const root = cleanTree();
          plant(root, "packages/physics-rapier/package.json", JSON.stringify({ name: "p", [section]: { [name]: "1" } }));
          expect(rules(checkBoundary(root)), `${section} ${name}`).toEqual(["language-package:packages/physics-rapier/package.json"]);
        }
      }
    });

    it("fails when a crate's manifest mentions the harness or a provider", () => {
      const root = cleanTree();
      plant(root, "crates/mtek-cli/Cargo.toml", '[dependencies]\nanthropic = "1"\n');
      expect(rules(checkBoundary(root))).toEqual(["language-package:crates/mtek-cli/Cargo.toml"]);
    });

    it("ignores imports that sit in comments, and node_modules and dist", () => {
      const root = cleanTree();
      plant(root, "packages/runtime-web/src/ok.ts", '// import x from "@mtek/ai-eval";\n/* import y from "openai"; */\nconst s = "see https://example.com//x";\n');
      plant(root, "packages/runtime-web/node_modules/dep/index.js", 'require("@anthropic-ai/sdk");\n');
      plant(root, "packages/runtime-web/dist/bundle.js", 'import "openai";\n');
      expect(checkBoundary(root)).toEqual([]);
    });
  });

  describe("rule core-adapter", () => {
    it.each([
      ["a static import of an optional adapter", 'import { createClient } from "./adapters/anthropic.ts";'],
      ["an import of an optional adapter through a parent path", 'import { createClient } from "../src/adapters/llama-cpp.ts";'],
      ["a dynamic import of an optional adapter", 'const m = await import("./adapters/openai-compatible.ts");'],
      ["an import of a provider library", 'import Anthropic from "@anthropic-ai/sdk";'],
    ])("fails on %s in the core", (_name, source) => {
      const root = cleanTree();
      plant(root, "tools/ai-eval/src/loop.ts", `${source}\n`);
      expect(rules(checkBoundary(root))).toEqual(["core-adapter:tools/ai-eval/src/loop.ts"]);
    });

    it("allows the core to use the registry and the replay adapter", () => {
      const root = cleanTree();
      plant(root, "tools/ai-eval/src/loop.ts", 'import { createClient } from "./adapters/registry.ts";\nimport { createReplayClient } from "./adapters/replay.ts";\n');
      expect(checkBoundary(root)).toEqual([]);
    });
  });

  describe("rule adapter-isolation", () => {
    it("fails when the registry imports an optional adapter statically", () => {
      const root = cleanTree();
      plant(root, "tools/ai-eval/src/adapters/registry.ts", 'import { createClient } from "./anthropic.ts";\n');
      expect(rules(checkBoundary(root))).toEqual(["adapter-isolation:tools/ai-eval/src/adapters/registry.ts"]);
    });

    it("fails when an adapter imports another adapter or the registry", () => {
      for (const [file, imported] of [
        ["llama-cpp.ts", "./openai-compatible.ts"],
        ["openai-compatible.ts", "./replay.ts"],
        ["anthropic.ts", "./registry.ts"],
      ]) {
        const root = cleanTree();
        plant(root, `tools/ai-eval/src/adapters/${file}`, `import x from "${imported}";\n`);
        expect(rules(checkBoundary(root)), `${file} -> ${imported}`).toEqual([`adapter-isolation:tools/ai-eval/src/adapters/${file}`]);
      }
    });

    it("fails when an adapter other than anthropic imports the Anthropic SDK or another provider", () => {
      for (const [file, lib] of [["openai-compatible.ts", "@anthropic-ai/sdk"], ["llama-cpp.ts", "openai"], ["replay.ts", "ollama"], ["anthropic.ts", "openai"]]) {
        const root = cleanTree();
        plant(root, `tools/ai-eval/src/adapters/${file}`, `import x from "${lib}";\n`);
        expect(rules(checkBoundary(root)), `${file} -> ${lib}`).toEqual([`adapter-isolation:tools/ai-eval/src/adapters/${file}`]);
      }
    });
  });

  describe("rule optional-dependency", () => {
    it("fails when a provider library is a hard dependency of the harness", () => {
      for (const section of ["dependencies", "devDependencies"]) {
        const root = cleanTree();
        plant(root, "tools/ai-eval/package.json", JSON.stringify({ name: "@mtek/ai-eval", [section]: { "@anthropic-ai/sdk": "1" } }));
        expect(rules(checkBoundary(root))).toEqual(["optional-dependency:tools/ai-eval/package.json"]);
      }
    });
  });
});

describe("scanImports", () => {
  it("finds static, type, side-effect, re-export, dynamic and require forms", () => {
    const source = [
      'import a from "a";',
      'import type { B } from "b";',
      'import "c";',
      'import * as d from "d";',
      'export * from "e";',
      'export { f } from "f";',
      'export type { G } from "g";',
      'const h = await import("h");',
      'const i = require("i");',
      'import {\n  j,\n  k\n} from "jk";',
    ].join("\n");
    expect(scanImports(source).map((r) => r.specifier).sort()).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "jk"]);
    expect(scanImports(source).find((r) => r.specifier === "h")?.dynamic).toBe(true);
    expect(scanImports(source).find((r) => r.specifier === "a")?.dynamic).toBe(false);
  });

  it("does not mistake words or strings for imports", () => {
    expect(scanImports('const important = "import x from y";\nconst imports = 1;\nfoo.import("x");\n// import z from "z";\n')).toEqual([]);
  });
});
