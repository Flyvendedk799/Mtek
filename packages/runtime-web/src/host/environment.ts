/**
 * The platform facts the host reads, gathered in one injectable object so tests can run without a
 * browser. `defaultEnvironment()` reads the real globals lazily, at mount time; it never inspects the
 * user agent (`spec/runtime-abi.md` section 6.1: browser names are never capability evidence).
 */

/** The part of a `fetch` response the runtime uses. */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/** The part of a `fetch` response the asset loader uses: the body as bytes. */
export interface BytesResponseLike {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The part of `ResizeObserver` the runtime uses. */
export interface ResizeObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

export type ResizeObserverFactory = new (callback: () => void) => ResizeObserverLike;

/** The part of `MediaQueryList` the runtime uses: the `change` event of a resolution query. */
export type MediaQueryListLike = EventTarget;

/** The part of `document` the runtime uses: visibility and its events. */
export type DocumentLike = EventTarget & { readonly visibilityState: DocumentVisibilityState };

export interface HostEnvironment {
  /** The `GPU` entry point; `null` simulates a browser without WebGPU. */
  readonly gpu: GPU | null;
  /** Platform endianness override for tests; default: detected. */
  readonly littleEndian?: boolean;
  fetch(url: string): Promise<FetchResponseLike>;
  /** `fetch` for a binary body: the packaged assets (`spec/assets.md` section 5). */
  fetchBytes(url: string): Promise<BytesResponseLike>;
  /**
   * A dynamic `import()` of the ES module at `url` (an absolute URL): how `physics/<h16>.js` is loaded, only for a
   * program whose manifest has `subsystems.physics` (`spec/physics.md` section 5, decision 0066).
   */
  importModule(url: string): Promise<unknown>;
  /**
   * The lowercase hex SHA-256 of `bytes`; `undefined` when `crypto.subtle` does not exist (an insecure
   * context), in which case the asset loader verifies the byte length only (`spec/assets.md` section 5).
   */
  readonly sha256: ((bytes: Uint8Array) => Promise<string>) | undefined;
  /**
   * Decodes a PNG or JPEG without colour space conversion or alpha premultiplication
   * (`createImageBitmap` with `colorSpaceConversion` and `premultiplyAlpha` `"none"`). Rejects when the
   * browser cannot decode the bytes.
   */
  decodeImage(bytes: Uint8Array): Promise<ImageBitmap>;
  /** `undefined` when there is no document (the overlay and the visibility pause are then unavailable). */
  readonly document: DocumentLike | undefined;
  readonly ResizeObserver: ResizeObserverFactory | undefined;
  /** The window, whose `blur` releases every held key (`spec/scenes.md` section 7.4); absent outside a browser. */
  readonly window?: EventTarget | undefined;
  /** Where `print` goes (the development console); absent means nowhere. */
  log?(message: string): void;
  requestAnimationFrame(callback: (nowMs: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  /** `window.devicePixelRatio`, read each time the backing size is computed. */
  devicePixelRatio(): number;
  /** `window.matchMedia`; `undefined` without it (a changed pixel ratio is then noticed at the next resize). */
  matchMedia?(query: string): MediaQueryListLike;
  /** Monotonic milliseconds (`performance.now`). */
  now(): number;
  /** `setTimeout`; the device recovery delays (`spec/runtime-abi.md` section 9.4) run on it so tests can fake time. */
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** `crypto.subtle.digest("SHA-256")` as lowercase hex, or `undefined` where `crypto.subtle` does not exist. */
export function browserSha256(): ((bytes: Uint8Array) => Promise<string>) | undefined {
  const subtle = typeof crypto === "undefined" ? undefined : (crypto as Partial<Crypto>).subtle;
  if (subtle === undefined) return undefined;
  return async (bytes) => {
    // `digest` takes a BufferSource; a view into a larger buffer is copied so only its own bytes are hashed.
    const digest = await subtle.digest("SHA-256", bytes.slice());
    let hex = "";
    for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
    return hex;
  };
}

/** `createImageBitmap` of the raw bytes with every implicit conversion switched off (`spec/assets.md` section 5). */
export function browserDecodeImage(bytes: Uint8Array): Promise<ImageBitmap> {
  // The browser sniffs the format, so no MIME type is passed (and no file name is parsed).
  return createImageBitmap(new Blob([bytes.slice()]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

/** Reads the browser globals. Fields whose global is missing become `null`/`undefined`, so mounting fails with a typed error rather than a `ReferenceError`. */
export function defaultEnvironment(): HostEnvironment {
  const holder: Partial<Pick<Navigator, "gpu">> | undefined = typeof navigator === "undefined" ? undefined : navigator;
  return {
    gpu: holder?.gpu ?? null,
    fetch: (url) => fetch(url),
    fetchBytes: (url) => fetch(url),
    // A computed specifier: the bundler keeps this a real `import()` of the file the manifest names.
    importModule: (url) => import(/* @vite-ignore */ url) as Promise<unknown>,
    sha256: browserSha256(),
    decodeImage: browserDecodeImage,
    document: typeof document === "undefined" ? undefined : document,
    ResizeObserver: typeof ResizeObserver === "undefined" ? undefined : ResizeObserver,
    window: typeof window === "undefined" ? undefined : window,
    log: (message) => {
      console.log(message);
    },
    requestAnimationFrame: (callback) => requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => {
      cancelAnimationFrame(handle);
    },
    devicePixelRatio: () => (typeof devicePixelRatio === "number" ? devicePixelRatio : 1),
    ...(typeof matchMedia === "function" ? { matchMedia: (query: string): MediaQueryListLike => matchMedia(query) } : {}),
    now: () => performance.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}

/** Why a request of an untrusted preview was refused (decision 0075). */
export class NetworkRefusedError extends Error {
  readonly url: string;

  constructor(url: string, base: URL) {
    super(`refused ${url}: a preview may only request files below its own directory (${base.href})`);
    this.name = "NetworkRefusedError";
    this.url = url;
  }
}

/**
 * Whether `url` names a file below `base` and nothing else: the same scheme, host and port, a path that starts with
 * the path of `base` after the URL parser has resolved every `.` and `..`, no credentials, and, below `base`, no
 * percent-encoded dot, slash or backslash (a server may decode those after the check). `base` is a directory URL
 * (its path ends with `/`). A relative `url` is resolved against `base`; one that does not parse is outside.
 */
export function isWithinBase(url: string, base: URL): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return false;
  }
  if (parsed.protocol !== base.protocol || parsed.host !== base.host) return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  const directory = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  if (!parsed.pathname.startsWith(directory)) return false;
  return !/%2e|%2f|%5c/i.test(parsed.pathname.slice(directory.length));
}

/**
 * `environment` with every network access checked by {@link isWithinBase}: `fetch`, `fetchBytes` and `importModule`
 * (the physics module) reject with a {@link NetworkRefusedError} for any URL outside `base`, and the request is
 * never made. An untrusted preview mounts with this (decision 0075): the compiler never emits an outside URL, so
 * a refusal means a manifest that was not made by it.
 */
export function restrictToBase(environment: HostEnvironment, base: URL): HostEnvironment {
  const guarded = <T>(url: string, request: () => Promise<T>): Promise<T> =>
    isWithinBase(url, base) ? request() : Promise.reject(new NetworkRefusedError(url, base));
  return {
    ...environment,
    fetch: (url) => guarded(url, () => environment.fetch(url)),
    fetchBytes: (url) => guarded(url, () => environment.fetchBytes(url)),
    importModule: (url) => guarded(url, () => environment.importModule(url)),
  };
}
