export interface AssetDescriptor {
  readonly url: string;
  /** Optional exact size and SHA-256 of the fetched bytes. */
  readonly bytes?: number;
  readonly sha256?: string;
}
export interface AssetProgress {
  readonly loaded: number;
  readonly total: number | undefined;
}
export interface AssetLoader<T> {
  readonly id: string;
  readonly apiVersion: 1;
  decode(bytes: Uint8Array, signal: AbortSignal): Promise<T> | T;
  dispose?(value: T): void;
}
export interface AssetLease<T> {
  readonly value: T;
  readonly bytes: number;
  release(): void;
}
export interface AssetRequestOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: AssetProgress) => void;
}
export interface AssetPoolOptions {
  readonly baseUrl: URL;
  /** Network capability: exact permitted origins. The base origin is permitted by default. */
  readonly allowedOrigins?: readonly string[];
  /** Maximum bytes per response, enforced while streaming. Default 64 MiB. */
  readonly maxAssetBytes?: number;
  readonly fetch?: typeof fetch;
}
interface Entry<T> {
  readonly abort: AbortController;
  readonly terminated: Promise<never>;
  readonly loader: AssetLoader<T>;
  promise: Promise<T>;
  refs: number;
  bytes: number;
  value: T | undefined;
  ready: boolean;
  retired: boolean;
  readonly listeners: Set<(progress: AssetProgress) => void>;
}

/** Renderer/compiler-independent asynchronous content lifetime and custom loader API v1. */
export class AssetPool {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly loaders = new Map<string, AssetLoader<unknown>>();
  private readonly origins: Set<string>;
  private readonly maximum: number;
  private disposed = false;
  constructor(private readonly options: AssetPoolOptions) {
    this.origins = new Set(options.allowedOrigins ?? [options.baseUrl.origin]);
    this.maximum = options.maxAssetBytes ?? 64 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maximum) || this.maximum < 1)
      throw new RangeError("maxAssetBytes must be a positive safe integer");
  }
  async load<T>(
    asset: AssetDescriptor,
    loader: AssetLoader<T>,
    options: AssetRequestOptions = {},
  ): Promise<AssetLease<T>> {
    if (this.disposed) throw new Error("Asset pool is disposed");
    if (loader.apiVersion !== 1 || loader.id === "")
      throw new RangeError("Unsupported asset loader API or empty ID");
    const known = this.loaders.get(loader.id);
    if (known !== undefined && known !== loader)
      throw new RangeError(
        `Asset loader '${loader.id}' is already registered with a different implementation`,
      );
    this.loaders.set(loader.id, loader);
    const url = new URL(asset.url, this.options.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !this.origins.has(url.origin) ||
      url.username !== "" ||
      url.password !== ""
    )
      throw new Error(
        `Asset URL requires an undeclared origin capability: ${url.origin}`,
      );
    if (
      asset.bytes !== undefined &&
      (!Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 0 ||
        asset.bytes > this.maximum)
    )
      throw new RangeError("Invalid asset byte length");
    if (asset.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(asset.sha256))
      throw new RangeError("Invalid asset SHA-256");
    options.signal?.throwIfAborted();
    const key = JSON.stringify([
      loader.id,
      url.href,
      asset.bytes ?? null,
      asset.sha256?.toLowerCase() ?? null,
    ]);
    let entry = this.entries.get(key) as Entry<T> | undefined;
    if (entry === undefined) {
      const abort = new AbortController();
      entry = {
        abort,
        terminated: new Promise<never>((_, reject) =>
          abort.signal.addEventListener(
            "abort",
            () =>
              reject(new DOMException("Asset resource retired", "AbortError")),
            { once: true },
          ),
        ),
        loader,
        promise: Promise.resolve(undefined as T),
        refs: 0,
        bytes: 0,
        value: undefined,
        ready: false,
        retired: false,
        listeners: new Set(),
      };
      this.entries.set(key, entry);
      const pending = entry;
      entry.promise = this.fetch(asset, url, pending).then(async (bytes) => {
        const value = await loader.decode(bytes, pending.abort.signal);
        if (pending.retired) {
          loader.dispose?.(value);
          throw new DOMException("Asset request cancelled", "AbortError");
        }
        pending.value = value;
        pending.ready = true;
        return value;
      });
    }
    entry.refs++;
    const current = entry;
    const observer = options.onProgress;
    if (observer !== undefined) current.listeners.add(observer);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      if (observer !== undefined) current.listeners.delete(observer);
      current.refs--;
      if (current.refs === 0) this.retire(key, current);
    };
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      if (options.signal === undefined) return;
      abort = () => {
        release();
        const reason: unknown = options.signal!.reason;
        reject(
          reason instanceof Error
            ? reason
            : new DOMException("Asset request cancelled", "AbortError"),
        );
      };
      options.signal.addEventListener("abort", abort, { once: true });
      if (options.signal.aborted) abort();
    });
    try {
      const value = await Promise.race([
        current.promise,
        cancelled,
        current.terminated,
      ]);
      if (current.retired)
        throw new DOMException("Asset pool disposed", "AbortError");
      if (observer !== undefined) current.listeners.delete(observer);
      return { value, bytes: current.bytes, release };
    } catch (error) {
      release();
      throw error;
    } finally {
      if (abort !== undefined)
        options.signal!.removeEventListener("abort", abort);
    }
  }
  private async fetch(
    asset: AssetDescriptor,
    url: URL,
    entry: Entry<unknown>,
  ): Promise<Uint8Array> {
    const response = await (this.options.fetch ?? globalThis.fetch)(url, {
      signal: entry.abort.signal,
      redirect: "error",
      credentials: "omit",
    });
    if (!response.ok)
      throw new Error(
        `Asset request failed: HTTP ${String(response.status)} (${url.href})`,
      );
    const length = response.headers.get("content-length"),
      total = length === null ? undefined : Number(length);
    if (
      total !== undefined &&
      (!Number.isSafeInteger(total) || total < 0 || total > this.maximum)
    ) {
      await response.body?.cancel();
      throw new RangeError("Asset exceeds maxAssetBytes");
    }
    const chunks: Uint8Array[] = [],
      reader = response.body?.getReader();
    let loaded = 0;
    const push = (chunk: Uint8Array): void => {
      loaded += chunk.byteLength;
      if (loaded > this.maximum)
        throw new RangeError("Asset exceeds maxAssetBytes");
      chunks.push(chunk);
      for (const observer of entry.listeners) {
        try {
          observer({ loaded, total });
        } catch {
          /* Progress observers do not own resource lifetime. */
        }
      }
    };
    if (reader === undefined)
      push(new Uint8Array(await response.arrayBuffer()));
    else
      try {
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          push(result.value);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
    const bytes = new Uint8Array(loaded);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    if (asset.bytes !== undefined && loaded !== asset.bytes)
      throw new Error(
        `Asset length mismatch: expected ${String(asset.bytes)}, received ${String(loaded)}`,
      );
    if (asset.sha256 !== undefined) {
      if (globalThis.crypto?.subtle === undefined)
        throw new Error("SHA-256 verification requires a secure context");
      const hash = await crypto.subtle.digest("SHA-256", bytes),
        hex = Array.from(new Uint8Array(hash), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      if (hex !== asset.sha256.toLowerCase())
        throw new Error("Asset SHA-256 mismatch");
    }
    entry.bytes = bytes.length;
    return bytes;
  }
  private retire(key: string, entry: Entry<unknown>): void {
    if (entry.retired) return;
    entry.retired = true;
    entry.abort.abort();
    if (this.entries.get(key) === entry) this.entries.delete(key);
    if (entry.ready) entry.loader.dispose?.(entry.value);
  }
  snapshot(): {
    resources: number;
    pending: number;
    bytes: number;
    leases: number;
  } {
    let pending = 0,
      bytes = 0,
      leases = 0;
    for (const entry of this.entries.values()) {
      pending += entry.ready ? 0 : 1;
      bytes += entry.bytes;
      leases += entry.refs;
    }
    return { resources: this.entries.size, pending, bytes, leases };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const [key, entry] of this.entries) {
      try {
        this.retire(key, entry);
      } catch (error) {
        errors.push(error);
      }
    }
    this.loaders.clear();
    if (errors.length > 0)
      throw new AggregateError(errors, "Asset loader cleanup failed");
  }
}
