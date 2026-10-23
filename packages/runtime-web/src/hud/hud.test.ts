import { describe, expect, it } from "vitest";

import type { MtekManifest } from "../abi/manifest-types.js";
import type { MtekDiagnostic } from "../diagnostics/types.js";
import { FakeDocument, type FakeElement } from "../test-support/fake-host.js";
import { cssColor, HudSystem, MAX_HUD_ITEMS } from "./hud.js";
import { pixelTextImage } from "./pixel-font.js";

function setup(): {
  hud: HudSystem;
  layer: () => FakeElement | undefined;
  reports: MtekDiagnostic[];
} {
  const document = new FakeDocument();
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  canvas.offsetWidth = 800;
  canvas.offsetHeight = 600;
  const reports: MtekDiagnostic[] = [];
  const hud = new HudSystem({
    canvas: canvas,
    document: document,
    manifest: { spans: [] } as unknown as MtekManifest,
    report: (d) => reports.push(d),
  });
  return { hud, layer: () => document.body.find("data-mtek-hud"), reports };
}

const white = { r: 1, g: 1, b: 1, a: 1 };

describe("HudSystem (decision 0134)", () => {
  it("shows the frame's text after the canvas and reuses the element", () => {
    const { hud, layer } = setup();
    hud.beginFrame();
    hud.text(0, "Score: 3", { x: -1, y: 1 }, 32, white, 0);
    hud.present();
    const label = layer()?.children[0];
    expect(label?.textContent).toBe("Score: 3");
    expect(label?.style.left).toBe("0%");
    expect(label?.style.top).toBe("0%");
    expect(label?.style.fontSize).toBe("32px");
    expect(label?.style.transform).toBe("translate(0%,-50%)");
    hud.beginFrame();
    hud.text(0, "Score: 4", { x: -1, y: 1 }, 32, white, 0);
    hud.present();
    expect(layer()?.children[0]).toBe(label);
    expect(label?.textContent).toBe("Score: 4");
  });

  it("removes what a frame no longer draws", () => {
    const { hud, layer } = setup();
    hud.beginFrame();
    hud.text(0, "a", { x: 0, y: 0 });
    hud.rect(0, { x: 0, y: 0 }, { x: 100, y: 10 }, white);
    hud.present();
    expect(layer()?.children.length).toBe(2);
    hud.beginFrame();
    hud.present();
    expect(layer()?.children.length).toBe(0);
  });

  it("reports a click once, in the next frame, by label and order", () => {
    const { hud, layer } = setup();
    hud.beginFrame();
    expect(hud.button(0, "Play", { x: 0, y: 0 })).toBe(false);
    hud.present();
    const button = layer()?.children[0];
    button?.dispatch("click");
    hud.beginFrame();
    expect(hud.button(0, "Play", { x: 0, y: 0 })).toBe(true);
    hud.present();
    hud.beginFrame();
    expect(hud.button(0, "Play", { x: 0, y: 0 })).toBe(false);
    hud.present();
  });

  it("drops a click no button claims", () => {
    const { hud, layer } = setup();
    hud.beginFrame();
    hud.button(0, "Play", { x: 0, y: 0 });
    hud.present();
    layer()?.children[0]?.dispatch("click");
    hud.beginFrame();
    hud.present();
    hud.beginFrame();
    expect(hud.button(0, "Play", { x: 0, y: 0 })).toBe(false);
  });

  it("caps the items of a frame with W8203 once per call site", () => {
    const { hud, layer, reports } = setup();
    hud.beginFrame();
    for (let i = 0; i < MAX_HUD_ITEMS + 10; i++)
      hud.text(7, "x", { x: 0, y: 0 });
    hud.present();
    expect(layer()?.children.length).toBe(MAX_HUD_ITEMS);
    expect(reports.map((r) => r.code)).toEqual(["MTEK-W8203"]);
  });

  it("clamps sizes and converts linear colours to sRGB", () => {
    const { hud, layer } = setup();
    hud.beginFrame();
    hud.text(0, "big", { x: 0, y: 0 }, 9999);
    hud.present();
    expect(layer()?.children[0]?.style.fontSize).toBe("512px");
    expect(cssColor({ r: 0, g: 1, b: 0.2158605, a: 0.5 })).toBe(
      "rgba(0,255,128,0.5)",
    );
  });

  it("removes the layer on dispose", () => {
    const { hud, layer } = setup();
    hud.beginFrame();
    hud.text(0, "a", { x: 0, y: 0 });
    hud.present();
    hud.dispose();
    expect(layer()).toBeUndefined();
  });
});

describe("HudSystem across a scene change (decision 0176)", () => {
  it("drops a click nobody claimed when the scene changes, so a same-labelled button of the next scene is not pressed", () => {
    const { hud, layer } = setup();
    hud.beginFrame();
    hud.button(0, "Play", { x: 0, y: 0 });
    hud.present();
    layer()?.children[0]?.dispatch("click");
    hud.clearClicks();
    hud.beginFrame();
    expect(hud.button(0, "Play", { x: 0, y: 0 })).toBe(false);
    hud.present();
  });

  it("resolves the span of W8203 against the manifest of the scene that runs", () => {
    const document = new FakeDocument();
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const sourced = (path: string): MtekManifest =>
      ({
        spans: [
          { file: 0, start: 0, end: 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
          { file: 0, start: 2, end: 3, startLine: 1, startColumn: 3, endLine: 1, endColumn: 4 },
        ],
        sources: [{ id: 0, path }],
      }) as unknown as MtekManifest;
    let current = sourced("src/first.mtek");
    const reports: MtekDiagnostic[] = [];
    const hud = new HudSystem({ canvas, document, manifest: current, manifestNow: () => current, report: (d) => reports.push(d) });
    const overflow = (): void => {
      hud.beginFrame();
      for (let i = 0; i <= MAX_HUD_ITEMS; i += 1) hud.text(0, "x", { x: 0, y: 0 });
    };
    overflow();
    current = sourced("src/second.mtek");
    // The same call site (span 0) warns once per site; a second site shows the new manifest.
    hud.beginFrame();
    for (let i = 0; i <= MAX_HUD_ITEMS; i += 1) hud.text(1, "x", { x: 0, y: 0 });
    expect(reports.map((r) => r.source?.file)).toEqual(["src/first.mtek", "src/second.mtek"]);
  });

  it("builds the SVG of a pixel-font line once per text and colour", () => {
    const first = pixelTextImage("Score: 12", "rgba(255,255,255,1)");
    expect(pixelTextImage("Score: 12", "rgba(255,255,255,1)")).toBe(first);
    expect(pixelTextImage("Score: 13", "rgba(255,255,255,1)")).not.toBe(first);
    expect(pixelTextImage("Score: 12", "rgba(0,0,0,1)")).not.toBe(first);
    expect(first.width).toBe(9 * 6 - 1);
    expect(first.url.startsWith('url("data:image/svg+xml,')).toBe(true);
  });
});
