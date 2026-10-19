import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AssetHeavyDefinition } from "../common/layout.ts";
import { writeAssets } from "./assets.ts";
import { mtekProject, readWorkload } from "./gen-mtek.ts";
import { REPO_ROOT, RUNTIME_ROOT, WORKLOADS } from "./paths.ts";

/** The `mtek` executable `npm run build` / `cargo build -p mtek-cli` produced. */
function mtekExecutable(): string {
  const fromEnvironment = process.env["MTEK_CLI"];
  if (fromEnvironment !== undefined && fromEnvironment !== "") return fromEnvironment;
  const exe = process.platform === "win32" ? "mtek.exe" : "mtek";
  for (const profile of ["debug", "release"]) {
    const candidate = join(REPO_ROOT, "target", profile, exe);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("no mtek executable: run `cargo build -p mtek-cli --locked` (npm run build) or set MTEK_CLI");
}

describe("the committed Mtek programs", () => {
  it.each(WORKLOADS)("%s: the program on disk is exactly what tools/gen-mtek.ts prints (the three implementations cannot drift)", (workload) => {
    for (const [path, text] of mtekProject(workload)) {
      expect(readFileSync(join(RUNTIME_ROOT, workload, "mtek", path), "utf8"), `${workload}/mtek/${path}`).toBe(text);
    }
  });

  it("carry the numbers of the workload definition: entity counts match the sizes of the spec", () => {
    const count = (workload: (typeof WORKLOADS)[number], pattern: RegExp): number => (mtekProject(workload).get("src/main.mtek") ?? "").match(pattern)?.length ?? 0;
    expect(count("constant-scene", /^ {4}entity B\d+: Block/gm)).toBe(400);
    expect(count("changing-transforms", /^ {4}entity M\d+: Mover/gm)).toBe(1000);
    expect(count("changing-material-params", /^ {4}entity G\d+: Glow/gm)).toBe(500);
    expect(count("repeated-meshes", /^ {4}entity R\d+: Block/gm)).toBe(2000);
    expect(count("physics-bodies", /^ {4}entity C\d+: Crate/gm)).toBe(300);
    expect(count("asset-heavy-startup", /^ {4}entity S\d+ \{/gm)).toBe(12);
    expect(count("mount-reload-dispose", /^ {4}entity B\d+: Block/gm)).toBe(100);
  });

  it("the edited program of the reload step differs from the program only in the palette", () => {
    const primary = mtekProject("mount-reload-dispose").get("src/main.mtek") ?? "";
    const edited = mtekProject("mount-reload-dispose", "edited").get("src/main.mtek") ?? "";
    expect(edited).not.toBe(primary);
    const stripTint = (text: string): string => text.replace(/tint: #[0-9a-f]{6};/g, "tint: ?;").replace(/^\/\/ The edited program.*\n/m, "");
    expect(stripTint(edited)).toBe(stripTint(primary));
    expect(() => mtekProject("constant-scene", "edited")).toThrow(/only mount-reload-dispose/);
  });

  it("every program checks clean with the real compiler (0 errors, 0 warnings)", () => {
    const cli = mtekExecutable();
    const scratch = mkdtempSync(join(tmpdir(), "mtek-bench-check-"));
    try {
      for (const workload of WORKLOADS) {
        const project = join(scratch, workload);
        mkdirSync(project, { recursive: true });
        cpSync(join(RUNTIME_ROOT, workload, "mtek"), project, {
          recursive: true,
          filter: (source) => !/[\\/](models|textures)([\\/]|$)/.test(source),
        });
        if (workload === "asset-heavy-startup") {
          writeAssets(readWorkload(workload).definition as unknown as AssetHeavyDefinition, project, "project");
        }
        if (workload === "mount-reload-dispose") {
          const edited = join(scratch, `${workload}-edited`);
          mkdirSync(join(edited, "src"), { recursive: true });
          for (const [path, text] of mtekProject(workload, "edited")) writeFileSync(join(edited, path), text);
          const out = execFileSync(cli, ["check", edited], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
          expect(out).toContain("0 errors, 0 warnings");
        }
        const out = execFileSync(cli, ["check", project], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        expect(out, workload).toContain("0 errors, 0 warnings");
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
