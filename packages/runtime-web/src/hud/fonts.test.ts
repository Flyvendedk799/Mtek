import { describe, expect, it } from "vitest";

import type { MtekManifest } from "../abi/manifest-types.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { FakeDocument } from "../test-support/fake-host.js";
import { FontRegistry, type FontPage } from "./fonts.js";
import { HudSystem } from "./hud.js";
import { glyphColumns, PIXEL_FONT, pixelTextSvg } from "./pixel-font.js";

const manifest = {
  spans: [{ file: 0, start: 0, end: 4, startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 }],
  sources: [{ id: 0, path: "src/main.mtek" }],
  assets: [
    { url: "assets/a.ttf", sha256: "0123456789abcdef".repeat(4), bytes: 4, kind: "font", format: "ttf", mime: "font/ttf", source: "fonts/a.ttf", span: 0 },
  ],
} as unknown as MtekManifest;

function page(fail = false): FontPage & { added: string[] } {
  const added: string[] = [];
  return {
    added,
    createFace: (family) => ({ family, load: () => (fail ? Promise.reject(new Error("bad")) : Promise.resolve()) }),
    add: (face) => added.push((face as { family: string }).family),
  };
}

describe("fonts (decision 0139)", () => {
  it("registers a declared font once, under a family named by its hash", () => {
    const fonts = page();
    const registry = new FontRegistry({ manifest, bytes: () => new Uint8Array(4), page: fonts, report: () => undefined });
    expect(registry.family("fonts/a.ttf")).toBe("mtek-font-0123456789ab");
    expect(registry.family("fonts/a.ttf")).toBe("mtek-font-0123456789ab");
    expect(fonts.added).toEqual(["mtek-font-0123456789ab"]);
    expect(registry.family("fonts/missing.ttf")).toBeUndefined();
  });

  it("W8204: a font the browser rejects falls back to the default family, reported once", async () => {
    const reports: MtekDiagnostic[] = [];
    const registry = new FontRegistry({ manifest, bytes: () => new Uint8Array(4), page: page(true), report: (d) => reports.push(d) });
    expect(registry.family("fonts/a.ttf")).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reports.map((d) => d.code)).toEqual(["MTEK-W8204"]);
    expect(registry.family("fonts/a.ttf")).toBeUndefined();
  });

  it("hud.text uses the registered family, and the pixel font as an SVG", () => {
    const document = new FakeDocument();
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const hud = new HudSystem({ canvas, document, manifest, report: () => undefined, fontFamily: (source) => (source === "fonts/a.ttf" ? "mtek-font-x" : undefined) });
    hud.beginFrame();
    hud.text(0, "Title", { x: 0, y: 0 }, 32, { r: 1, g: 1, b: 1, a: 1 }, 0.5, "fonts/a.ttf");
    hud.text(0, "HI", { x: 0, y: 0 }, 16, { r: 1, g: 1, b: 1, a: 1 }, 0.5, hud.pixel_font());
    hud.present();
    const [title, pixel] = document.body.find("data-mtek-hud")?.children ?? [];
    expect(title?.style.fontFamily).toMatch(/^"mtek-font-x",/);
    expect(title?.textContent).toBe("Title");
    expect(pixel?.textContent).toBe("");
    expect(pixel?.style.backgroundImage).toMatch(/^url\("data:image\/svg\+xml,/);
    // Two characters are 11 cells wide and 8 tall; 16 px tall is a scale of 2.
    expect(pixel?.style.width).toBe("22px");
    expect(pixel?.style.height).toBe("16px");
  });

  it("the pixel font covers printable ASCII and draws a box for anything else", () => {
    expect(glyphColumns("A")).toEqual([0x7c, 0x12, 0x11, 0x12, 0x7c]);
    expect(glyphColumns(" ")).toEqual([0, 0, 0, 0, 0]);
    expect(glyphColumns("é")).toEqual([0x7f, 0x41, 0x41, 0x41, 0x7f]);
    expect(pixelTextSvg("", "#fff").width).toBe(1);
    expect(PIXEL_FONT).toBe("mtek:pixel-font");
  });
});

describe("FontRegistry across a scene change (decision 0176)", () => {
  it("looks a font up in the manifest of the scene that runs", () => {
    const empty = { ...manifest, assets: [] } as unknown as MtekManifest;
    let current = empty;
    const fonts = new FontRegistry({ manifest: empty, manifestNow: () => current, bytes: () => new Uint8Array(4), page: page(), report: () => undefined });
    expect(fonts.family("fonts/a.ttf")).toBeUndefined();
    current = manifest;
    // The first answer stays: `undefined` is remembered per source, like any unusable font.
    expect(fonts.family("fonts/a.ttf")).toBeUndefined();
    const second = new FontRegistry({ manifest: empty, manifestNow: () => current, bytes: () => new Uint8Array(4), page: page(), report: () => undefined });
    expect(second.family("fonts/a.ttf")).toMatch(/^mtek-font-/);
  });
});
