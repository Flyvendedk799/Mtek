// Tests of the small utilities: PNG, JSON output, picture comparison, host load, the GPU lock.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { busyPercent, waitForQuiet } from "./host-load.ts";
import { withGpuLock } from "./gpu-lock.ts";
import { roundTimings, roundTo, stringifyCompact } from "./json.ts";
import { CHANNEL_TOLERANCE, MAX_DIFFERING_SHARE, comparePictures } from "./parity.ts";
import { decodePng, encodePng } from "./png.ts";

describe("png", () => {
  it("round-trips RGBA pixels exactly", () => {
    const rgba = Uint8Array.from({ length: 5 * 3 * 4 }, (_, i) => (i * 37) % 256);
    const decoded = decodePng(encodePng(5, 3, rgba));
    expect(decoded.width).toBe(5);
    expect(decoded.height).toBe(3);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it("refuses what it did not write", () => {
    expect(() => decodePng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow("not a PNG");
  });
});

describe("json output", () => {
  it("keeps arrays of numbers on one line and everything else indented", () => {
    const text = stringifyCompact({ name: "x", samples: [1.5, 2, 3], nested: { list: [null, 4] }, words: ["a", "b"] });
    expect(text).toContain('"samples": [1.5,2,3]');
    expect(text).toContain('"list": [null,4]');
    expect(text).toContain('"words": [\n');
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({ name: "x", samples: [1.5, 2, 3], nested: { list: [null, 4] }, words: ["a", "b"] });
  });

  it("rounds timings to microseconds and leaves other numbers alone", () => {
    expect(roundTo(1.23456789, 3)).toBe(1.235);
    expect(roundTimings({ cpuMs: [1.00049, 2.0005], count: 1.23456, nested: { startupMs: 1.23456 } })).toEqual({
      cpuMs: [1, 2.001],
      count: 1.23456,
      nested: { startupMs: 1.235 },
    });
  });
});

describe("comparePictures", () => {
  const picture = (fill: (p: number) => [number, number, number]): Uint8Array => {
    const out = new Uint8Array(100 * 100 * 4);
    for (let p = 0; p < 10_000; p += 1) out.set([...fill(p), 255], p * 4);
    return out;
  };
  const scene = picture((p) => (p % 100 < 50 ? [16, 24, 32] : [200, 100, 50]));

  it("identical pictures agree exactly", () => {
    expect(comparePictures(scene, scene)).toMatchObject({ differingPixels: 0, maxChannelDifference: 0, sameScene: true, referenceDrawnShare: 0.5 });
  });

  it("small channel differences below the tolerance do not count", () => {
    const near = picture((p) => (p % 100 < 50 ? [16, 24, 32] : [200 + CHANNEL_TOLERANCE, 100, 50]));
    const result = comparePictures(scene, near);
    expect(result.differingPixels).toBe(0);
    expect(result.maxChannelDifference).toBe(CHANNEL_TOLERANCE);
    expect(result.sameScene).toBe(true);
  });

  it("a different scene is detected, and so is a blank picture compared with itself", () => {
    const other = picture((p) => (p % 100 < 50 ? [200, 100, 50] : [16, 24, 32]));
    expect(comparePictures(scene, other).sameScene).toBe(false);
    const blank = picture(() => [16, 24, 32]);
    expect(comparePictures(blank, blank)).toMatchObject({ differingPixels: 0, referenceDrawnShare: 0, sameScene: false });
  });

  it("tolerates a few differing edge pixels, but not more than the allowed share", () => {
    const edge = picture((p) => (p % 100 < 50 ? [16, 24, 32] : p < 40 ? [255, 255, 255] : [200, 100, 50]));
    const few = comparePictures(scene, edge);
    expect(few.differingShare).toBeLessThanOrEqual(MAX_DIFFERING_SHARE);
    expect(few.sameScene).toBe(true);
    const many = picture((p) => (p % 100 < 50 ? [16, 24, 32] : p < 2000 ? [255, 255, 255] : [200, 100, 50]));
    expect(comparePictures(scene, many).sameScene).toBe(false);
  });

  it("refuses pictures of different sizes", () => {
    expect(() => comparePictures(new Uint8Array(8), new Uint8Array(12))).toThrow(/differ in size/);
  });
});

describe("host load", () => {
  it("computes the busy share between two readings", () => {
    expect(busyPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 })).toBe(50);
    expect(busyPercent({ idle: 0, total: 0 }, { idle: 0, total: 0 })).toBe(0);
  });

  it("waits no longer than asked and reports a noisy machine instead of pretending it was quiet", async () => {
    const result = await waitForQuiet(-1, 10);
    expect(result.noisy).toBe(true);
    expect(result.waitedForQuietMs).toBeGreaterThanOrEqual(0);
  });
});

describe("the GPU lock", () => {
  const scratch = mkdtempSync(join(tmpdir(), "mtek-lock-"));
  const lock = join(scratch, "gpu.lock");
  const previous = process.env["MTEK_GPU_LOCK_DIR"];
  afterEach(() => {
    if (previous === undefined) delete process.env["MTEK_GPU_LOCK_DIR"];
    else process.env["MTEK_GPU_LOCK_DIR"] = previous;
  });

  it("runs without a lock when none is configured", async () => {
    delete process.env["MTEK_GPU_LOCK_DIR"];
    expect(await withGpuLock((outcome) => Promise.resolve(outcome))).toEqual({ dir: null, waitedMs: 0 });
  });

  it("holds the directory during the job and removes it afterwards, also when the job throws", async () => {
    process.env["MTEK_GPU_LOCK_DIR"] = lock;
    await withGpuLock(() => {
      expect(existsSync(lock)).toBe(true);
      return Promise.resolve();
    });
    expect(existsSync(lock)).toBe(false);
    await expect(withGpuLock(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(existsSync(lock)).toBe(false);
  });

  it("waits for a lock that exists and gives up after the timeout without removing someone else's lock", async () => {
    process.env["MTEK_GPU_LOCK_DIR"] = lock;
    let inner = false;
    await withGpuLock(async () => {
      await expect(withGpuLock(() => Promise.resolve((inner = true)), { timeoutMs: 60, pollMs: 10 })).rejects.toThrow(/was not released/);
      expect(existsSync(lock)).toBe(true);
    });
    expect(inner).toBe(false);
    expect(existsSync(lock)).toBe(false);
    rmSync(scratch, { recursive: true, force: true });
  });
});
