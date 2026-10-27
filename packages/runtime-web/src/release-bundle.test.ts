/// <reference types="node" />
/**
 * The release runtime contains no development code (`spec/tooling.md` section 2, decision 0055).
 *
 * This builds both flavours of the runtime bundle exactly as `npm run build` does
 * (`scripts/flavours.mjs`) and inspects the output: the release bundle must not contain a byte of any
 * module under `src/dev/` (the overlay, the GPU timer, the frame statistics) nor any of their strings,
 * and the development bundle must, otherwise the check would prove nothing.
 */
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { FLAVOURS, bundleOptions, type Flavour } from "../scripts/flavours.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

interface Built {
  readonly text: string;
  /** Bytes each source module contributes to the bundle, by path relative to the package. */
  readonly bytesBySource: ReadonlyMap<string, number>;
}

async function bundle(flavour: Flavour): Promise<Built> {
  const result = await build(
    bundleOptions(flavour, { absWorkingDir: PACKAGE_ROOT, write: false, metafile: true, logLevel: "silent", sourcemap: false }),
  );
  const [file] = result.outputFiles ?? [];
  if (file === undefined || result.metafile === undefined) throw new Error(`no output for the ${flavour} flavour`);
  const output = Object.values(result.metafile.outputs)[0];
  if (output === undefined) throw new Error("no metafile output");
  const bytesBySource = new Map(Object.entries(output.inputs).map(([path, input]) => [path, input.bytesInOutput]));
  return { text: file.text, bytesBySource };
}

/** Text that only the development overlay, the GPU timer or the frame statistics contain. */
const DEV_ONLY_TEXT = [
  "data-mtek-dev-overlay",
  "GPU time unavailable",
  "GPU time: pending",
  "gpu timer resolve",
  "Shift+` next entity",
  "FRAME_WINDOW",
  "nearestRank",
] as const;

const devSources = (built: Built): Array<[string, number]> => [...built.bytesBySource].filter(([path]) => path.startsWith("src/dev/"));

describe("the runtime bundle flavours", () => {
  it("name their output files as the compiler expects", () => {
    expect(FLAVOURS.release.outfile).toBe("dist/core.js");
    expect(FLAVOURS.dev.outfile).toBe("dist/core.dev.js");
    expect(FLAVOURS.min.outfile).toBe("dist/core.min.js");
    expect(FLAVOURS.animation.outfile).toBe("dist/animation.js");
    expect(FLAVOURS.animationMin.outfile).toBe("dist/animation.min.js");
    // The npm entry keeps its name: `@mtek/runtime-web` exports `dist/runtime.js` (package.json).
    expect(FLAVOURS.full.outfile).toBe("dist/runtime.js");
  });

  it("the development bundle contains the overlay, the GPU timer and the statistics", async () => {
    const dev = await bundle("dev");
    const sources = devSources(dev);
    expect(sources.map(([path]) => path).sort()).toEqual(
      ["src/dev/frame-stats.ts", "src/dev/gpu-timer.ts", "src/dev/overlay.ts", "src/dev/panel.ts", "src/dev/tools.ts"],
    );
    for (const [path, bytes] of sources) expect(bytes, `${path} in the dev bundle`).toBeGreaterThan(0);
    for (const text of DEV_ONLY_TEXT) expect(dev.text, text).toContain(text);
  });

  it("the release bundle contains no development code: no module under src/dev, none of their text", async () => {
    const release = await bundle("release");
    for (const [path, bytes] of devSources(release)) expect(bytes, `${path} in the release bundle`).toBe(0);
    for (const text of DEV_ONLY_TEXT) expect(release.text, text).not.toContain(text);
    // The constant itself is replaced everywhere; no reference to it (or to the dev classes) survives.
    expect(release.text).not.toContain("__MTEK_DEV__");
    for (const name of ["DevOverlay", "DevTools", "GpuTimer", "FrameStats", "panelLines", "hasTimestampQuery", "TIMESTAMP_FEATURE"]) expect(release.text, name).not.toContain(name);
  });

  it("the release bundle still has the runtime: frustum culling and the counters", async () => {
    const release = await bundle("release");
    expect(release.text).toContain("extractFrustumPlanes");
    expect(release.text).toContain("culledObjects");
    expect(release.text).toContain("drawCalls");
  });
});

/**
 * Skeletal animation is a module of its own (decision 0225): the sources only the skeletal player and the host
 * animation API reach. A program without a skinned mesh must not pay for a byte of them.
 */
const SKELETAL_SOURCES = [
  "src/scene/skeleton.ts",
  "src/scene/pose-layers.ts",
  "src/scene/pose-schedule.ts",
  "src/scene/ik.ts",
  "src/scene/limb-ik.ts",
  "src/scene/blend-space.ts",
  "src/scene/locomotion.ts",
  "src/scene/humanoid.ts",
  "src/scene/humanoid-rig.ts",
  "src/scene/humanoid-retarget.ts",
  "src/scene/retarget.ts",
  "src/scene/animation-script.ts",
  "src/animation.ts",
] as const;

/** The release `runtime.min.js` of games without skins was 689,466 bytes before composable animation (decisions 0219 to 0223). */
const CORE_MIN_LIMIT = 689_466 + 6_000;

const bytesOf = (built: Built, path: string): number => built.bytesBySource.get(path) ?? 0;

describe("the animation module", () => {
  it("the core runtime contains no skeletal animation code, in any flavour", async () => {
    for (const flavour of ["release", "dev", "min"] as const) {
      const core = await bundle(flavour);
      for (const path of SKELETAL_SOURCES) expect(bytesOf(core, path), `${path} in the ${flavour} core`).toBe(0);
      // The skeleton validation the mount runs stays; it is not skeletal playback.
      expect(bytesOf(core, "src/scene/skin-problem.ts"), `skin-problem in the ${flavour} core`).toBeGreaterThan(0);
    }
  });

  it("the animation module contains the skeletal player and what it composes", async () => {
    for (const flavour of ["animation", "animationMin"] as const) {
      const module = await bundle(flavour);
      for (const path of ["src/scene/skeleton.ts", "src/scene/pose-layers.ts", "src/scene/ik.ts", "src/scene/limb-ik.ts", "src/scene/blend-space.ts", "src/scene/humanoid-retarget.ts", "src/scene/animation-script.ts"]) {
        expect(bytesOf(module, path), `${path} in ${flavour}`).toBeGreaterThan(0);
      }
      // No development code, no renderer, no host: only animation.
      expect([...module.bytesBySource].filter(([path, bytes]) => bytes > 0 && (path.startsWith("src/dev/") || path.startsWith("src/render/") || path.startsWith("src/host/")))).toEqual([]);
    }
  });

  it("the npm entry keeps the host animation API: the full bundle has both the core and the skeletal code", async () => {
    const full = await bundle("full");
    expect(bytesOf(full, "src/scene/skeleton.ts")).toBeGreaterThan(0);
    expect(bytesOf(full, "src/animation.ts")).toBeGreaterThan(0);
    expect(bytesOf(full, "src/host/mount.ts")).toBeGreaterThan(0);
    for (const name of ["createAnimationController", "retargetSkin", "mapHumanoid", "retargetHumanoid", "deformSkin"]) expect(full.text, name).toContain(name);
  });

  it(`the minified core stays within ${String(CORE_MIN_LIMIT)} bytes, so games without skins stay inside their size budgets`, async () => {
    const min = await bundle("min");
    expect(Buffer.byteLength(min.text)).toBeLessThanOrEqual(CORE_MIN_LIMIT);
  });
});
