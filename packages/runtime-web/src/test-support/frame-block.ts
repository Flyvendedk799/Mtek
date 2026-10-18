/**
 * Reading what the renderer wrote into the frame block of the fake GPU, through the offsets of the manifest's
 * layout records (a test, like the runtime, never hard-codes them).
 */
import type { MtekManifest } from "../abi/manifest-types.js";
import type { FakeBuffer } from "./fake-gpu.js";
import type { FakeHost } from "./fake-host.js";

/** The live buffer with this label (arena buffers are labelled `mtek:uniform-arena:<layout id>`). */
export function bufferLabelled(host: FakeHost, label: string): FakeBuffer {
  const found = host.device.buffers.filter((buffer) => buffer.label === label && !buffer.destroyed);
  if (found.length !== 1 || found[0] === undefined) throw new Error(`expected one live buffer '${label}', found ${String(found.length)}`);
  return found[0];
}

/** The byte offset of a top-level member, from the manifest's layout record (never hard-coded). */
export function memberOffset(manifest: MtekManifest, layoutId: string, member: string): number {
  const node = manifest.layouts.find((layout) => layout.id === layoutId)?.root.members.find((m) => m.name === member)?.node;
  if (node === undefined) throw new Error(`no member ${member} in ${layoutId}`);
  return node.offset;
}

export function floats(buffer: FakeBuffer, byteOffset: number, count: number): Float32Array {
  return new Float32Array(buffer.contents.buffer.slice(byteOffset, byteOffset + count * 4));
}

/** One `MtekLight` read back from the frame block, vectors as arrays. */
export interface ReadLight {
  readonly color: number[];
  readonly kind: number;
  readonly position: number[];
  readonly range: number;
  readonly direction: number[];
}

export const ZERO_LIGHT: ReadLight = { color: [0, 0, 0], kind: 0, position: [0, 0, 0], range: 0, direction: [0, 0, 0] };

/** `light_count` of the frame block. */
export function frameLightCount(manifest: MtekManifest, frame: FakeBuffer): number {
  const at = memberOffset(manifest, "builtin:frame", "light_count");
  return new Uint32Array(frame.contents.buffer.slice(at, at + 4))[0] ?? -1;
}

/**
 * Every `MtekLight` of the frame block, from the offsets and stride of the manifest's layout record.
 */
export function frameLights(manifest: MtekManifest, frame: FakeBuffer): ReadLight[] {
  const node = manifest.layouts.find((layout) => layout.id === "builtin:frame")?.root.members.find((m) => m.name === "lights")?.node;
  if (node?.kind !== "array" || node.element.kind !== "struct") throw new Error("the lights member is not an array of structs");
  const element = node.element;
  const at = (slot: number, member: string): number => {
    const found = element.members.find((m) => m.name === member);
    if (found === undefined) throw new Error(`no MtekLight member ${member}`);
    return node.offset + slot * node.stride + found.node.offset;
  };
  return Array.from({ length: node.length }, (_, slot) => ({
    color: Array.from(floats(frame, at(slot, "color"), 3)),
    kind: new Uint32Array(frame.contents.buffer.slice(at(slot, "kind"), at(slot, "kind") + 4))[0] ?? -1,
    position: Array.from(floats(frame, at(slot, "position"), 3)),
    range: floats(frame, at(slot, "range"), 1)[0] ?? Number.NaN,
    direction: Array.from(floats(frame, at(slot, "direction"), 3)),
  }));
}
