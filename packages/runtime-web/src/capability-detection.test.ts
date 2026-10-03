/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// Capability detection uses navigator.gpu, requestAdapter() and the adapter's features and limits only;
// browser names are never capability evidence (spec/runtime-abi.md section 6.1).
const sources = import.meta.glob<string>(["./**/*.ts", "!./**/*.test.ts", "!./test-support/**", "!./abi/generated/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("capability detection", () => {
  it("scans the runtime sources", () => {
    expect(Object.keys(sources)).toContain("./host/mount.ts");
    expect(Object.keys(sources)).toContain("./gpu/device.ts");
  });

  it("never reads the user agent or other browser identification", () => {
    const forbidden = /userAgent|userAgentData|navigator\.(vendor|platform|appVersion|appName)|\bnavigator\.product\b/;
    const offenders = Object.entries(sources)
      .filter(([, text]) => forbidden.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
