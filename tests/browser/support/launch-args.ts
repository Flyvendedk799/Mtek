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
