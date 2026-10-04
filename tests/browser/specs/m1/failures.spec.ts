// M1 exit gate (task M1-21): failures are visible rather than an empty page (spec/testing.md section 6.7).
// Each case mounts a program built by the CLI through its own test page (`window.__mtekMount` with the
// default `failureDisplay: "overlay"`) and asserts the documented rejection `kind`, the diagnostic, and
// an overlay that is visible over the canvas and names the code.
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { FIXTURE_A, VARIANT_ABI_99, VARIANT_BAD_SHADER, readBuiltManifest } from "../../support/m1-fixtures.ts";
import { mountExpectingFailure, type MountFailure } from "./support.ts";

/** The overlay is in the DOM, visible, an alert, and covers the canvas it reports for. */
async function expectVisibleOverlay(page: Page, failure: MountFailure, code: string): Promise<void> {
  expect(failure.overlayRole).toBe("alert");
  expect(failure.overlayText).toContain(code);
  const overlay = page.locator("[data-mtek-overlay]");
  await expect(overlay).toHaveCount(1);
  await expect(overlay).toBeVisible();
  await expect(overlay.locator(`[data-mtek-diagnostic="${code}"]`)).toBeVisible();
  const overlayBox = await overlay.boundingBox();
  const canvasBox = await page.locator("canvas#mtek").boundingBox();
  if (overlayBox === null || canvasBox === null) throw new Error("overlay or canvas has no layout box");
  expect(canvasBox.width * canvasBox.height).toBeGreaterThan(0);
  for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(overlayBox[key] - canvasBox[key]), key).toBeLessThanOrEqual(1);
}

function asFailure(result: MountFailure | "mounted"): MountFailure {
  if (result === "mounted") throw new Error("the mount resolved; it must reject");
  return result;
}

interface ManifestShape {
  sources: Array<{ id: number; path: string }>;
  spans: Array<{ file: number; start: number; end: number; startLine: number; startColumn: number }>;
  symbols: Array<{ id: string; kind: string; span: number }>;
  shaders: Array<{ material: string }>;
}

test.describe("M1 failures are visible (spec/testing.md section 6.7)", () => {
  test("a program whose manifest declares runtimeAbi 99 rejects with incompatible-program (E8003) and shows the overlay", async ({ page }) => {
    const failure = asFailure(await mountExpectingFailure(page, VARIANT_ABI_99));
    expect(failure.errorName).toBe("MtekMountError");
    expect(failure.kind).toBe("incompatible-program");
    expect(failure.diagnostics[0]?.code).toBe("MTEK-E8003");
    expect(failure.diagnostics[0]?.message).toContain("99");
    expect(failure.reported.map((d) => d.code)).toContain("MTEK-E8003");
    await expectVisibleOverlay(page, failure, "MTEK-E8003");
  });

  test("a corrupted shader file rejects with shader-failed (E8051) and the overlay names the material declaration", async ({ page, gpu }) => {
    void gpu;
    const failure = asFailure(await mountExpectingFailure(page, VARIANT_BAD_SHADER));
    expect(failure.kind).toBe("shader-failed");
    const first = failure.diagnostics[0];
    expect(first?.code).toBe("MTEK-E8051");

    // The material declaration, as the built manifest records it (symbol -> span -> source file).
    const manifest = readBuiltManifest(VARIANT_BAD_SHADER) as unknown as ManifestShape;
    const materialId = manifest.shaders[0]?.material ?? "";
    const symbol = manifest.symbols.find((s) => s.kind === "material" && s.id === materialId);
    const span = symbol === undefined ? undefined : manifest.spans[symbol.span];
    const file = manifest.sources.find((s) => s.id === span?.file)?.path;
    if (span === undefined || file === undefined) throw new Error(`no declaration span for material ${materialId}`);
    expect(first?.message).toContain(`'${materialId}'`);
    expect(first?.source).toMatchObject({ file, startByte: span.start, endByte: span.end, startLine: span.startLine, startColumn: span.startColumn });

    const location = `${file}:${String(span.startLine)}:${String(span.startColumn)}`;
    expect(failure.overlayText).toContain(materialId);
    expect(failure.overlayText).toContain(location);
    await expect(page.locator('[data-mtek-diagnostic="MTEK-E8051"] [data-mtek-location]').first()).toHaveText(location);
    await expectVisibleOverlay(page, failure, "MTEK-E8051");
  });

  test("a browser without WebGPU rejects with webgpu-unavailable (E8004) and shows the overlay", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true });
    });
    const failure = asFailure(await mountExpectingFailure(page, FIXTURE_A));
    expect(await page.evaluate(() => (navigator as Navigator & { gpu?: unknown }).gpu === undefined)).toBe(true);
    expect(failure.kind).toBe("webgpu-unavailable");
    expect(failure.diagnostics[0]?.code).toBe("MTEK-E8004");
    await expectVisibleOverlay(page, failure, "MTEK-E8004");
  });
});
