/**
 * The "unsupported browser" screen (decision 0132). Mtek renders with WebGPU only; a browser without it
 * fails the mount with `E8004` (no `navigator.gpu`) or `E8005` (no adapter). Instead of only the technical
 * diagnostic, the failure overlay then tells a player what to do in plain words, for the browser they use.
 *
 * The user agent is read **only to choose the advice text**. Whether Mtek runs is still decided by WebGPU
 * itself (`navigator.gpu`, `requestAdapter`, features and limits; `spec/runtime-abi.md` section 8.1), never
 * by the browser's name or version.
 */

/** The browser families the advice knows; `other` gets the generic text. */
export type BrowserFamily = "chrome" | "edge" | "firefox" | "safari" | "other";

/** The operating systems the advice distinguishes. */
export type BrowserPlatform = "windows" | "macos" | "linux" | "android" | "ios" | "chromeos" | "other";

export interface BrowserGuess {
  readonly family: BrowserFamily;
  /** The major version, when the user agent names one. */
  readonly version: number | undefined;
  readonly platform: BrowserPlatform;
}

/** The codes that mean "this browser cannot run WebGPU here", as opposed to a defect of the program. */
export const UNSUPPORTED_BROWSER_CODES: readonly string[] = ["MTEK-E8004", "MTEK-E8005"];

/** What to show: a title, a short explanation, the steps for this browser, and the browsers that work. */
export interface UnsupportedAdvice {
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly supported: string;
}

function major(match: RegExpExecArray | null): number | undefined {
  const text = match?.[1];
  if (text === undefined) return undefined;
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : undefined;
}

/** A best guess from a user agent string; anything unknown is `other`. */
export function guessBrowser(userAgent: string): BrowserGuess {
  const ua = userAgent;
  let platform: BrowserPlatform = "other";
  if (/iPhone|iPad|iPod/.test(ua)) platform = "ios";
  else if (/Android/.test(ua)) platform = "android";
  else if (/CrOS/.test(ua)) platform = "chromeos";
  else if (/Windows/.test(ua)) platform = "windows";
  else if (/Mac OS X|Macintosh/.test(ua)) platform = "macos";
  else if (/Linux|X11/.test(ua)) platform = "linux";

  // Order matters: Edge and Chrome both say "Safari", Edge says "Chrome", iOS browsers are all WebKit.
  if (/Edg(?:e|A|iOS)?\/(\d+)/.test(ua)) return { family: "edge", version: major(/Edg(?:e|A|iOS)?\/(\d+)/.exec(ua)), platform };
  if (/Firefox\/(\d+)/.test(ua) || /FxiOS\/(\d+)/.test(ua)) {
    return { family: "firefox", version: major(/Firefox\/(\d+)/.exec(ua) ?? /FxiOS\/(\d+)/.exec(ua)), platform };
  }
  if (/(?:Chrome|CriOS|Chromium)\/(\d+)/.test(ua)) return { family: "chrome", version: major(/(?:Chrome|CriOS|Chromium)\/(\d+)/.exec(ua)), platform };
  if (/Safari\//.test(ua) && /Version\/(\d+)/.test(ua)) return { family: "safari", version: major(/Version\/(\d+)/.exec(ua)), platform };
  return { family: "other", version: undefined, platform };
}

const SUPPORTED =
  "WebGPU works in current Chrome and Edge (Windows, macOS, ChromeOS, Android), Safari 26 or newer (macOS, iPhone, iPad), and Firefox on Windows and Apple-silicon Macs.";

/**
 * The advice for a browser that failed with `code` (`MTEK-E8004` or `MTEK-E8005`). `secureContext` is
 * `window.isSecureContext`: WebGPU exists only on https pages and on localhost.
 */
export function unsupportedAdvice(guess: BrowserGuess, code: string, secureContext: boolean): UnsupportedAdvice {
  const steps: string[] = [];
  if (!secureContext) {
    steps.push("Open this page over https (or from localhost): browsers offer WebGPU only to secure pages.");
  }
  const noAdapter = code === "MTEK-E8005";
  if (noAdapter) {
    steps.push("Your browser has WebGPU, but it found no usable graphics adapter. Update your graphics driver, make sure hardware acceleration is on in the browser's settings, and restart the browser.");
  }
  switch (guess.family) {
    case "chrome":
    case "edge": {
      const name = guess.family === "edge" ? "Edge" : "Chrome";
      if (guess.version !== undefined && guess.version < 113) steps.push(`Update ${name}: WebGPU needs version 113 or newer (this is ${String(guess.version)}).`);
      if (guess.platform === "linux") {
        steps.push(`On Linux, ${name} enables WebGPU only for some graphics cards. Open ${guess.family === "edge" ? "edge" : "chrome"}://flags, enable "Unsafe WebGPU Support" and "Vulkan", and restart.`);
      } else if (guess.platform === "android") {
        steps.push(`On Android, WebGPU needs ${name} 121 or newer and Android 12 or newer.`);
      } else if (!noAdapter) {
        steps.push(`Make sure "Use graphics acceleration when available" is on in ${name}'s settings, then restart ${name}.`);
      }
      break;
    }
    case "firefox":
      if (guess.platform === "windows" || guess.platform === "macos") {
        steps.push("Update Firefox: WebGPU is on by default from Firefox 141 on Windows and Firefox 147 on Macs with Apple silicon.");
        if (guess.platform === "macos") steps.push("On an Intel Mac, Firefox does not turn WebGPU on yet; use Safari 26 or Chrome.");
      } else {
        steps.push('Firefox does not turn WebGPU on by default here yet. Type about:config in the address bar, set "dom.webgpu.enabled" to true and restart Firefox, or use Chrome.');
      }
      break;
    case "safari":
      if (guess.version !== undefined && guess.version < 26) {
        steps.push(`Update to Safari 26 or newer (macOS 26, iOS 26 or iPadOS 26), where WebGPU is on by default (this is Safari ${String(guess.version)}). On an older Safari you can try Develop > Feature Flags > WebGPU.`);
      } else if (!noAdapter) {
        steps.push("Check that WebGPU is not switched off: Develop > Feature Flags > WebGPU on a Mac, or Settings > Apps > Safari > Advanced > Feature Flags on an iPhone or iPad.");
      }
      break;
    case "other":
      steps.push("Try a current Chrome, Edge or Safari.");
      break;
  }
  return {
    title: "This browser cannot show this game",
    summary: noAdapter
      ? "The game draws with WebGPU, and the browser could not find a graphics adapter for it."
      : "The game draws with WebGPU, which this browser does not offer here.",
    steps,
    supported: SUPPORTED,
  };
}
