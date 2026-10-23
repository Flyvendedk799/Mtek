/**
 * The heads-up display (`spec/hud.md`, decision 0134): `hud.text`, `hud.rect` and `hud.button` draw into a list
 * that is cleared at the start of every frame and shown after the frame's updates as DOM elements in a layer over
 * the canvas. Elements are reused by position in the list, and a property is written only when it changed, so a
 * steady HUD costs no DOM writes. Text is set through `textContent`, never as HTML.
 *
 * Positions are normalised device coordinates of the canvas (x right, y up, both -1 to 1, as `PointerEvent`);
 * sizes are CSS pixels, clamped to the ranges the compiler checks constants against (`E5601`). A frame that draws
 * more than {@link MAX_HUD_ITEMS} items shows the first ones and reports `W8203` once per call site.
 *
 * A button click is queued and reported, once, by the first `hud.button` call of a later frame with the same label
 * and the same position among buttons with that label. Clicks on buttons do not reach the canvas; the layer
 * itself lets every other pointer event through.
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import {
  makeRuntimeDiagnostic,
  type MtekDiagnostic,
} from "../diagnostics/types.js";
import { resolveSpan } from "../host/failures.js";
import { CELL_HEIGHT, PIXEL_FONT, pixelTextImage } from "./pixel-font.js";

/** The ranges of `spec/hud.md` section 3; the compiler checks constants against the same numbers (E5601). */
export const TEXT_SIZE_RANGE = [1, 512] as const;
export const RECT_SIZE_RANGE = [0, 8192] as const;
/** Items shown per frame at most. */
export const MAX_HUD_ITEMS = 512;
const DEFAULT_SIZE = 24;

/** `ctx.hud`, as generated code calls it: the span of the call first, then the Mtek arguments. */
export interface HudService {
  text(
    spanId: unknown,
    content: unknown,
    at: unknown,
    size?: unknown,
    tint?: unknown,
    align?: unknown,
    font?: unknown,
  ): void;
  /** `hud.pixel_font()`: the built-in font (decision 0139). */
  pixel_font?(spanId: unknown): string;
  rect(
    spanId: unknown,
    at: unknown,
    size: unknown,
    tint: unknown,
    align?: unknown,
  ): void;
  button(spanId: unknown, label: unknown, at: unknown, size?: unknown): boolean;
  /** Phase 1 of a frame (the host calls it). */
  beginFrame?(): void;
  /** A scene change: clicks nobody claimed yet belong to the old scene's buttons and are dropped. */
  clearClicks?(): void;
  /** After the frame's updates (the host calls it). */
  present?(): void;
  /** When the application is disposed. */
  dispose?(): void;
}

/** A world without a display: draws nothing, no button is ever clicked. */
export const NO_HUD: HudService = Object.freeze({
  text: () => undefined,
  pixel_font: () => PIXEL_FONT,
  rect: () => undefined,
  button: () => false,
});

/** The DOM the HUD needs (the browser's, or a test fake). */
export interface HudElement {
  readonly style: Record<string, string> | CSSStyleDeclaration;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  addEventListener(
    type: string,
    listener: (event: {
      preventDefault?: () => void;
      stopPropagation?: () => void;
    }) => void,
  ): void;
  remove(): void;
  append(...nodes: HudElement[]): void;
  insertBefore(node: HudElement, reference: HudElement | null): unknown;
  readonly nextSibling: unknown;
  readonly parentElement: HudElement | null;
}
export interface HudCanvas {
  readonly parentElement: HudElement | null;
  readonly nextSibling: unknown;
  readonly offsetLeft: number;
  readonly offsetTop: number;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
}
export interface HudDocument {
  createElement(tag: string): HudElement;
  readonly body: HudElement;
}

export interface HudOptions {
  readonly canvas: HudCanvas;
  readonly document: HudDocument;
  readonly manifest: MtekManifest;
  /** The manifest of the scene that runs, for the spans of `W8203`; `manifest` when absent (decision 0176). */
  readonly manifestNow?: () => MtekManifest;
  readonly report: (diagnostic: MtekDiagnostic) => void;
  /**
   * The CSS family of the font file an `asset.font(..)` names by its project path (decision 0139), registered
   * with the page by the host; `undefined` while it is unknown, and the text uses the default family.
   */
  readonly fontFamily?: (source: string) => string | undefined;
}

type Item =
  | {
      readonly kind: "text";
      readonly content: string;
      readonly x: number;
      readonly y: number;
      readonly size: number;
      readonly tint: string;
      readonly align: number;
      /** "" for the default family, {@link PIXEL_FONT}, or a CSS family list. */
      readonly font: string;
    }
  | {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly tint: string;
      readonly align: number;
    }
  | {
      readonly kind: "button";
      readonly content: string;
      readonly x: number;
      readonly y: number;
      readonly size: number;
      readonly key: string;
    };

interface Shown {
  readonly kind: Item["kind"];
  readonly element: HudElement;
  /** The last written value of each style property and of the text. */
  readonly written: Map<string, string>;
}

const DEFAULT_FAMILY = "system-ui,-apple-system,'Segoe UI',sans-serif";
const TEXT_STYLE =
  "position:absolute;white-space:pre;line-height:1.2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;text-shadow:0 1px 2px rgba(0,0,0,.65);user-select:none;pointer-events:none";
const RECT_STYLE = "position:absolute;pointer-events:none";
const BUTTON_STYLE =
  "position:absolute;white-space:pre;line-height:1.2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:.3em .9em;border:1px solid rgba(255,255,255,.5);border-radius:.4em;background:rgba(0,0,0,.6);color:#fff;cursor:pointer;user-select:none;pointer-events:auto;transform:translate(-50%,-50%)";

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function linearToSrgb(c: number): number {
  const v = clamp(c, 0, 1);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** A linear `color` as a CSS `rgba(...)`; white for anything that is not a colour. */
export function cssColor(value: unknown): string {
  if (typeof value !== "object" || value === null) return "rgba(255,255,255,1)";
  const c = value as { r?: unknown; g?: unknown; b?: unknown; a?: unknown };
  const channel = (x: unknown): string =>
    String(Math.round(linearToSrgb(finite(x) ?? 1) * 255));
  const alpha = clamp(finite(c.a) ?? 1, 0, 1);
  return `rgba(${channel(c.r)},${channel(c.g)},${channel(c.b)},${String(Math.round(alpha * 1000) / 1000)})`;
}

function point(value: unknown): { x: number; y: number } {
  if (typeof value !== "object" || value === null) return { x: 0, y: 0 };
  const v = value as { x?: unknown; y?: unknown };
  return { x: finite(v.x) ?? 0, y: finite(v.y) ?? 0 };
}

/** `left`/`top` percentages of an NDC point. */
function placement(x: number, y: number): { left: string; top: string } {
  return {
    left: `${String(((x + 1) / 2) * 100)}%`,
    top: `${String(((1 - y) / 2) * 100)}%`,
  };
}

export class HudSystem implements HudService {
  private items: Item[] = [];
  private shown: Shown[] = [];
  private layer: HudElement | null = null;
  private readonly geometry = { left: -1, top: -1, width: -1, height: -1 };
  private readonly pendingClicks = new Set<string>();
  private readonly buttonKeys = new WeakMap<HudElement, string>();
  private readonly labelCounts = new Map<string, number>();
  private readonly warnedSpans = new Set<number>();
  private disposed = false;

  constructor(private readonly options: HudOptions) {}

  clearClicks(): void {
    this.pendingClicks.clear();
  }

  /** Phase 1: a new frame draws a new list. */
  beginFrame(): void {
    this.items = [];
    this.labelCounts.clear();
  }

  text(
    spanId: unknown,
    content: unknown,
    at: unknown,
    size?: unknown,
    tint?: unknown,
    align?: unknown,
    font?: unknown,
  ): void {
    const { x, y } = point(at);
    let family = "";
    if (font === PIXEL_FONT) family = PIXEL_FONT;
    else if (typeof font === "string") {
      const registered = this.options.fontFamily?.(font);
      if (registered !== undefined) family = `"${registered}",${DEFAULT_FAMILY}`;
    }
    this.push(spanId, {
      kind: "text",
      font: family,
      content: typeof content === "string" ? content : "",
      x,
      y,
      size: clamp(finite(size) ?? DEFAULT_SIZE, ...TEXT_SIZE_RANGE),
      tint: cssColor(tint),
      align: clamp(finite(align) ?? 0.5, 0, 1),
    });
  }

  /** `hud.pixel_font()` (decision 0139). */
  pixel_font(): string {
    return PIXEL_FONT;
  }

  rect(
    spanId: unknown,
    at: unknown,
    size: unknown,
    tint: unknown,
    align?: unknown,
  ): void {
    const { x, y } = point(at);
    const extent = point(size);
    this.push(spanId, {
      kind: "rect",
      x,
      y,
      width: clamp(extent.x, ...RECT_SIZE_RANGE),
      height: clamp(extent.y, ...RECT_SIZE_RANGE),
      tint: cssColor(tint),
      align: clamp(finite(align) ?? 0.5, 0, 1),
    });
  }

  button(
    spanId: unknown,
    label: unknown,
    at: unknown,
    size?: unknown,
  ): boolean {
    const content = typeof label === "string" ? label : "";
    const index = this.labelCounts.get(content) ?? 0;
    this.labelCounts.set(content, index + 1);
    const key = `${String(index)}:${content}`;
    const { x, y } = point(at);
    this.push(spanId, {
      kind: "button",
      content,
      x,
      y,
      size: clamp(finite(size) ?? DEFAULT_SIZE, ...TEXT_SIZE_RANGE),
      key,
    });
    return this.pendingClicks.delete(key);
  }

  /** After the frame's updates: the DOM shows this frame's list. Clicks no call claimed are dropped. */
  present(): void {
    if (this.disposed) return;
    this.pendingClicks.clear();
    if (this.items.length === 0 && this.layer === null) return;
    const layer = this.ensureLayer();
    this.placeLayer(layer);
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (item === undefined) continue;
      let shown = this.shown[i];
      if (shown?.kind !== item.kind) {
        shown?.element.remove();
        shown = this.create(item.kind);
        const next = this.shown[i + 1]?.element ?? null;
        layer.insertBefore(shown.element, next);
        this.shown[i] = shown;
      }
      this.update(shown, item);
    }
    for (const extra of this.shown.splice(this.items.length))
      extra.element.remove();
  }

  /** Removes the layer; later calls draw nothing. Idempotent. */
  dispose(): void {
    this.disposed = true;
    this.layer?.remove();
    this.layer = null;
    this.shown = [];
    this.items = [];
    this.pendingClicks.clear();
  }

  private push(spanId: unknown, item: Item): void {
    if (this.disposed) return;
    if (this.items.length >= MAX_HUD_ITEMS) {
      const span = typeof spanId === "number" ? spanId : -1;
      if (!this.warnedSpans.has(span)) {
        this.warnedSpans.add(span);
        this.options.report(
          makeRuntimeDiagnostic("W8203", {
            phase: "runtime:update",
            message: `This frame drew more than ${String(MAX_HUD_ITEMS)} HUD items; the rest are not shown.`,
            source: span >= 0 ? resolveSpan(this.options.manifestNow?.() ?? this.options.manifest, span) : null,
            expected: `at most ${String(MAX_HUD_ITEMS)} items per frame`,
          }),
        );
      }
      return;
    }
    this.items.push(item);
  }

  private ensureLayer(): HudElement {
    if (this.layer !== null) return this.layer;
    const { canvas, document } = this.options;
    const layer = document.createElement("div");
    layer.setAttribute("data-mtek-hud", "");
    layer.setAttribute("aria-live", "off");
    set(
      layer.style,
      "cssText",
      "position:absolute;overflow:hidden;pointer-events:none;z-index:1",
    );
    const parent = canvas.parentElement ?? document.body;
    parent.insertBefore(
      layer,
      canvas.parentElement === null
        ? null
        : (canvas.nextSibling as HudElement | null),
    );
    this.layer = layer;
    return layer;
  }

  private placeLayer(layer: HudElement): void {
    const { canvas } = this.options;
    const g = this.geometry;
    if (
      g.left === canvas.offsetLeft &&
      g.top === canvas.offsetTop &&
      g.width === canvas.offsetWidth &&
      g.height === canvas.offsetHeight
    )
      return;
    g.left = canvas.offsetLeft;
    g.top = canvas.offsetTop;
    g.width = canvas.offsetWidth;
    g.height = canvas.offsetHeight;
    set(layer.style, "left", `${String(g.left)}px`);
    set(layer.style, "top", `${String(g.top)}px`);
    set(layer.style, "width", `${String(g.width)}px`);
    set(layer.style, "height", `${String(g.height)}px`);
  }

  private create(kind: Item["kind"]): Shown {
    const element = this.options.document.createElement(
      kind === "button" ? "button" : "div",
    );
    element.setAttribute(`data-mtek-hud-${kind}`, "");
    if (kind === "button") {
      element.setAttribute("type", "button");
      set(element.style, "cssText", BUTTON_STYLE);
      // No focus on press, so Space and Enter keep reaching the game instead of clicking the button again.
      element.addEventListener("mousedown", (event) =>
        event.preventDefault?.(),
      );
      element.addEventListener("pointerdown", (event) =>
        event.stopPropagation?.(),
      );
      element.addEventListener("click", (event) => {
        event.stopPropagation?.();
        const key = this.buttonKeys.get(element);
        if (key !== undefined) this.pendingClicks.add(key);
      });
    } else {
      set(element.style, "cssText", kind === "text" ? TEXT_STYLE : RECT_STYLE);
    }
    return { kind, element, written: new Map() };
  }

  private update(shown: Shown, item: Item): void {
    const write = (name: string, value: string): void => {
      if (shown.written.get(name) === value) return;
      shown.written.set(name, value);
      if (name === "#text") shown.element.textContent = value;
      else if (name === "#label") shown.element.setAttribute("aria-label", value);
      else set(shown.element.style, name, value);
    };
    const { left, top } = placement(item.x, item.y);
    write("left", left);
    write("top", top);
    switch (item.kind) {
      case "text":
        write("transform", `translate(${String(-item.align * 100)}%,-50%)`);
        if (item.font === PIXEL_FONT) {
          // The built-in font: the text as an SVG background, `size` px tall (decision 0139).
          const { url, width } = pixelTextImage(item.content, item.tint);
          const scale = item.size / CELL_HEIGHT;
          write("#text", "");
          write("#label", item.content);
          write("backgroundImage", url);
          write("backgroundSize", "100% 100%");
          write("width", `${String(width * scale)}px`);
          write("height", `${String(item.size)}px`);
          break;
        }
        write("#label", "");
        write("backgroundImage", "none");
        write("width", "");
        write("height", "");
        write("#text", item.content);
        write("fontSize", `${String(item.size)}px`);
        write("color", item.tint);
        write("fontFamily", item.font === "" ? DEFAULT_FAMILY : item.font);
        break;
      case "rect":
        write("width", `${String(item.width)}px`);
        write("height", `${String(item.height)}px`);
        write("background", item.tint);
        write("transform", `translate(${String(-item.align * 100)}%,-50%)`);
        break;
      case "button":
        write("#text", item.content);
        write("fontSize", `${String(item.size)}px`);
        this.buttonKeys.set(shown.element, item.key);
        break;
    }
  }
}

function set(
  style: Record<string, string> | CSSStyleDeclaration,
  name: string,
  value: string,
): void {
  (style as unknown as Record<string, string>)[name] = value;
}
