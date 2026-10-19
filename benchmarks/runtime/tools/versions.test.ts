import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvedPackageVersion } from "./prepare.ts";
import { REPO_ROOT } from "./paths.ts";

describe("the engines the implementations use", () => {
  it("the direct and three.js implementations bundle the same Rapier as Mtek's physics adapter (the pinned 0.21.0)", () => {
    const backend = readFileSync(join(REPO_ROOT, "packages", "physics-rapier", "src", "backend.ts"), "utf8");
    const named = /BACKEND_NAME = "rapier3d-compat@([0-9.]+)"/.exec(backend)?.[1];
    expect(named).toBe("0.21.0");
    expect(resolvedPackageVersion("@dimforge/rapier3d-compat")).toBe(named);
  });

  it("three.js is the pinned r186.1", () => {
    expect(resolvedPackageVersion("three")).toBe("0.186.1");
  });
});
