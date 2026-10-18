import { describe, expect, it } from "vitest";
import { browserChannel, extraBrowserArgs, hardwareLaunchArgs, isHeadless } from "./launch-args.ts";

describe("launch arguments", () => {
  it("are headless Chromium with the WebGPU switches by default", () => {
    expect(isHeadless({})).toBe(true);
    expect(isHeadless({ MTEK_HEADED: "1" })).toBe(false);
    expect(browserChannel({})).toBe("chromium");
    expect(browserChannel({ MTEK_BROWSER_CHANNEL: "chrome" })).toBe("chrome");
    expect(hardwareLaunchArgs({}, "win32")).toEqual([
      "--enable-unsafe-webgpu",
      "--ignore-gpu-blocklist",
      "--enable-webgpu-developer-features",
    ]);
  });

  it("add the Vulkan switches on Linux only", () => {
    expect(hardwareLaunchArgs({}, "linux")).toContain("--use-angle=vulkan");
    expect(hardwareLaunchArgs({}, "darwin")).not.toContain("--use-angle=vulkan");
  });

  it("append MTEK_BROWSER_ARGS, split on white space", () => {
    expect(extraBrowserArgs({})).toEqual([]);
    expect(extraBrowserArgs({ MTEK_BROWSER_ARGS: "  --disable-gpu   --foo=1 " })).toEqual([
      "--disable-gpu",
      "--foo=1",
    ]);
    expect(hardwareLaunchArgs({ MTEK_BROWSER_ARGS: "--disable-gpu" }, "win32").at(-1)).toBe(
      "--disable-gpu",
    );
  });
});
