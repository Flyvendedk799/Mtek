// The network restriction of untrusted previews (spec/ai-and-benchmarks.md section 5, decision 0075): a preview
// manifest (`preview` object) makes the runtime request nothing outside `baseUrl`. Every URL the runtime builds is
// `baseUrl` plus a relative name the manifest schema constrains (`shaders/<h16>.wgsl`, `assets/<h16>.<ext>`,
// `physics/<h16>.js`), so no healthy program can reach the refusal; what these tests pin down is the guard itself, the one
// place every request passes through, and that the mount applies it exactly when the manifest says preview.
import { describe, expect, it } from "vitest";
import { checkManifest } from "../abi/validate.js";
import { MtekMountError } from "../diagnostics/types.js";
import { BASE_URL, FakeHost, MANIFEST_URL, asDom, fakeProgram, minimalManifestJson } from "../test-support/fake-host.js";
import { SHADER_MAP_URL, SHADER_URL, installProgram } from "../test-support/mount-fixture.js";
import { NetworkRefusedError, isWithinBase, restrictToBase, type HostEnvironment } from "./environment.js";
import { mountMtekWith } from "./mount.js";

const BASE = new URL("https://example.test/app/dist/");

describe("isWithinBase", () => {
  it("accepts files below the base, relative or absolute, with a query or a fragment", () => {
    for (const url of [
      "program.manifest.json",
      "./shaders/0123456789abcdef.wgsl",
      "https://example.test/app/dist/assets/0123456789abcdef.png",
      "https://example.test/app/dist/physics/0123456789abcdef.js?v=1#x",
      "https://example.test/app/dist/a/./b/../c.bin",
      "https://EXAMPLE.test/app/dist/x",
    ]) {
      expect(isWithinBase(url, BASE), url).toBe(true);
    }
  });

  it("refuses everything else: other origins, schemes, ports, paths, traversal, credentials, data and blob URLs", () => {
    for (const url of [
      "https://evil.test/app/dist/x",
      "http://example.test/app/dist/x",
      "https://example.test:8443/app/dist/x",
      "https://example.test/app/other/x",
      "https://example.test/app/dist",
      "https://example.test/app/distant/x",
      "https://example.test/x",
      "../x",
      "../dist-two/x",
      "/x",
      "//evil.test/app/dist/x",
      "https://example.test/app/dist/../x",
      "https://example.test/app/dist/%2e%2e/x",
      "https://example.test/app/dist/a%2F..%2Fx",
      "https://example.test/app/dist/a%5Cx",
      "https://user:password@example.test/app/dist/x",
      "https://user@example.test/app/dist/x",
      "data:text/javascript,1",
      "blob:https://example.test/0000",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://",
    ]) {
      expect(isWithinBase(url, BASE), url).toBe(false);
    }
  });

  it("takes a base without a trailing slash as the directory of that name", () => {
    expect(isWithinBase("https://example.test/app/dist/x", new URL("https://example.test/app/dist"))).toBe(true);
    expect(isWithinBase("https://example.test/app/distant/x", new URL("https://example.test/app/dist"))).toBe(false);
  });

  it("compares file URLs by scheme, host and path like any other", () => {
    expect(isWithinBase("file:///project/dist/app.js", new URL("file:///project/dist/"))).toBe(true);
    expect(isWithinBase("file:///project/other/app.js", new URL("file:///project/dist/"))).toBe(false);
  });
});

function recordingEnvironment(): { environment: HostEnvironment; calls: string[] } {
  const calls: string[] = [];
  const host = new FakeHost();
  const environment: HostEnvironment = {
    ...host.environment,
    fetch: (url) => {
      calls.push(`fetch ${url}`);
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") });
    },
    fetchBytes: (url) => {
      calls.push(`fetchBytes ${url}`);
      return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    },
    importModule: (url) => {
      calls.push(`importModule ${url}`);
      return Promise.resolve({});
    },
  };
  return { environment, calls };
}

describe("restrictToBase", () => {
  it("passes requests below the base through, untouched", async () => {
    const { environment, calls } = recordingEnvironment();
    const restricted = restrictToBase(environment, BASE);
    const inside = "https://example.test/app/dist/shaders/0123456789abcdef.wgsl";
    await restricted.fetch(inside);
    await restricted.fetchBytes(inside);
    await restricted.importModule("https://example.test/app/dist/physics/0123456789abcdef.js");
    expect(calls).toEqual([`fetch ${inside}`, `fetchBytes ${inside}`, "importModule https://example.test/app/dist/physics/0123456789abcdef.js"]);
  });

  it("rejects requests outside the base before they are made, whichever door they use", async () => {
    const { environment, calls } = recordingEnvironment();
    const restricted = restrictToBase(environment, BASE);
    const outside = "https://evil.test/steal?cookie=1";
    for (const request of [() => restricted.fetch(outside), () => restricted.fetchBytes(outside), () => restricted.importModule(outside)]) {
      const error: unknown = await request().then(
        () => undefined,
        (rejection: unknown) => rejection,
      );
      expect(error).toBeInstanceOf(NetworkRefusedError);
      expect((error as NetworkRefusedError).url).toBe(outside);
      expect((error as Error).message).toContain("refused https://evil.test/steal?cookie=1");
      expect((error as Error).message).toContain(BASE.href);
    }
    expect(calls).toEqual([]);
  });

  it("keeps everything else of the environment", () => {
    const { environment } = recordingEnvironment();
    const restricted = restrictToBase(environment, BASE);
    expect(restricted.gpu).toBe(environment.gpu);
    expect(Object.keys(restricted).sort()).toEqual(Object.keys(environment).sort());
    // The three doors are the only members that changed.
    const changed = Object.keys(environment).filter((key) => (restricted as unknown as Record<string, unknown>)[key] !== (environment as unknown as Record<string, unknown>)[key]);
    expect(changed.sort()).toEqual(["fetch", "fetchBytes", "importModule"]);
  });
});

function previewHost(options: { preview: boolean }): FakeHost {
  const host = new FakeHost();
  installProgram(host, (json) => {
    if (options.preview) json["preview"] = { loopBudget: 1000 };
  });
  return host;
}

describe("the mount of a preview", () => {
  it("makes exactly the requests of any other mount, all below baseUrl", async () => {
    for (const preview of [false, true]) {
      const host = previewHost({ preview });
      const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), fakeProgram());
      expect(host.fetched, `preview ${String(preview)}`).toEqual([MANIFEST_URL, SHADER_URL, SHADER_MAP_URL]);
      expect(host.fetched.every((url) => isWithinBase(url, new URL(BASE_URL)))).toBe(true);
      app.dispose();
    }
  });

  it("refuses a manifest that was fetched from outside the base of the program, and requests nothing more", async () => {
    const host = previewHost({ preview: true });
    // A program module whose directory is not the one its manifest is in: an inconsistent (or hostile) module.
    const program = { ...fakeProgram(), baseUrl: new URL("elsewhere/", BASE_URL) };
    let error: unknown;
    try {
      await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), program);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MtekMountError);
    const failure = error as MtekMountError;
    expect(failure.kind).toBe("manifest-invalid");
    expect(failure.diagnostics.map((d) => d.code)).toEqual(["MTEK-E8006"]);
    expect(failure.diagnostics[0]?.message).toContain("outside baseUrl");
    expect(host.fetched).toEqual([MANIFEST_URL]);
    expect(host.document.body.find("data-mtek-overlay")?.textContent).toContain("MTEK-E8006");
  });

  it("does not restrict a build that is not a preview", async () => {
    const host = previewHost({ preview: false });
    const program = { ...fakeProgram(), baseUrl: new URL("elsewhere/", BASE_URL) };
    host.files.set(`${BASE_URL}elsewhere/shaders/0051ea5af5b8066c.wgsl`, host.files.get(SHADER_URL) ?? "");
    host.files.set(`${BASE_URL}elsewhere/shaders/0051ea5af5b8066c.mtek-map.json`, host.files.get(SHADER_MAP_URL) ?? "");
    const app = await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), program);
    expect(app.state).toBe("running");
    app.dispose();
  });

  it("is told by the manifest alone: a preview object that does not validate fails the mount as an invalid manifest", async () => {
    const host = new FakeHost();
    installProgram(host, (json) => {
      json["preview"] = { loopBudget: 0 };
    });
    let error: unknown;
    try {
      await mountMtekWith(host.environment, asDom<HTMLCanvasElement>(host.canvas), fakeProgram());
    } catch (caught) {
      error = caught;
    }
    expect((error as MtekMountError).kind).toBe("manifest-invalid");
    expect(checkManifest({ ...minimalManifestJson(), preview: { loopBudget: 1 } }).ok).toBe(true);
    expect(checkManifest({ ...minimalManifestJson(), preview: { loopBudget: 0 } }).ok).toBe(false);
    expect(checkManifest({ ...minimalManifestJson(), preview: {} }).ok).toBe(false);
    expect(checkManifest({ ...minimalManifestJson(), preview: { loopBudget: 1, network: "open" } }).ok).toBe(false);
  });
});
