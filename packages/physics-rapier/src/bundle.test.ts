/// <reference types="node" />
/**
 * The bundle the compiler ships as `physics/<h16>.js` (decision 0063): built exactly as `npm run build` does
 * (`scripts/bundle.mjs`), then loaded the way the runtime will load it in the browser (M5-05): a dynamic
 * `import()` of the one file, whose default export creates a working backend. The import runs in a fresh Node
 * process so that nothing but the file itself is available to it (no workspace, no `node_modules`).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OUTFILE, bundleOptions } from "../scripts/bundle.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

let directory: string;
let bundlePath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "mtek-physics-bundle-"));
  // .mjs only so that Node needs no package.json to know it is a module; the shipped name is physics/<h16>.js.
  bundlePath = join(directory, "physics.mjs");
  await build(bundleOptions({ absWorkingDir: PACKAGE_ROOT, outfile: bundlePath, logLevel: "silent" }));
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Runs `body` (module code that can use `load`, the bundle's default export) in a fresh Node process. */
function inFreshNode(body: string): unknown {
  const script = `const { default: load } = await import(${JSON.stringify(pathToFileURL(bundlePath).href)});\n${body}`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: directory,
    encoding: "utf8",
    timeout: 60_000,
  });
  return JSON.parse(out) as unknown;
}

describe("the physics bundle", () => {
  it("is written where the compiler's embedding expects it", () => {
    expect(OUTFILE).toBe("dist/physics.js");
  });

  it("is one self-contained ES module: no imports, no requires", () => {
    const text = readFileSync(bundlePath, "utf8");
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/\brequire\(/);
    expect(text).not.toMatch(/\bfrom\s*["']/);
    // The default export is the loader.
    expect(text).toMatch(/export\s*\{[^}]*\bas default\b/);
  });

  it("can be imported dynamically in Node and creates a working backend", () => {
    // A 1 m cube dropped from y = 3 onto a 1 m slab centred on the origin (top at y = 0.5) comes to rest at
    // 0.5 + 0.5 = 1.0 (to within the 5 mm contact skin), as in the adapter tests; this is that test through the
    // bundle, and the counts must return to zero.
    const result = inFreshNode(`
      const backend = await load();
      const again = await load();
      const id = { x: 0, y: 0, z: 0, w: 1 };
      const world = backend.createWorld({ x: 0, y: -9.81, z: 0 }, 1 / 60);
      world.addBody({ kind: "static" }, { shape: { kind: "box", size: { x: 40, y: 1, z: 40 } }, sensor: false, friction: 0.5, restitution: 0 }, { position: { x: 0, y: 0, z: 0 }, rotation: id }, 1);
      const h = world.addBody({ kind: "dynamic", mass: 1, linearDamping: 0, angularDamping: 0.05 }, { shape: { kind: "box", size: { x: 1, y: 1, z: 1 } }, sensor: false, friction: 0.5, restitution: 0 }, { position: { x: 0, y: 3, z: 0 }, rotation: id }, 2);
      const events = [];
      for (let i = 0; i < 180; i++) { world.step(); world.drainCollisions((a, b, started) => events.push([a, b, started])); }
      const rest = world.readPose(h).position.y;
      const before = world.counts();
      world.dispose();
      console.log(JSON.stringify({ name: backend.name, sameBackend: backend === again, rest, before, after: world.counts(), loaderType: typeof load, events }));
    `) as {
      name: string;
      sameBackend: boolean;
      rest: number;
      before: { bodies: number; colliders: number };
      after: { bodies: number; colliders: number };
      loaderType: string;
      events: [number, number, boolean][];
    };
    expect(result.loaderType).toBe("function");
    expect(result.name).toBe("rapier3d-compat@0.21.0");
    expect(result.sameBackend).toBe(true);
    expect(Math.abs(result.rest - 1.0)).toBeLessThan(0.005);
    expect(result.before).toEqual({ bodies: 2, colliders: 2 });
    expect(result.after).toEqual({ bodies: 0, colliders: 0 });
    // The landing was reported with the user ids 1 (floor) and 2 (box).
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0]?.[2]).toBe(true);
    expect(new Set([result.events[0]?.[0], result.events[0]?.[1]])).toEqual(new Set([1, 2]));
  });
});
