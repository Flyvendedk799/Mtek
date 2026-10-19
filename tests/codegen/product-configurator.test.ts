// The real example compiled in release mode: no hand-maintained duplicate scene and no GPU needed.
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createFakeContext, type FakeContext } from "./support/fake-ctx.js";
import { record } from "./support/programs.js";

const root = resolve(import.meta.dirname, "../..");
const site = resolve(root, "tests/codegen/.out/product-configurator");
const output = resolve(site, "dist");
type Fn = (...args: unknown[]) => unknown;
interface Scene {
  init: (ctx: FakeContext) => void;
  update: (ctx: FakeContext, dt: number) => void;
  events: { key_down: { key: string; fn: Fn }[] };
  bindings: ((ctx: FakeContext) => unknown)[];
}
interface Manifest {
  scene: {
    hostOutputs: { name: string; type: string }[];
    entities: { index: number; name: string; symbol: string; parent: number | null }[];
    bindings: { id: number; target: { kind: string; entity?: number; instance?: number; param?: string } }[];
  };
}
let scene: Scene;
let manifest: Manifest;
beforeAll(async () => {
  execFileSync("cargo", ["run", "--quiet", "--locked", "-p", "mtek-cli", "--", "build", "--mode", "release", "--out", output, "examples/product-configurator"], { cwd: root, stdio: "pipe" });
  cpSync(resolve(root, "examples/product-configurator/host"), resolve(site, "host"), { recursive: true });
  // The entire production host is checked against the emitted contract, not locally invented types.
  execFileSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", resolve(site, "host")], { cwd: root, stdio: "inherit" });
  const module = record(await import(/* @vite-ignore */ pathToFileURL(resolve(output, "app.js")).href), "program");
  scene = record(module["scenes"], "scenes")["Showroom"] as Scene;
  manifest = JSON.parse(readFileSync(resolve(output, "program.manifest.json"), "utf8")) as Manifest;
}, 120_000);

function setup(): FakeContext {
  const { ctx } = createFakeContext(manifest.scene.entities.length);
  scene.init(ctx);
  scene.update(ctx, 0);
  return ctx;
}
function index(name: string): number {
  const entity = manifest.scene.entities.find(entry => entry.symbol.endsWith(`.${name}`));
  if (!entity) throw new Error(`missing ${name}`);
  return entity.index;
}

describe("the embedded product configurator", () => {
  it("builds two independent assemblies from the one imported prefab", () => {
    const ctx = setup();
    expect(manifest.scene.entities).toHaveLength(19);
    const left = index("YourChair");
    const right = index("Reference");
    expect(manifest.scene.entities.filter(entity => entity.parent === left)).toHaveLength(7);
    expect(manifest.scene.entities.filter(entity => entity.parent === right)).toHaveLength(7);
    const original = structuredClone(ctx.e[right]?.state);
    ctx.s["finish"] = 1;
    ctx.s["frame_finish"] = 1;
    ctx.s["quantity"] = 3;
    scene.update(ctx, 0);
    expect(ctx.s["unit_price"]).toBe(415);
    expect(ctx.s["total_price"]).toBe(1245);
    expect(ctx.e[right]?.state).toEqual(original);
    expect(ctx.e[left]?.state["seat_color"]).not.toEqual(ctx.e[right]?.state["seat_color"]);
    const bindings = scene.bindings.map(binding => binding(ctx));
    expect(bindings).not.toContain(undefined);
  });

  it("scene keyboard handlers drive the exposed state and constrained quote", () => {
    const ctx = setup();
    const press = (key: string): void => {
      const handler = scene.events.key_down.find(event => event.key === key);
      if (!handler) throw new Error(`no ${key} handler`);
      handler.fn(ctx, null);
      scene.update(ctx, 0.25);
    };
    press("ArrowRight");
    expect(ctx.s["finish"]).toBe(1);
    expect(ctx.s["total_price"]).toBe(380);
    press("Space");
    expect(ctx.s["auto_rotate"]).toBe(true);
    expect(ctx.s["angle"]).toBeCloseTo(-0.1625, 6);
    ctx.s["quantity"] = 100;
    ctx.s["finish"] = -1;
    ctx.s["frame_finish"] = 100;
    scene.update(ctx, 0);
    expect(ctx.s).toMatchObject({ finish: 0, frame_finish: 0, quantity: 6, total_price: 2040 });
    expect(manifest.scene.hostOutputs.map(entry => entry.name).sort()).toEqual(["angle", "auto_rotate", "finish", "frame_finish", "quantity", "total_price", "unit_price"]);
  });
});
