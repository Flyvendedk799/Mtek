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

/** The part of `ResizeObserver` the runtime uses. */
export interface ResizeObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

export type ResizeObserverFactory = new (callback: () => void) => ResizeObserverLike;

/** The part of `document` the runtime uses: visibility and its events. */
export type DocumentLike = EventTarget & { readonly visibilityState: DocumentVisibilityState };

export interface HostEnvironment {
  /** The `GPU` entry point; `null` simulates a browser without WebGPU. */
  readonly gpu: GPU | null;
  /** Platform endianness override for tests; default: detected. */
  readonly littleEndian?: boolean;
  fetch(url: string): Promise<FetchResponseLike>;
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
  /** Monotonic milliseconds (`performance.now`). */
  now(): number;
}

/** Reads the browser globals. Fields whose global is missing become `null`/`undefined`, so mounting fails with a typed error rather than a `ReferenceError`. */
export function defaultEnvironment(): HostEnvironment {
  const holder: Partial<Pick<Navigator, "gpu">> | undefined = typeof navigator === "undefined" ? undefined : navigator;
  return {
    gpu: holder?.gpu ?? null,
    fetch: (url) => fetch(url),
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
    now: () => performance.now(),
  };
}
