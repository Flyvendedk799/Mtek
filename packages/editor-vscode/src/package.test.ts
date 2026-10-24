// The package: what `vsce package` would put into the .vsix, and that the manifest points at it.
// Needs `npm run build` (dist/extension.cjs), like every test that needs the built artefacts.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "./grammar/testing.ts";

const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
  name: string;
  version: string;
  publisher: string;
  main: string;
  engines: { vscode: string };
  devDependencies: Record<string, string>;
  dependencies: Record<string, string>;
  activationEvents: string[];
  contributes: {
    languages: { id: string; extensions: string[]; configuration: string }[];
    grammars: { language: string; scopeName: string; path: string }[];
    commands: { command: string; title: string }[];
    configuration: { properties: Record<string, { default: unknown; scope?: string }> };
  };
  capabilities: { untrustedWorkspaces: { restrictedConfigurations: string[] } };
};

function packagedFiles(): string[] {
  requireBundle();
  const vsce = join(dirname(require.resolve("@vscode/vsce/package.json")), "vsce");
  const out = execFileSync(process.execPath, [vsce, "ls", "--no-dependencies"], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
  });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter((line) => line !== "")
    .sort();
}

function requireBundle(): void {
  if (!existsSync(join(PACKAGE_ROOT, "dist", "extension.cjs"))) {
    throw new Error("Extension package tests need dist/extension.cjs: run `npm run build` first.");
  }
}

describe("the extension package", () => {
  it("packages exactly the manifest, the readme, the grammar, the language configuration and the bundle", () => {
    expect(packagedFiles()).toEqual(
      [
        "README.md",
        "dist/extension.cjs",
        "language-configuration.json",
        "package.json",
        "syntaxes/mtek.tmLanguage.json",
      ].sort(),
    );
  });

  it("points at files that are packaged", () => {
    const files = packagedFiles();
    const relative = (path: string): string => path.replace(/^\.\//, "");
    expect(files).toContain(relative(manifest.main));
    expect(files).toContain(relative(manifest.contributes.grammars[0]?.path ?? ""));
    expect(files).toContain(relative(manifest.contributes.languages[0]?.configuration ?? ""));
    for (const file of files) expect(existsSync(join(PACKAGE_ROOT, file)), file).toBe(true);
  });

  it("is the Mtek language for .mtek files, activated by it", () => {
    expect(manifest.name).toBe("mtek-vscode");
    expect(manifest.contributes.languages[0]).toMatchObject({ id: "mtek", extensions: [".mtek"] });
    expect(manifest.contributes.grammars[0]).toMatchObject({ language: "mtek", scopeName: "source.mtek" });
    expect(manifest.activationEvents).toEqual(["onLanguage:mtek"]);
  });

  it("asks for a VS Code the client library and the typings agree on", () => {
    const floor = /^\^(\d+\.\d+)\.0$/.exec(manifest.engines.vscode);
    expect(floor, manifest.engines.vscode).not.toBeNull();
    // `vsce` refuses typings newer than the engine; the typings are exactly the floor
    expect(manifest.devDependencies["@types/vscode"]).toBe(`${floor?.[1] ?? ""}.0`);
  });

  it("pins every dependency exactly (decision 0007)", () => {
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("has the settings and commands the README names, and restricts the executable in untrusted workspaces", () => {
    const properties = manifest.contributes.configuration.properties;
    expect(Object.keys(properties).sort()).toEqual(["mtek.server.path", "mtek.trace.server"]);
    expect(properties["mtek.server.path"]).toMatchObject({ default: "mtek", scope: "machine-overridable" });
    expect(manifest.capabilities.untrustedWorkspaces.restrictedConfigurations).toContain("mtek.server.path");
    expect(manifest.contributes.commands.map((c) => c.command).sort()).toEqual([
      "mtek.restartServer",
      "mtek.showServerLog",
    ]);
    const readme = readFileSync(join(PACKAGE_ROOT, "README.md"), "utf8");
    for (const name of [...Object.keys(properties), ...manifest.contributes.commands.map((c) => c.title)]) {
      expect(readme, name).toContain(name);
    }
  });

  it("is a bundle that needs nothing but `vscode` and Node (the .vsix carries no node_modules)", () => {
    requireBundle();
    const bundle = readFileSync(join(PACKAGE_ROOT, "dist", "extension.cjs"), "utf8");
    const required = new Set([...bundle.matchAll(/\brequire\("([^"]+)"\)/g)].map((m) => m[1] ?? ""));
    const allowed = new Set(["vscode", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
    expect([...required].filter((name) => !allowed.has(name))).toEqual([]);
    expect(required.has("vscode")).toBe(true);
  });
});
