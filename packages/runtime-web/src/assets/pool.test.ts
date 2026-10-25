import { describe, expect, it, vi } from "vitest";
import { AssetPool, type AssetLoader } from "./pool.js";

const baseUrl = new URL("https://app.example/content/");
function setup(body = "hello") {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response(body)),
    ),
    dispose = vi.fn();
  const loader: AssetLoader<string> = {
    id: "text",
    apiVersion: 1,
    decode: (bytes) => new TextDecoder().decode(bytes),
    dispose,
  };
  return { pool: new AssetPool({ baseUrl, fetch }), fetch, loader, dispose };
}
describe("asynchronous asset pool", () => {
  it("rejects pending consumers immediately on disposal even when a decoder ignores cancellation", async () => {
    const { pool, dispose } = setup();
    let finish: ((value: string) => void) | undefined;
    const loader: AssetLoader<string> = {
      id: "slow",
      apiVersion: 1,
      decode: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      dispose,
    };
    const pending = pool.load({ url: "a" }, loader);
    await vi.waitFor(() => expect(finish).toBeDefined());
    pool.dispose();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    finish!("late");
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledWith("late"));
  });
  it("attempts every loader cleanup when one disposer throws", async () => {
    const { pool } = setup(),
      dispose = vi.fn(() => {
        throw new Error("bad disposer");
      }),
      loader: AssetLoader<string> = {
        id: "throw",
        apiVersion: 1,
        decode: () => "loaded",
        dispose,
      };
    await pool.load({ url: "a" }, loader);
    await pool.load({ url: "b" }, loader);
    expect(() => pool.dispose()).toThrow(AggregateError);
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(pool.snapshot().resources).toBe(0);
    pool.dispose();
  });
  it("deduplicates requests and decoded resources until the last lease is released", async () => {
    const { pool, fetch, loader, dispose } = setup();
    const [a, b] = await Promise.all([
      pool.load({ url: "a.txt" }, loader),
      pool.load({ url: "a.txt" }, loader),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a.value).toBe("hello");
    expect(pool.snapshot()).toEqual({
      resources: 1,
      pending: 0,
      bytes: 5,
      leases: 2,
    });
    a.release();
    a.release();
    expect(dispose).not.toHaveBeenCalled();
    b.release();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(pool.snapshot().resources).toBe(0);
    pool.dispose();
  });
  it("cancels one consumer while the shared request completes for another", async () => {
    let finish: ((response: Response) => void) | undefined;
    let networkSignal: AbortSignal | undefined;
    const fetch: typeof globalThis.fetch = (_url, options) => {
      networkSignal = options?.signal ?? undefined;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const { loader } = setup(),
      pool = new AssetPool({ baseUrl, fetch }),
      abort = new AbortController();
    const first = pool.load({ url: "a.txt" }, loader, { signal: abort.signal }),
      second = pool.load({ url: "a.txt" }, loader);
    abort.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(networkSignal?.aborted).toBe(false);
    finish!(new Response("done"));
    const lease = await second;
    expect(lease.value).toBe("done");
    lease.release();
    expect(networkSignal?.aborted).toBe(true);
    pool.dispose();
  });
  it("disposes a late decoder result after cancellation and permits a fresh retry", async () => {
    const { pool, fetch, dispose } = setup();
    let finish: ((value: string) => void) | undefined;
    const loader: AssetLoader<string> = {
      id: "delayed",
      apiVersion: 1,
      decode: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      dispose,
    };
    const abort = new AbortController(),
      pending = pool.load({ url: "a" }, loader, { signal: abort.signal });
    await vi.waitFor(() => expect(finish).toBeDefined());
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    finish!("late");
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledWith("late"));
    expect(pool.snapshot().resources).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    pool.dispose();
  });
  it("requires declared origins and rejects redirects, errors, length/integrity mismatch and oversized responses", async () => {
    const { pool, loader, fetch } = setup();
    await expect(
      pool.load({ url: "https://cdn.example/a" }, loader),
    ).rejects.toThrow(/capability/);
    expect(fetch).not.toHaveBeenCalled();
    await expect(pool.load({ url: "a", bytes: 10 }, loader)).rejects.toThrow(
      /length mismatch/,
    );
    await expect(
      pool.load({ url: "a", sha256: "0".repeat(64) }, loader),
    ).rejects.toThrow(/SHA-256 mismatch/);
    const small = new AssetPool({ baseUrl, maxAssetBytes: 2, fetch });
    await expect(small.load({ url: "a" }, loader)).rejects.toThrow(
      /maxAssetBytes/,
    );
    expect(fetch.mock.lastCall?.[1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
    });
    pool.dispose();
    small.dispose();
  });
  it("reports streaming progress and retries a failed request", async () => {
    const { pool, loader, fetch } = setup(),
      progress: number[] = [];
    fetch.mockResolvedValueOnce(new Response("broken", { status: 503 }));
    await expect(pool.load({ url: "a" }, loader)).rejects.toThrow(/503/);
    const lease = await pool.load({ url: "a" }, loader, {
      onProgress: (p) => progress.push(p.loaded),
    });
    expect(progress.at(-1)).toBe(5);
    expect(fetch).toHaveBeenCalledTimes(2);
    lease.release();
    pool.dispose();
  });
  it("returns to zero resources through repeated loading and unloading", async () => {
    const { pool, loader, dispose } = setup();
    for (let i = 0; i < 40; i++) {
      const lease = await pool.load({ url: "a" }, loader);
      lease.release();
      expect(pool.snapshot()).toEqual({
        resources: 0,
        pending: 0,
        bytes: 0,
        leases: 0,
      });
    }
    expect(dispose).toHaveBeenCalledTimes(40);
    pool.dispose();
    pool.dispose();
    await expect(pool.load({ url: "a" }, loader)).rejects.toThrow(/disposed/);
  });
});
