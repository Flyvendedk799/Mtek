import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { createFakeContext, type FakeContext } from "./support/fake-ctx.js";
import { record } from "./support/programs.js";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(import.meta.dirname, ".out/string-equality");
let scene: { init(ctx: FakeContext): void; update(ctx: FakeContext, dt: number): void };
beforeAll(async () => {
  execFileSync("cargo", ["run", "--quiet", "--locked", "-p", "mtek-cli", "--", "build", "--out", out, "tests/semantics/pass/string_equality"], { cwd: root, stdio: "pipe" });
  const module = record(await import(/* @vite-ignore */ pathToFileURL(resolve(out, "app.js")).href), "program");
  scene = record(module["scenes"], "scenes")["Demo"] as typeof scene;
}, 120_000);

it("executes exact string equality and inequality without coercion", () => {
  const { ctx } = createFakeContext(1);
  scene.init(ctx);
  expect(ctx.s["same"]).toBe(true); // folded empty-string equality
  expect(ctx.s["different"]).toBe(true);
  for (const payload of ["hit", "Hit", "", "hit ", "é", "é"]) {
    ctx.s["payload"] = payload;
    scene.update(ctx, 1 / 60);
    expect(ctx.s["same"]).toBe(payload === "hit");
    expect(ctx.s["different"]).toBe(payload !== "hit");
  }
});
