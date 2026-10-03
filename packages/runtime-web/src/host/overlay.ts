/**
 * The failure overlay (`spec/runtime-abi.md` section 6.1): a readable error panel positioned over the
 * canvas, so a failure is never an unexplained blank page. It lists, per diagnostic, the code and title,
 * the message, the source location and the notes. All text is set through `textContent`, never as HTML,
 * because messages contain browser-provided text.
 */
import type { MtekDiagnostic, MtekSourceSpan } from "../diagnostics/types.js";

/** At most this many diagnostics are listed; the rest are summarised. */
export const MAX_OVERLAY_DIAGNOSTICS = 20;

const overlays = new WeakMap<HTMLElement, FailureOverlay>();

/** `file:line:column`, or `file (bytes a-b)` when the line is unresolved (the runtime has no source text). */
export function formatLocation(source: MtekSourceSpan): string {
  if (source.startLine > 0) return `${source.file}:${String(source.startLine)}:${String(source.startColumn)}`;
  return `${source.file} (bytes ${String(source.startByte)}-${String(source.endByte)})`;
}

export class FailureOverlay {
  private root: HTMLElement | null = null;
  private diagnostics: MtekDiagnostic[] = [];

  /** Creates the overlay for `canvas`; any earlier overlay for the same canvas is removed first. */
  constructor(private readonly canvas: HTMLCanvasElement) {
    FailureOverlay.removeFor(canvas);
    overlays.set(canvas, this);
  }

  /** Removes the overlay a previous mount left on `canvas`, if any. */
  static removeFor(canvas: HTMLElement): void {
    overlays.get(canvas)?.remove();
  }

  /** The overlay element, or `null` when nothing is shown. */
  get element(): HTMLElement | null {
    return this.root;
  }

  /** Replaces the listed diagnostics. */
  show(diagnostics: readonly MtekDiagnostic[]): void {
    this.diagnostics = [...diagnostics];
    this.render();
  }

  /** Appends one diagnostic to the list. */
  add(diagnostic: MtekDiagnostic): void {
    this.diagnostics.push(diagnostic);
    this.render();
  }

  /** Re-aligns the panel with the canvas (call after the canvas moved or was resized). */
  reposition(): void {
    if (this.root !== null) this.applyGeometry(this.root);
  }

  /** Removes the panel from the DOM. Idempotent. */
  remove(): void {
    this.root?.remove();
    this.root = null;
    this.diagnostics = [];
    if (overlays.get(this.canvas) === this) overlays.delete(this.canvas);
  }

  private render(): void {
    const doc = this.canvas.ownerDocument;
    const root = this.root ?? this.createRoot();
    root.replaceChildren();

    const heading = doc.createElement("h1");
    heading.textContent = "Mtek could not run this program";
    heading.style.cssText = "margin:0 0 12px;font-size:16px;font-weight:700";
    root.append(heading);

    for (const diagnostic of this.diagnostics.slice(0, MAX_OVERLAY_DIAGNOSTICS)) {
      root.append(this.renderDiagnostic(diagnostic));
    }
    const hidden = this.diagnostics.length - MAX_OVERLAY_DIAGNOSTICS;
    if (hidden > 0) {
      const more = doc.createElement("p");
      more.textContent = `... and ${String(hidden)} more diagnostics`;
      root.append(more);
    }
  }

  private renderDiagnostic(diagnostic: MtekDiagnostic): HTMLElement {
    const doc = this.canvas.ownerDocument;
    const section = doc.createElement("section");
    section.setAttribute("data-mtek-diagnostic", diagnostic.code);
    section.style.cssText = "margin:0 0 12px;padding:0 0 8px;border-bottom:1px solid rgba(255,255,255,.25)";

    const title = doc.createElement("h2");
    title.textContent = `${diagnostic.code}: ${diagnostic.title}`;
    title.style.cssText = "margin:0 0 4px;font-size:14px;font-weight:700";
    section.append(title);

    const message = doc.createElement("p");
    message.textContent = diagnostic.message;
    message.style.cssText = "margin:0 0 4px;white-space:pre-wrap";
    section.append(message);

    if (diagnostic.source !== null) {
      const location = doc.createElement("p");
      location.setAttribute("data-mtek-location", "");
      location.textContent = formatLocation(diagnostic.source);
      location.style.cssText = "margin:0 0 4px;opacity:.8";
      section.append(location);
    }

    for (const note of diagnostic.notes) {
      const line = doc.createElement("p");
      line.textContent = note;
      line.style.cssText = "margin:0 0 2px;opacity:.8;white-space:pre-wrap";
      section.append(line);
    }
    return section;
  }

  private createRoot(): HTMLElement {
    const doc = this.canvas.ownerDocument;
    const root = doc.createElement("div");
    root.setAttribute("role", "alert");
    root.setAttribute("aria-live", "assertive");
    root.setAttribute("data-mtek-overlay", "");
    root.style.cssText =
      "position:absolute;box-sizing:border-box;overflow:auto;z-index:2147483647;padding:16px;" +
      "background:rgba(32,0,0,.92);color:#fff;font:13px/1.4 ui-monospace,Consolas,monospace";
    this.applyGeometry(root);
    const parent = this.canvas.parentElement ?? doc.body;
    parent.insertBefore(root, this.canvas.parentElement === null ? null : this.canvas.nextSibling);
    this.root = root;
    return root;
  }

  /** Same box as the canvas, in the coordinate space of its offset parent. */
  private applyGeometry(root: HTMLElement): void {
    const canvas = this.canvas;
    root.style.left = `${String(canvas.offsetLeft)}px`;
    root.style.top = `${String(canvas.offsetTop)}px`;
    root.style.width = `${String(canvas.offsetWidth)}px`;
    root.style.height = `${String(canvas.offsetHeight)}px`;
  }
}
