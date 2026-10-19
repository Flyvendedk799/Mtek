// The browser configuration of the hardware project (spec/testing.md section 6.1), shared by
// `playwright.config.ts` and the `mtek test` runner (`mtek-test/`): both must launch Chromium the
// same way, or a fixture could pass in one and see another adapter in the other.

type Environment = Readonly<Record<string, string | undefined>>;

/** Whether Chromium runs without a window (`MTEK_HEADED=1` shows it). */
export function isHeadless(env: Environment = process.env): boolean {
  return env["MTEK_HEADED"] !== "1";
}

/** The Playwright channel: "chromium" selects Chromium's new headless mode (the headless shell is the old one). */
export function browserChannel(env: Environment = process.env): string {
  return env["MTEK_BROWSER_CHANNEL"] ?? "chromium";
}

/**
 * Extra launch arguments (space separated), for experiments and for simulating a machine without a GPU
 * (`MTEK_BROWSER_ARGS=--disable-gpu`). They are recorded in the environment record.
 */
export function extraBrowserArgs(env: Environment = process.env): string[] {
  return (env["MTEK_BROWSER_ARGS"] ?? "").split(/\s+/).filter((arg) => arg !== "");
}

/**
 * `--enable-webgpu-developer-features` makes Chromium report `adapter.info.device` and `description`
 * (otherwise empty), so the environment record names the real GPU. See decision 0012, amendment.
 */
export function hardwareLaunchArgs(
  env: Environment = process.env,
  platform: string = process.platform,
): string[] {
  return [
    "--enable-unsafe-webgpu",
    "--ignore-gpu-blocklist",
    "--enable-webgpu-developer-features",
    ...(platform === "linux"
      ? ["--use-angle=vulkan", "--enable-features=Vulkan", "--disable-vulkan-surface"]
      : []),
    ...extraBrowserArgs(env),
  ];
}

/**
 * SwiftShader correctness runs must present the canvas as well as render offscreen textures.
 * Linux uses the same ANGLE/Vulkan presentation path as the hardware project. Chromium's
 * disable-vulkan-surface switch presents via bitblt instead of an unavailable headless swapchain.
 */
export function softwareLaunchArgs(
  env: Environment = process.env,
  platform: string = process.platform,
): string[] {
  return [
    "--enable-unsafe-webgpu",
    "--use-webgpu-adapter=swiftshader",
    "--enable-webgpu-developer-features",
    ...(platform === "linux"
      ? ["--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--disable-vulkan-surface"]
      : []),
    ...extraBrowserArgs(env),
  ];
}
