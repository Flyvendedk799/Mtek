/**
 * Font files of `asset.font(..)` (decision 0139): each is registered once with the page as a `FontFace` under
 * a generated family name, the first time a `hud.text` call names it. Until the face has loaded the browser
 * shows the fallback family, then swaps; a file the browser cannot parse stays on the fallback and is
 * reported once (`W8204`).
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import { resolveSpan } from "../host/failures.js";

/** The page's `FontFace` constructor and `document.fonts`, or a test fake. */
export interface FontPage {
  createFace(family: string, bytes: Uint8Array): { load(): Promise<unknown> };
  add(face: unknown): void;
}

export interface FontRegistryOptions {
  readonly manifest: MtekManifest;
  /** The manifest of the scene that runs: where a font is looked up and its `W8204` span resolved (decision 0176). */
  readonly manifestNow?: () => MtekManifest;
  readonly bytes: (url: string) => Uint8Array | undefined;
  readonly page: FontPage | undefined;
  readonly report: (diagnostic: MtekDiagnostic) => void;
}

/** The browser's font page, when it has `FontFace` and `document.fonts`. */
export function browserFontPage(document: unknown): FontPage | undefined {
  const fonts = (document as { fonts?: { add?: (face: unknown) => void } } | undefined)?.fonts;
  const Face = (globalThis as { FontFace?: new (family: string, source: BufferSource) => { load(): Promise<unknown> } }).FontFace;
  if (Face === undefined || typeof fonts?.add !== "function") return undefined;
  return {
    createFace: (family, bytes) => new Face(family, bytes as unknown as BufferSource),
    add: (face) => fonts.add?.(face),
  };
}

export class FontRegistry {
  private readonly families = new Map<string, string | undefined>();

  constructor(private readonly options: FontRegistryOptions) {}

  /** The family of the font declared at `source`, registering it on first use; `undefined` if there is none. */
  family(source: string): string | undefined {
    if (this.families.has(source)) return this.families.get(source);
    const { page } = this.options;
    const manifest = this.options.manifestNow?.() ?? this.options.manifest;
    const asset = manifest.assets.find((entry) => entry.kind === "font" && entry.source === source);
    const bytes = asset === undefined ? undefined : this.options.bytes(asset.url);
    if (asset === undefined || asset.kind !== "font" || bytes === undefined || page === undefined) {
      this.families.set(source, undefined);
      return undefined;
    }
    const family = `mtek-font-${asset.sha256.slice(0, 12)}`;
    this.families.set(source, family);
    try {
      const face = page.createFace(family, bytes);
      page.add(face);
      face.load().catch(() => {
        this.unusable(source, asset.span, manifest);
      });
    } catch {
      this.unusable(source, asset.span, manifest);
    }
    return family;
  }

  private unusable(source: string, span: number, manifest: MtekManifest): void {
    this.families.set(source, undefined);
    this.options.report(
      makeRuntimeDiagnostic("W8204", {
        phase: "runtime:update",
        message: `The browser could not load the font '${source}'; the HUD text uses the default family instead.`,
        source: resolveSpan(manifest, span),
      }),
    );
  }
}
