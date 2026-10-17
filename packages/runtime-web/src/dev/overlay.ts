/**
 * The development overlay (`spec/tooling.md` section 9, decision 0055): a fixed panel in the top-left
 * corner of the canvas showing the lines of `panel.ts`. It is a DOM element beside the canvas (like the
 * failure overlay), not drawn into the canvas, so it never changes the pixels of a frame or of
 * `readPixels`. Development builds only: nothing under `src/dev/` is part of a release bundle.
 *
 * Keys (on the canvas's document): `` ` `` (Backquote) shows or hides the panel; `Shift+`` ` selects the
 * next entity. Neither is a member of the `Key` enum, so programs cannot observe them.
 */
import { panelLines, type PanelData, type PanelEntity } from "./panel.js";

/** Marks the panel element (the failure overlay uses `data-mtek-overlay`). */
export const DEV_OVERLAY_ATTRIBUTE = "data-mtek-dev-overlay";

interface KeyLike extends Event {
  readonly code: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export interface DevOverlayOptions {
  readonly canvas: HTMLCanvasElement;
  /** Where key events arrive; `undefined` means no keyboard control. */
  readonly keyTarget: EventTarget | undefined;
  /** Adds a listener the owner removes again (the resource registry, so it is counted and removed by `dispose`). */
  readonly listen: (target: EventTarget, type: string, listener: (event: Event) => void) => void;
}

export class DevOverlay {
  private root: HTMLElement | null = null;
  private shown = true;
  private selected = 0;
  private entities: readonly PanelEntity[] = [];
  private last: PanelData | null = null;

  constructor(private readonly options: DevOverlayOptions) {
    const { keyTarget, listen } = options;
    if (keyTarget !== undefined) {
      listen(keyTarget, "keydown", (event) => {
        this.onKey(event as KeyLike);
      });
    }
  }

  /** The panel element; `null` before the first update and after `remove`. */
  get element(): HTMLElement | null {
    return this.root;
  }

  /** Whether the panel is currently shown (it starts shown). */
  get visible(): boolean {
    return this.shown;
  }

  /** Index of the selected entity in the list last given to `setEntities`. */
  get selectedIndex(): number {
    return this.selected;
  }

  /** The entities the panel can cycle through (the scene's, in instance order). The selection is kept when it still exists. */
  setEntities(entities: readonly PanelEntity[]): void {
    this.entities = entities;
    if (this.selected >= entities.length) this.selected = 0;
  }

  /** The currently selected entity, with its position in the cycle. */
  selection(): { item: PanelEntity; position: number; count: number } | null {
    const item = this.entities[this.selected];
    return item === undefined ? null : { item, position: this.selected, count: this.entities.length };
  }

  toggle(): void {
    this.shown = !this.shown;
    if (this.root !== null) this.root.style.display = this.shown ? "block" : "none";
    if (this.shown && this.last !== null) this.render(this.last);
  }

  selectNext(): void {
    if (this.entities.length === 0) return;
    this.selected = (this.selected + 1) % this.entities.length;
    if (this.shown && this.last !== null) this.render({ ...this.last, entity: this.selection() });
  }

  /** Shows `data` (the `entity` field is replaced by the overlay's own selection). While hidden only the data is remembered. */
  update(data: PanelData): void {
    this.last = { ...data, entity: this.selection() };
    if (this.shown) this.render(this.last);
  }

  /** Re-aligns the panel with the canvas (call after the canvas moved or was resized). */
  reposition(): void {
    if (this.root !== null) this.applyGeometry(this.root);
  }

  /** Removes the panel from the DOM. Idempotent. Key listeners belong to the registry. */
  remove(): void {
    this.root?.remove();
    this.root = null;
    this.last = null;
  }

  private onKey(event: KeyLike): void {
    if (event.code !== "Backquote" || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.shiftKey) {
      if (this.shown) this.selectNext();
    } else {
      this.toggle();
    }
  }

  private render(data: PanelData): void {
    const root = this.root ?? this.createRoot();
    root.textContent = panelLines(data).join("\n");
  }

  private createRoot(): HTMLElement {
    const canvas = this.options.canvas;
    const doc = canvas.ownerDocument;
    const root = doc.createElement("pre");
    root.setAttribute(DEV_OVERLAY_ATTRIBUTE, "");
    root.setAttribute("aria-hidden", "true");
    root.style.cssText =
      "position:absolute;box-sizing:border-box;margin:0;padding:8px 10px;max-width:90%;overflow:hidden;" +
      "pointer-events:none;z-index:2147483646;white-space:pre-wrap;background:rgba(0,0,0,.72);color:#e8f4e8;" +
      "font:11px/1.35 ui-monospace,Consolas,monospace";
    this.applyGeometry(root);
    root.style.display = this.shown ? "block" : "none";
    const parent = canvas.parentElement ?? doc.body;
    parent.insertBefore(root, canvas.parentElement === null ? null : canvas.nextSibling);
    this.root = root;
    return root;
  }

  /** The top-left corner of the canvas, in the coordinate space of its offset parent. */
  private applyGeometry(root: HTMLElement): void {
    root.style.left = `${String(this.options.canvas.offsetLeft + 8)}px`;
    root.style.top = `${String(this.options.canvas.offsetTop + 8)}px`;
  }
}
