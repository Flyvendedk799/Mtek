// Shapes of the environment record (spec/testing.md section 6.1). The JSON Schema in
// `environment.schema.json` is the normative description; these types mirror it.

/** Size of the fixed offscreen render target used by browser tests (spec/testing.md section 6.3). */
export const RENDER_TARGET_SIZE = { width: 128, height: 128 } as const;

/** `GPUAdapterInfo` as recorded (every field is a string except `isFallbackAdapter`). */
export interface AdapterInfoRecord {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  isFallbackAdapter: boolean;
}

export interface AdapterRecord {
  info: AdapterInfoRecord;
  /** Features the adapter supports. */
  adapterFeatures: string[];
  /** Features enabled on the probe device (the probe requests none). */
  deviceFeatures: string[];
  /** The adapter limits Mtek relies on. */
  limits: Record<string, number>;
}

/** What the page-side probe (`env-probe.ts`) can learn without Node. */
export interface PageEnvironment {
  userAgent: string;
  devicePixelRatio: number;
  renderTargetSize: { width: number; height: number };
  gpu: {
    /** `navigator.gpu` exists. */
    navigatorGpu: boolean;
    /** Why no adapter is available, or null when there is one. */
    reason: string | null;
    adapter: AdapterRecord | null;
    wgslLanguageFeatures: string[];
  };
}

export interface EnvironmentRecord extends PageEnvironment {
  schemaVersion: 1;
  /** Playwright project name (`hardware` or `software`). */
  project: string;
  recordedAt: string;
  os: { platform: string; release: string; version: string; arch: string };
  browser: {
    name: string;
    /** Playwright `channel` (`chromium` = new headless mode, `chrome` = installed Google Chrome). */
    channel: string;
    version: string;
    headless: boolean;
    /** The launch arguments configured by the project (Playwright's own defaults are not listed). */
    launchArgs: string[];
  };
  source: { gitCommit: string; gitDirty: boolean };
  toolchain: {
    rustc: string;
    naga: string;
    node: string;
    playwright: string;
    runtimeWeb: string;
  };
  settings: { requireGpu: boolean; acceptSoftware: boolean };
}
