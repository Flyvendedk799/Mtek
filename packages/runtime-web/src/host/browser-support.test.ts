import { describe, expect, it } from "vitest";
import { guessBrowser, unsupportedAdvice } from "./browser-support.js";

const UA = {
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  chromeLinux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  oldChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:152.0) Gecko/20100101 Firefox/152.0",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0",
  safari18: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  safariIos26: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
};

describe("guessBrowser", () => {
  it("tells the families and platforms apart", () => {
    expect(guessBrowser(UA.chromeWindows)).toEqual({ family: "chrome", version: 141, platform: "windows" });
    expect(guessBrowser(UA.edge)).toEqual({ family: "edge", version: 141, platform: "windows" });
    expect(guessBrowser(UA.firefoxLinux)).toEqual({ family: "firefox", version: 152, platform: "linux" });
    expect(guessBrowser(UA.safari18)).toEqual({ family: "safari", version: 18, platform: "macos" });
    expect(guessBrowser(UA.safariIos26)).toEqual({ family: "safari", version: 26, platform: "ios" });
    expect(guessBrowser("")).toEqual({ family: "other", version: undefined, platform: "other" });
  });
});

describe("unsupportedAdvice", () => {
  it("gives Firefox on Linux the about:config step", () => {
    const advice = unsupportedAdvice(guessBrowser(UA.firefoxLinux), "MTEK-E8004", true);
    expect(advice.steps.join(" ")).toContain("dom.webgpu.enabled");
  });
  it("asks an old Safari to update and an old Chrome to update", () => {
    expect(unsupportedAdvice(guessBrowser(UA.safari18), "MTEK-E8004", true).steps.join(" ")).toContain("Safari 26");
    expect(unsupportedAdvice(guessBrowser(UA.oldChrome), "MTEK-E8004", true).steps.join(" ")).toContain("113");
  });
  it("names the flags on Chrome for Linux", () => {
    expect(unsupportedAdvice(guessBrowser(UA.chromeLinux), "MTEK-E8004", true).steps.join(" ")).toContain("chrome://flags");
  });
  it("puts the secure-context step first on an http page", () => {
    const advice = unsupportedAdvice(guessBrowser(UA.chromeWindows), "MTEK-E8004", false);
    expect(advice.steps[0]).toContain("https");
  });
  it("explains a missing adapter (E8005) as a driver problem", () => {
    const advice = unsupportedAdvice(guessBrowser(UA.firefoxWindows), "MTEK-E8005", true);
    expect(advice.summary).toContain("graphics adapter");
    expect(advice.steps.join(" ")).toContain("graphics driver");
  });
  it("always lists the browsers that work", () => {
    expect(unsupportedAdvice(guessBrowser(""), "MTEK-E8004", true).supported).toContain("Safari 26");
  });
});
