// M2 exit gate, criterion 4 (task M2-12): browser shader failures identify the originating Mtek declaration.
// Global setup builds `fixtures/m2/pulse` and derives two test-only post-build corruptions of its WGSL:
//   - `bad-shader`: a line that is not WGSL is appended (no span-map entry covers it), so the diagnostic
//     falls back to the material declaration;
//   - `bad-call`: the call of the built-in `sin` inside the Mtek function `pulse` is misspelled, so the browser
//     reports a position inside a mapped expression and the diagnostic names that expression in the Mtek source.
// In both, `mountMtek` rejects with `shader-failed` (E8051), nothing is left running, and the overlay names
// the declaration's file and line (spec/runtime-abi.md sections 5.4 and 12).
import type { Page } from "@playwright/test";
import { expect, test } from "../../support/fixtures.ts";
import { PULSE, VARIANT_BAD_CALL, VARIANT_BAD_SHADER, m2Source, readBuiltM2Manifest } from "../../support/m2-fixtures.ts";
import { mountExpectingFailure, type MountFailure } from "./support.ts";

interface ManifestShape {
  sources: Array<{ id: number; path: string }>;
  spans: Array<{ file: number; start: number; end: number; startLine: number; startColumn: number; endLine: number; endColumn: number }>;
  symbols: Array<{ id: string; kind: string; span: number }>;
  shaders: Array<{ material: string; url: string }>;
}

function asFailure(result: MountFailure | "mounted"): MountFailure {
  if (result === "mounted") throw new Error("the mount resolved; it must reject");
  return result;
}

/** 1-based line and column of a byte offset in `text` (ASCII sources). */
function lineColumn(text: string, byte: number): { line: number; column: number } {
  const lines = text.slice(0, byte).split("\n");
  return { line: lines.length, column: (lines.at(-1) ?? "").length + 1 };
}

/** The material declaration as the built manifest records it (symbol -> span -> source file). */
function declarationOf(variant: string): { id: string; file: string; span: ManifestShape["spans"][number] } {
  const manifest = readBuiltM2Manifest(variant) as unknown as ManifestShape;
  const id = manifest.shaders[0]?.material ?? "";
  const symbol = manifest.symbols.find((s) => s.kind === "material" && s.id === id);
  const span = symbol === undefined ? undefined : manifest.spans[symbol.span];
  const file = manifest.sources.find((s) => s.id === span?.file)?.path;
  if (span === undefined || file === undefined) throw new Error(`no declaration span for material ${id}`);
  return { id, file, span };
}

async function expectOverlayNames(page: Page, text: string): Promise<void> {
  const overlay = page.locator("[data-mtek-overlay]");
  await expect(overlay).toHaveCount(1);
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('[data-mtek-diagnostic="MTEK-E8051"]')).toBeVisible();
  await expect(overlay).toContainText(text);
}

test.describe("M2 browser shader failures name the originating Mtek declaration", () => {
  test("a corrupted shader file (no mapped position) rejects with shader-failed and names the material declaration: file, line", async ({ page, gpu }) => {
    void gpu;
    const failure = asFailure(await mountExpectingFailure(page, VARIANT_BAD_SHADER));
    expect(failure.errorName).toBe("MtekMountError");
    expect(failure.kind).toBe("shader-failed");
    expect(failure.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8051"]);
    const first = failure.diagnostics[0];

    const { id, file, span } = declarationOf(VARIANT_BAD_SHADER);
    // The declaration is `material Pulse {` of the fixture source; its line is not guessed but read from the source.
    const text = m2Source(PULSE);
    const declared = lineColumn(text, span.start);
    expect(text.split("\n")[declared.line - 1]).toContain("material Pulse");
    expect(first?.message).toContain(`'${id}'`);
    expect(first?.source).toMatchObject({ file, startByte: span.start, endByte: span.end, startLine: declared.line, startColumn: declared.column });
    expect(first?.notes.some((note) => note.startsWith("WGSL location: "))).toBe(true);

    const location = `${file}:${String(declared.line)}:${String(declared.column)}`;
    expect(failure.overlayText).toContain(location);
    await expectOverlayNames(page, location);
    expect(failure.reported.map((d) => d.code)).toContain("MTEK-E8051");
  });

  test("a misspelled built-in inside the Mtek function pulse rejects with shader-failed and names that expression of the Mtek source", async ({ page, gpu }) => {
    void gpu;
    const failure = asFailure(await mountExpectingFailure(page, VARIANT_BAD_CALL));
    expect(failure.kind).toBe("shader-failed");
    expect(failure.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8051"]);
    const first = failure.diagnostics[0];

    const text = m2Source(PULSE);
    const needle = "0.65 + 0.35 * sin(t)";
    const at = text.indexOf(needle);
    expect(at).toBeGreaterThan(0);
    const expression = lineColumn(text, at);
    expect(text.split("\n")[expression.line - 1]).toContain("return 0.65 + 0.35 * sin(t);");

    // The browser's position is inside a mapped expression of `pulse`, so the diagnostic is on a line of that
    // function, not on the material's declaration, and a note says which generated declaration it came from.
    expect(first?.source?.file).toBe("src/main.mtek");
    expect(first?.source?.startLine).toBe(expression.line);
    expect(first?.source?.startByte).toBeGreaterThanOrEqual(at);
    expect(first?.source?.endByte).toBeLessThanOrEqual(at + needle.length);
    expect(first?.notes.some((note) => note.startsWith("generated from "))).toBe(true);
    expect(first?.message).toContain("sinn");

    const location = `src/main.mtek:${String(expression.line)}:${String(first?.source?.startColumn ?? 0)}`;
    expect(failure.overlayText).toContain(location);
    await expectOverlayNames(page, location);
  });

  test("the uncorrupted program mounts: the failures above are caused by the corruption alone", async ({ page, gpu }) => {
    void gpu;
    expect(await mountExpectingFailure(page, PULSE)).toBe("mounted");
  });
});
