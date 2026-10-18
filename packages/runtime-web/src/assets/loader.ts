/**
 * Runtime asset loading (`spec/assets.md` section 5, `spec/runtime-abi.md` section 5.5, decision 0060): every
 * file of the manifest's `assets` table has an observable state, `pending` then `ready` or `failed`.
 *
 *  - The file is fetched from `baseUrl` + `url` (the name is opaque and never parsed), its byte length is
 *    compared with `bytes` and, when `crypto.subtle` exists, its SHA-256 with `sha256`. Any mismatch is `E7030`
 *    and the bytes are dropped: stale or tampered data is never used.
 *  - An image is then decoded (`HostEnvironment.decodeImage`: no colour conversion, no premultiplication). A
 *    decode failure is `E7031`; a size above the device's `maxTextureDimension2D` is `E8002` (the compiler
 *    checked the configured limit, the device may offer less).
 *  - Every failure is a diagnostic at the span of the declaring `asset.*` call, naming the file. All assets
 *    are fetched concurrently and every failure is reported, in manifest order.
 *
 * The verified bytes stay in {@link LoadedAssets}: the GPU objects made from them (`render/meshes.ts`,
 * `render/resources.ts`) are rebuilt from these bytes after a device loss, a hot reload reuses unchanged
 * files, and nothing is fetched twice (decision 0056 item "Consequences", decision 0060).
 */
import type { MtekAsset, MtekImageAsset, MtekManifest } from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic, type MtekRuntimePhase } from "../diagnostics/types.js";
import type { HostEnvironment } from "../host/environment.js";
import { resolveSpan } from "../host/failures.js";
import type { MtekAssetStateEvent, MtekAssetStatus } from "../host/types.js";

/** `pending`, then `ready` or `failed` (`spec/assets.md` section 5). */
export type AssetState = MtekAssetStateEvent["state"];

/** One state change of one asset file, as `options.test.onAssetState` and the loader's `onState` deliver it. */
export type AssetStateEvent = MtekAssetStateEvent;

/** The state of an asset file after mount, as `debug.assets()` lists it. */
export type AssetStatus = MtekAssetStatus;

/** The environment members the loader uses (the fake host provides them in tests). */
export type AssetEnvironment = Pick<HostEnvironment, "fetchBytes" | "sha256" | "decodeImage">;

/** Decoded images by asset url. The caller owns the bitmaps and closes them once they are uploaded. */
export type DecodedImages = ReadonlyMap<string, ImageBitmap>;

/** Releases decoded bitmaps. */
export function closeImages(images: DecodedImages): void {
  for (const bitmap of images.values()) bitmap.close();
}

/** The verified files of one program: their manifest entries and bytes. Immutable. */
export class LoadedAssets {
  private readonly files: ReadonlyMap<string, { readonly asset: MtekAsset; readonly bytes: Uint8Array }>;

  constructor(files: ReadonlyMap<string, { readonly asset: MtekAsset; readonly bytes: Uint8Array }> = new Map()) {
    this.files = files;
  }

  get size(): number {
    return this.files.size;
  }

  has(url: string): boolean {
    return this.files.has(url);
  }

  /** The verified bytes of `url`. */
  bytes(url: string): Uint8Array {
    const file = this.files.get(url);
    if (file === undefined) throw new Error(`internal error: asset '${url}' was not loaded`);
    return file.bytes;
  }

  /** The bytes of an earlier load of this exact file (same url, hash and length), if there are any. */
  reusable(asset: MtekAsset): Uint8Array | undefined {
    const file = this.files.get(asset.url);
    return file !== undefined && file.asset.sha256 === asset.sha256 && file.asset.bytes === asset.bytes ? file.bytes : undefined;
  }

  /** Every file with its state: loaded files are `ready`. */
  statuses(): readonly AssetStatus[] {
    return [...this.files.values()].map(({ asset }) => ({ url: asset.url, kind: asset.kind, state: "ready" as const, bytes: asset.bytes }));
  }
}

export interface AssetLoadOptions {
  readonly manifest: MtekManifest;
  /** The program's base URL: asset urls are relative to it, like `shaders[].url`. */
  readonly baseUrl: URL;
  readonly environment: AssetEnvironment;
  /** The device's `maxTextureDimension2D`. */
  readonly maxTextureDimension2D: number;
  /** The phase recorded in the diagnostics. Default `runtime:mount`. */
  readonly phase?: MtekRuntimePhase;
  /** Files of an earlier load that are still current are not fetched again (hot reload). */
  readonly previous?: LoadedAssets;
  /** Called for every state change: all files `pending` first, then `ready` or `failed` as each finishes. */
  readonly onState?: (event: AssetStateEvent) => void;
}

export interface AssetLoadResult {
  /** The files that loaded (all of them when `diagnostics` is empty). */
  readonly assets: LoadedAssets;
  /** The decoded images; empty when `diagnostics` is not. */
  readonly images: DecodedImages;
  /** One diagnostic per failed file, in manifest order. */
  readonly diagnostics: readonly MtekDiagnostic[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.message === "" ? error.name : error.message) : String(error);
}

function quoted(text: string): string {
  return `'${text}'`;
}

/** What a file is, for messages: the GLB project path(s) a mesh-data file was packed from, or "image". */
function describe(asset: MtekAsset): string {
  if (asset.kind === "image") return "image";
  const sources = [...new Set(asset.primitives.map((primitive) => primitive.source.file))];
  return `mesh data of ${sources.map(quoted).join(", ")}`;
}

function diagnostic(
  options: AssetLoadOptions,
  code: "E7030" | "E7031" | "E8002",
  asset: MtekAsset,
  message: string,
  extra: { readonly expected?: string; readonly actual?: string; readonly notes?: readonly string[] } = {},
): MtekDiagnostic {
  return makeRuntimeDiagnostic(code, {
    phase: options.phase ?? "runtime:mount",
    message,
    source: resolveSpan(options.manifest, asset.span),
    ...(extra.expected === undefined ? {} : { expected: extra.expected }),
    ...(extra.actual === undefined ? {} : { actual: extra.actual }),
    notes: [`asset file: ${asset.url}`, ...(extra.notes ?? [])],
  });
}

type Fetched = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly diagnostic: MtekDiagnostic };

/** Fetches and verifies one file (or returns the bytes of an earlier load of it). Never throws. */
async function fetchVerified(options: AssetLoadOptions, asset: MtekAsset): Promise<Fetched> {
  const reused = options.previous?.reusable(asset);
  if (reused !== undefined) return { ok: true, bytes: reused };

  const name = `Asset ${quoted(asset.url)} (${describe(asset)})`;
  const fail = (message: string, extra?: Parameters<typeof diagnostic>[4]): Fetched => ({
    ok: false,
    diagnostic: diagnostic(options, "E7030", asset, `${name} ${message}`, extra),
  });
  const url = new URL(asset.url, options.baseUrl).href;
  let buffer: ArrayBuffer;
  try {
    const response = await options.environment.fetchBytes(url);
    if (!response.ok) return fail(`could not be loaded: the server answered HTTP ${String(response.status)} for ${url}.`);
    buffer = await response.arrayBuffer();
  } catch (error) {
    return fail(`could not be loaded from ${url}: ${errorText(error)}`);
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength !== asset.bytes) {
    return fail(`has ${String(bytes.byteLength)} bytes, but the build recorded ${String(asset.bytes)}.`, {
      expected: `${String(asset.bytes)} bytes`,
      actual: `${String(bytes.byteLength)} bytes`,
    });
  }
  const { sha256 } = options.environment;
  if (sha256 !== undefined) {
    let digest: string;
    try {
      digest = await sha256(bytes);
    } catch (error) {
      return fail(`could not be verified: computing its SHA-256 failed: ${errorText(error)}`);
    }
    if (digest !== asset.sha256.toLowerCase()) {
      return fail("does not match the SHA-256 recorded by the build; it was changed after the build or served from a stale cache.", {
        expected: asset.sha256,
        actual: digest,
      });
    }
  }
  return { ok: true, bytes };
}

type Decoded = { readonly ok: true; readonly bitmap: ImageBitmap } | { readonly ok: false; readonly diagnostic: MtekDiagnostic };

/** Decodes one image and checks it against the device's texture size limit. Never throws. */
async function decodeVerified(options: AssetLoadOptions, asset: MtekImageAsset, bytes: Uint8Array): Promise<Decoded> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await options.environment.decodeImage(bytes);
  } catch (error) {
    return {
      ok: false,
      diagnostic: diagnostic(options, "E7031", asset, `The browser could not decode the image ${quoted(asset.url)}: ${errorText(error)}`, {
        notes: ["help: the file is not a valid PNG or JPEG, although its header was accepted at build time"],
      }),
    };
  }
  const limit = options.maxTextureDimension2D;
  if (bitmap.width > limit || bitmap.height > limit) {
    const size = `${String(bitmap.width)} x ${String(bitmap.height)}`;
    bitmap.close();
    return {
      ok: false,
      diagnostic: diagnostic(
        options,
        "E8002",
        asset,
        `The image ${quoted(asset.url)} is ${size} pixels, larger than this device's maxTextureDimension2D (${String(limit)}).`,
        { notes: ["help: use a smaller image or lower [assets] max_texture_dimension in mtek.toml"] },
      ),
    };
  }
  return { ok: true, bitmap };
}

/**
 * Loads every file of `manifest.assets`: fetch, verify, and decode the images. Resolves when each file is
 * `ready` or `failed`; never rejects. With any failure the result holds no decoded image (they are closed).
 */
export async function loadAssets(options: AssetLoadOptions): Promise<AssetLoadResult> {
  const { manifest, onState } = options;
  const list = manifest.assets;
  const event = (asset: MtekAsset, state: AssetState): void => {
    onState?.({ url: asset.url, kind: asset.kind, state });
  };
  for (const asset of list) event(asset, "pending");

  const results = await Promise.all(
    list.map(async (asset) => {
      const fetched = await fetchVerified(options, asset);
      if (!fetched.ok) {
        event(asset, "failed");
        return { asset, fetched, decoded: undefined };
      }
      const decoded = asset.kind === "image" ? await decodeVerified(options, asset, fetched.bytes) : undefined;
      event(asset, decoded?.ok === false ? "failed" : "ready");
      return { asset, fetched, decoded };
    }),
  );

  const files = new Map<string, { readonly asset: MtekAsset; readonly bytes: Uint8Array }>();
  const images = new Map<string, ImageBitmap>();
  const diagnostics: MtekDiagnostic[] = [];
  for (const { asset, fetched, decoded } of results) {
    if (!fetched.ok) {
      diagnostics.push(fetched.diagnostic);
      continue;
    }
    if (decoded?.ok === false) {
      diagnostics.push(decoded.diagnostic);
      continue;
    }
    files.set(asset.url, { asset, bytes: fetched.bytes });
    if (decoded !== undefined) images.set(asset.url, decoded.bitmap);
  }
  if (diagnostics.length > 0) {
    closeImages(images);
    images.clear();
  }
  return { assets: new LoadedAssets(files), images, diagnostics };
}

/**
 * Decodes every image of `manifest.assets` again from the retained bytes: the images for a scene that is
 * rebuilt without fetching anything (device recovery, decision 0056). The caller closes the bitmaps.
 */
export async function decodeImages(options: Omit<AssetLoadOptions, "previous" | "onState"> & { readonly assets: LoadedAssets }): Promise<{
  readonly images: DecodedImages;
  readonly diagnostics: readonly MtekDiagnostic[];
}> {
  const results = await Promise.all(
    options.manifest.assets.map(async (asset) => (asset.kind === "image" ? { asset, decoded: await decodeVerified(options, asset, options.assets.bytes(asset.url)) } : undefined)),
  );
  const images = new Map<string, ImageBitmap>();
  const diagnostics: MtekDiagnostic[] = [];
  for (const result of results) {
    if (result === undefined) continue;
    if (result.decoded.ok) images.set(result.asset.url, result.decoded.bitmap);
    else diagnostics.push(result.decoded.diagnostic);
  }
  if (diagnostics.length > 0) {
    closeImages(images);
    images.clear();
  }
  return { images, diagnostics };
}
