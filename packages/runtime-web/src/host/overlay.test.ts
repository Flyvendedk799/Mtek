import { describe, expect, it } from "vitest";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import { FakeCanvas, FakeDocument, FakeElement, asDom } from "../test-support/fake-host.js";
import { FailureOverlay, MAX_OVERLAY_DIAGNOSTICS, formatLocation } from "./overlay.js";

function setup(): { doc: FakeDocument; canvas: FakeCanvas; make: () => FailureOverlay } {
  const doc = new FakeDocument();
  const canvas = new FakeCanvas(doc);
  canvas.offsetLeft = 10;
  canvas.offsetTop = 20;
  canvas.offsetWidth = 300;
  canvas.offsetHeight = 150;
  return { doc, canvas, make: () => new FailureOverlay(asDom<HTMLCanvasElement>(canvas)) };
}

function diagnostic(over: Partial<Parameters<typeof makeRuntimeDiagnostic>[1]> = {}): MtekDiagnostic {
  return makeRuntimeDiagnostic("E8051", { phase: "runtime:mount", message: "Shader failed.", ...over });
}

function rootOf(doc: FakeDocument): FakeElement {
  const root = doc.body.find("data-mtek-overlay");
  if (root === undefined) throw new Error("no overlay in the document");
  return root;
}

describe("FailureOverlay", () => {
  it("is absent until something is shown", () => {
    const { doc, make } = setup();
    const overlay = make();
    expect(overlay.element).toBeNull();
    expect(doc.body.find("data-mtek-overlay")).toBeUndefined();
  });

  it("lists code, title, message and notes of each diagnostic in an accessible alert", () => {
    const { doc, make } = setup();
    const overlay = make();
    overlay.show([
      diagnostic({ message: "Shader 'Unlit' failed to compile: unexpected token", notes: ["WGSL location: shaders/a.wgsl:2:16"] }),
      makeRuntimeDiagnostic("E8005", { phase: "runtime:mount", message: "No suitable GPU adapter was found." }),
    ]);
    const root = rootOf(doc);
    expect(root.getAttribute("role")).toBe("alert");
    expect(root.getAttribute("aria-live")).toBe("assertive");
    const text = root.textContent;
    expect(text).toContain("MTEK-E8051: shader or pipeline creation failed");
    expect(text).toContain("Shader 'Unlit' failed to compile: unexpected token");
    expect(text).toContain("WGSL location: shaders/a.wgsl:2:16");
    expect(text).toContain("MTEK-E8005: no suitable adapter");
    expect(root.children.filter((c) => c.getAttribute("data-mtek-diagnostic") !== null).map((c) => c.getAttribute("data-mtek-diagnostic"))).toEqual([
      "MTEK-E8051",
      "MTEK-E8005",
    ]);
  });

  it("shows file:line:column of the span start", () => {
    const resolved = { file: "src/main.mtek", startByte: 420, endByte: 439, startLine: 18, startColumn: 16, endLine: 18, endColumn: 35 };
    expect(formatLocation(resolved)).toBe("src/main.mtek:18:16");

    const { doc, make } = setup();
    make().show([diagnostic({ source: resolved })]);
    expect(doc.body.find("data-mtek-location")?.textContent).toBe("src/main.mtek:18:16");
  });

  it("shows no location line for a diagnostic without a source", () => {
    const { doc, make } = setup();
    make().show([diagnostic()]);
    expect(doc.body.find("data-mtek-location")).toBeUndefined();
  });

  it("sets browser-provided text as text, never as markup", () => {
    const { doc, make } = setup();
    const hostile = '<img src=x onerror="alert(1)"> & <script>';
    make().show([diagnostic({ message: hostile })]);
    // The fake DOM has no HTML parser: text assigned through textContent stays one text node.
    expect(rootOf(doc).textContent).toContain(hostile);
    expect(rootOf(doc).children.some((c) => c.tagName === "img")).toBe(false);
  });

  it("is positioned over the canvas and follows it after reposition()", () => {
    const { doc, canvas, make } = setup();
    const overlay = make();
    overlay.show([diagnostic()]);
    const root = rootOf(doc);
    expect(root.style["cssText"]).toContain("position:absolute");
    expect([root.style["left"], root.style["top"], root.style["width"], root.style["height"]]).toEqual(["10px", "20px", "300px", "150px"]);
    canvas.offsetWidth = 640;
    canvas.offsetLeft = 0;
    overlay.reposition();
    expect([root.style["left"], root.style["width"]]).toEqual(["0px", "640px"]);
  });

  it("is inserted right after the canvas in its parent, else into the body", () => {
    const { doc, canvas, make } = setup();
    const parent = doc.createElement("div");
    const sibling = doc.createElement("p");
    parent.append(canvas, sibling);
    make().show([diagnostic()]);
    expect(parent.children.map((c) => c.tagName)).toEqual(["canvas", "div", "p"]);
    expect(parent.children[1]?.getAttribute("data-mtek-overlay")).toBe("");
  });

  it("add() appends and show() replaces", () => {
    const { doc, make } = setup();
    const overlay = make();
    overlay.show([diagnostic({ message: "first" })]);
    overlay.add(makeRuntimeDiagnostic("E8050", { phase: "runtime:render", message: "second" }));
    expect(rootOf(doc).textContent).toContain("first");
    expect(rootOf(doc).textContent).toContain("second");
    overlay.show([diagnostic({ message: "only this" })]);
    expect(rootOf(doc).textContent).not.toContain("second");
    expect(rootOf(doc).textContent).toContain("only this");
  });

  it("lists at most MAX_OVERLAY_DIAGNOSTICS and summarises the rest", () => {
    const { doc, make } = setup();
    const many = Array.from({ length: MAX_OVERLAY_DIAGNOSTICS + 5 }, (_, i) => diagnostic({ message: `problem ${String(i)}` }));
    make().show(many);
    const sections = rootOf(doc).children.filter((c) => c.getAttribute("data-mtek-diagnostic") !== null);
    expect(sections).toHaveLength(MAX_OVERLAY_DIAGNOSTICS);
    expect(rootOf(doc).textContent).toContain("... and 5 more diagnostics");
  });

  it("remove() takes the panel out of the DOM and is idempotent", () => {
    const { doc, make } = setup();
    const overlay = make();
    overlay.show([diagnostic()]);
    overlay.remove();
    overlay.remove();
    expect(doc.body.find("data-mtek-overlay")).toBeUndefined();
    expect(overlay.element).toBeNull();
  });

  it("a new overlay for the same canvas removes the earlier one", () => {
    const { doc, canvas, make } = setup();
    make().show([diagnostic({ message: "old" })]);
    const second = make();
    expect(doc.body.find("data-mtek-overlay")).toBeUndefined();
    second.show([diagnostic({ message: "new" })]);
    expect(rootOf(doc).textContent).toContain("new");
    expect(rootOf(doc).textContent).not.toContain("old");
    FailureOverlay.removeFor(asDom<HTMLCanvasElement>(canvas));
    expect(doc.body.find("data-mtek-overlay")).toBeUndefined();
  });
});
