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
    expect(FLAVOURS.release.outfile).toBe("dist/runtime.js");
    expect(FLAVOURS.dev.outfile).toBe("dist/runtime.dev.js");
    expect(FLAVOURS.min.outfile).toBe("dist/runtime.min.js");
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
