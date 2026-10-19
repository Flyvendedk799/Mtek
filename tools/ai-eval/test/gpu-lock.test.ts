// The GPU lock (a directory): a command that opens the browser holds it for its duration and always releases it.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner, CommandSpec } from "../src/commands.ts";
import { acquireGpuLock, lockedRunner } from "../src/gpu-lock.ts";
import { tempDir } from "./helpers.ts";

const RESULT: CommandResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false, spawnError: null };
const spec = (...args: string[]): CommandSpec => ({ args, cwd: ".", timeoutMs: 1000 });

describe("the GPU lock", () => {
  it("is a directory that exists while it is held and is gone after the release, which may be called twice", async () => {
    const dir = join(tempDir(), "gpu.lock");
    const release = await acquireGpuLock(dir, { pollMs: 5, timeoutMs: 200 });
    expect(existsSync(dir)).toBe(true);
    release();
    expect(existsSync(dir)).toBe(false);
    release();
  });

  it("waits for another holder and gives up with an error, never running without the lock", async () => {
    const dir = join(tempDir(), "gpu.lock");
    mkdirSync(dir);
    await expect(acquireGpuLock(dir, { pollMs: 5, timeoutMs: 40 })).rejects.toThrow(/could not be taken/);
    expect(existsSync(dir)).toBe(true); // somebody else's lock is untouched
  });

  it("is taken once the other holder lets go", async () => {
    const dir = join(tempDir(), "gpu.lock");
    const first = await acquireGpuLock(dir, { pollMs: 5, timeoutMs: 1000 });
    const second = acquireGpuLock(dir, { pollMs: 5, timeoutMs: 1000 });
    setTimeout(first, 30);
    const release = await second;
    expect(existsSync(dir)).toBe(true);
    release();
  });

  it("is held by a locked runner only around the commands that use the GPU, and released also when the command throws", async () => {
    const dir = join(tempDir(), "gpu.lock");
    const seen: boolean[] = [];
    const inner: CommandRunner = {
      run: (s) => {
        seen.push(existsSync(dir));
        return s.args[0] === "boom" ? Promise.reject(new Error("boom")) : Promise.resolve(RESULT);
      },
    };
    const runner = lockedRunner(inner, dir, (s) => s.args[0] === "test" || s.args[0] === "boom", { pollMs: 5, timeoutMs: 200 });
    await runner.run(spec("check"));
    await runner.run(spec("test"));
    await expect(runner.run(spec("boom"))).rejects.toThrow("boom");
    expect(seen).toEqual([false, true, true]);
    expect(existsSync(dir)).toBe(false);
  });
});
