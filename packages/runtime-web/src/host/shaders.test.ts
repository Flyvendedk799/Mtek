import { describe, expect, it } from "vitest";
import type { MtekManifest } from "../abi/manifest-types.js";
import { ResourceRegistry } from "../gpu/registry.js";
import { asGpu } from "../test-support/fake-gpu.js";
import { FakeHostDevice, minimalManifestJson } from "../test-support/fake-host.js";
import {
  BROKEN_WGSL,
  SHADER_HASH,
  SHADER_MAP_URL,
  SHADER_URL,
  VALID_WGSL,
  spanMapJson,
  validManifest,
} from "../test-support/mount-fixture.js";
import { BASE_URL } from "../test-support/fake-host.js";
import { findSpanMapEntry, loadStartupShaders, parseSpanMap, type ShaderLoadOptions, type SpanMapEntry } from "./shaders.js";

const entry = (line: number, colStart: number, colEnd: number, span: number): SpanMapEntry => ({ wgsl: { line, colStart, colEnd }, span });

describe("parseSpanMap", () => {
  it("accepts a span map of the shader and keeps entry order and symbols", () => {
    const parsed = parseSpanMap(spanMapJson(), SHADER_HASH);
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") return;
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toEqual({ wgsl: { line: 2, colStart: 5, colEnd: 30 }, span: 1, symbol: "std/materials.mtek::Unlit.fragment" });
  });

  it("explains why a span map is unusable", () => {
    const cases: Array<[string, RegExp]> = [
      ["{ nope", /not valid JSON/],
      ["[]", /entries/],
      [JSON.stringify({ shader: "other", entries: [] }), /shader.*hash/],
      [JSON.stringify({ shader: SHADER_HASH, entries: [5] }), /not an object/],
      [JSON.stringify({ shader: SHADER_HASH, entries: [{ span: 1 }] }), /wgsl/],
      [JSON.stringify({ shader: SHADER_HASH, entries: [{ wgsl: { line: 1, colStart: 1, colEnd: 2 }, span: "x" }] }), /span/],
    ];
    for (const [text, reason] of cases) {
      const parsed = parseSpanMap(text, SHADER_HASH);
      expect(typeof parsed === "string" ? parsed : "accepted").toMatch(reason);
    }
  });
});

describe("findSpanMapEntry", () => {
  it("finds the entry covering a location (colEnd exclusive)", () => {
    const entries = [entry(3, 5, 10, 1)];
    expect(findSpanMapEntry(entries, 3, 5)?.span).toBe(1);
    expect(findSpanMapEntry(entries, 3, 9)?.span).toBe(1);
    expect(findSpanMapEntry(entries, 3, 10)).toBeUndefined();
    expect(findSpanMapEntry(entries, 3, 4)).toBeUndefined();
    expect(findSpanMapEntry(entries, 4, 5)).toBeUndefined();
  });

  it("prefers the narrowest entry and the first on a tie", () => {
    const entries = [entry(1, 1, 40, 1), entry(1, 10, 20, 2), entry(1, 12, 22, 3)];
    expect(findSpanMapEntry(entries, 1, 15)?.span).toBe(2);
    expect(findSpanMapEntry(entries, 1, 30)?.span).toBe(1);
  });
});

describe("loadStartupShaders", () => {
  function setup(files: Record<string, string | undefined>, manifest: MtekManifest = validManifest() as unknown as MtekManifest) {
    const device = new FakeHostDevice();
    const registry = new ResourceRegistry(asGpu(device));
    const fetched: string[] = [];
    const load = (extra: Partial<ShaderLoadOptions> = {}) =>
      loadStartupShaders({
        manifest,
        baseUrl: new URL(BASE_URL),
        device: asGpu(device),
        registry,
        fetch: (url) => {
          fetched.push(url);
          const text = files[url];
          return Promise.resolve({ ok: text !== undefined, status: text === undefined ? 404 : 200, text: () => Promise.resolve(text ?? "") });
        },
        ...extra,
      });
    return { device, registry, fetched, load };
  }

  it("creates one module per manifest shader and reports nothing for valid WGSL", async () => {
    const { device, registry, fetched, load } = setup({ [SHADER_URL]: VALID_WGSL, [SHADER_MAP_URL]: spanMapJson() });
    const result = await load();
    expect(result.diagnostics).toEqual([]);
    expect([...result.modules.keys()]).toEqual([SHADER_HASH]);
    expect(fetched).toEqual([SHADER_URL, SHADER_MAP_URL]);
    expect(registry.snapshot().liveShaderModules).toBe(1);
    expect(device.openErrorScopes).toBe(0);
  });

  it("builds nothing for a manifest without shaders", async () => {
    const manifest = minimalManifestJson();
    manifest["shaders"] = [];
    manifest["materials"] = [];
    const { fetched, load } = setup({}, manifest as unknown as MtekManifest);
    const result = await load();
    expect(result.modules.size).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("reports a compile error as E8051 at the span the span map names, with the WGSL position in a note", async () => {
    const { device, load } = setup({ [SHADER_URL]: BROKEN_WGSL, [SHADER_MAP_URL]: spanMapJson() });
    const result = await load();
    expect(result.diagnostics).toHaveLength(1);
    const d = result.diagnostics[0];
    expect(d?.code).toBe("MTEK-E8051");
    expect(d?.message).toContain("std/materials.mtek::Unlit");
    expect(d?.message).toContain("unexpected token");
    expect(d?.source?.startByte).toBe(40);
    expect(d?.notes).toEqual([`WGSL location: shaders/0051ea5af5b8066c.wgsl:2:16`, "generated from std/materials.mtek::Unlit.fragment.expr"]);
    // The failed module is still registered (the registry owns it) and the scope is balanced.
    expect(device.openErrorScopes).toBe(0);
  });

  it("falls back to the material declaration when no entry covers the location", async () => {
    const map = JSON.stringify({ shader: SHADER_HASH, entries: [{ wgsl: { line: 9, colStart: 1, colEnd: 5 }, span: 1 }] });
    const { load } = setup({ [SHADER_URL]: BROKEN_WGSL, [SHADER_MAP_URL]: map });
    const result = await load();
    const d = result.diagnostics[0];
    expect(d?.source?.startByte).toBe(60); // span of the material symbol
    expect(d?.notes.some((n) => n.includes("no Mtek source span maps to this WGSL location"))).toBe(true);
  });

  it("falls back and says so for an unusable span map", async () => {
    const { load } = setup({ [SHADER_URL]: BROKEN_WGSL, [SHADER_MAP_URL]: "{ nope" });
    const result = await load();
    const d = result.diagnostics[0];
    expect(d?.source?.startByte).toBe(60);
    expect(d?.notes.some((n) => n.includes("is unusable") && n.includes("showing the material declaration"))).toBe(true);
  });

  it("reports an unreachable WGSL file as E8051 and continues with the other shaders", async () => {
    const { load } = setup({ [SHADER_MAP_URL]: spanMapJson() });
    const result = await load();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("could not be loaded");
    expect(result.diagnostics[0]?.message).toContain("HTTP 404");
    expect(result.modules.size).toBe(0);
  });

  it("a later load records its phase and loads only the shaders asked for", async () => {
    const manifest = validManifest() as unknown as MtekManifest;
    const { load } = setup({ [SHADER_URL]: BROKEN_WGSL, [SHADER_MAP_URL]: spanMapJson() }, manifest);
    const reload = await load({ phase: "runtime:reload" });
    expect(reload.diagnostics.map((d) => [d.code, d.phase])).toEqual([["MTEK-E8051", "runtime:reload"]]);
    expect(reload.diagnostics[0]?.source?.startByte).toBe(40);

    const none = await setup({}, manifest).load({ shaders: [] });
    expect(none.diagnostics).toEqual([]);
    expect(none.modules.size).toBe(0);
  });

  it("is deterministic: the same inputs give identical diagnostics", async () => {
    const files = { [SHADER_URL]: BROKEN_WGSL, [SHADER_MAP_URL]: spanMapJson() };
    const first = await setup(files).load();
    const second = await setup(files).load();
    expect(JSON.stringify(first.diagnostics)).toBe(JSON.stringify(second.diagnostics));
  });
});
