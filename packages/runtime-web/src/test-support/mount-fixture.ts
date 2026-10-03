/** Helpers shared by the host tests: install a program into a `FakeHost` and mount it. */
import { mountMtekWith } from "../host/mount.js";
import type { MtekApp, MtekMountOptions } from "../host/types.js";
import { BASE_URL, FakeHost, asDom, fakeProgram, minimalManifestJson, MANIFEST_URL } from "./fake-host.js";

export const SHADER_HASH = "0051ea5af5b8066c7e8248c918c4018308f9585f2b2717aef41141532bfb283d";
export const SHADER_URL = `${BASE_URL}shaders/0051ea5af5b8066c.wgsl`;
export const SHADER_MAP_URL = `${BASE_URL}shaders/0051ea5af5b8066c.mtek-map.json`;
export const MATERIAL = "std/materials.mtek::Unlit";

export const VALID_WGSL = "// generated\nfn mtek_vs() {}\n";

/** Line 2 of the broken shader: the `@@error` marker is at column 16. */
export const BROKEN_WGSL = "// generated\n    let x = 1; @@error unexpected token\n";

export function spanMapJson(shader: string = SHADER_HASH): string {
  return JSON.stringify({
    shader,
    entries: [
      { wgsl: { line: 2, colStart: 5, colEnd: 30 }, span: 1, symbol: `${MATERIAL}.fragment` },
      { wgsl: { line: 2, colStart: 14, colEnd: 20 }, span: 2, symbol: `${MATERIAL}.fragment.expr` },
    ],
  });
}

/** A valid manifest (the shared minimal example plus the material symbol the shader diagnostics resolve). */
export function validManifest(): Record<string, unknown> {
  const manifest = minimalManifestJson();
  (manifest["symbols"] as unknown[]).push({ id: MATERIAL, kind: "material", span: 3 });
  return manifest;
}

/** Puts the manifest and the shader files of a healthy program on the fake server. */
export function installProgram(host: FakeHost, edit?: (manifest: Record<string, unknown>) => void): Record<string, unknown> {
  const manifest = validManifest();
  edit?.(manifest);
  host.files.set(MANIFEST_URL, JSON.stringify(manifest));
  host.files.set(SHADER_URL, VALID_WGSL);
  host.files.set(SHADER_MAP_URL, spanMapJson());
  return manifest;
}

export function mountOn<I = Record<string, unknown>>(host: FakeHost, options?: MtekMountOptions<I>): Promise<MtekApp<I>> {
  return mountMtekWith<I>(host.environment, asDom<HTMLCanvasElement>(host.canvas), fakeProgram(), options);
}

/** A healthy host with the program installed. */
export function healthyHost(): FakeHost {
  const host = new FakeHost();
  installProgram(host);
  return host;
}
