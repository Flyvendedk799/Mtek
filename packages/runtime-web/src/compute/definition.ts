/** Internal compute resource contract. Public packaging/dispatch remain gated until
 * manifest, mounted lifetime and source-to-GPU validation are connected. */
import type { MtekLayoutArrayNode, MtekLayoutNode, MtekLayoutRecord } from "../abi/manifest-types.js";

export interface ComputeBufferDefinition {
  readonly name: string;
  readonly layout: MtekLayoutArrayNode;
}

export interface ComputeDefinition {
  readonly id: string;
  readonly entryPoint: string;
  readonly workgroupSize: readonly [number, number, number];
  readonly dispatch: MtekLayoutRecord;
  readonly uniforms?: MtekLayoutRecord;
  readonly inputs: readonly ComputeBufferDefinition[];
  readonly output: ComputeBufferDefinition;
}

export type ComputeDomain = readonly [number, number?, number?];

const MAX_STORAGE_BYTES = 16 * 1024 * 1024;
const MAX_LAYOUT_NODES = 16_384;

function integer(value: number, minimum: number, maximum: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`compute: ${field} must be an integer in [${minimum}, ${maximum}]`);
  }
}

/** Validate bounds using the compiler's offsets/strides, without deriving a new layout. */
function checkLayout(root: MtekLayoutNode, maxBytes: number): void {
  let remaining = MAX_LAYOUT_NODES;
  const visit = (node: MtekLayoutNode, low: number, high: number, depth: number): void => {
    if (--remaining < 0 || depth > 256) throw new RangeError("compute: layout complexity exceeds the source profile");
    integer(node.offset, low, high, "layout offset");
    integer(node.size, 4, maxBytes, "layout size");
    integer(node.align, 4, 16, "layout alignment");
    if (![4, 8, 16].includes(node.align) || node.size % 4 !== 0 || node.offset % node.align !== 0 || node.offset + node.size > high) {
      throw new RangeError("compute: layout node exceeds its enclosing storage or alignment");
    }
    switch (node.kind) {
      case "scalar":
        if (node.size !== 4 || !["f32", "i32", "u32", "bool32"].includes(node.scalar)) throw new RangeError("compute: invalid scalar layout");
        break;
      case "vector":
        if (![2, 3, 4].includes(node.components) || node.scalar !== "f32" || node.size !== node.components * 4) throw new RangeError("compute: invalid vector layout");
        break;
      case "matrix":
        if (node.columns !== 4 || node.rows !== 4 || node.columnStride !== 16 || node.size !== 64) throw new RangeError("compute: invalid matrix layout");
        break;
      case "array":
        integer(node.length, 1, 4_194_304, "array length");
        integer(node.stride, 4, maxBytes, "array stride");
        if (node.size !== node.stride * node.length || node.stride % node.align !== 0 || node.element.offset !== 0) throw new RangeError("compute: invalid array extent");
        visit(node.element, 0, node.stride, depth + 1);
        break;
      case "struct": {
        if (node.members.length === 0) throw new RangeError("compute: empty storage struct");
        const names = new Set<string>();
        let end = node.offset;
        for (const member of node.members) {
          if (member.name.length === 0 || names.has(member.name) || member.node.offset < end) throw new RangeError("compute: duplicate or overlapping struct member");
          names.add(member.name);
          visit(member.node, node.offset, node.offset + node.size, depth + 1);
          end = member.node.offset + member.node.size;
        }
        break;
      }
    }
  };
  visit(root, 0, maxBytes, 0);
}

function checkUniform(layout: MtekLayoutRecord, device: ComputeLimits): void {
  integer(layout.size, 4, Math.min(65_536, device.maxUniformBufferBindingSize, device.maxBufferSize), "uniform size");
  if (layout.root.kind !== "struct" || layout.root.offset !== 0 || layout.root.size !== layout.size || layout.align !== layout.root.align) throw new RangeError("compute: invalid uniform block");
  checkLayout(layout.root, layout.size);
}

export type ComputeLimits = Pick<GPUSupportedLimits,
  "maxBufferSize" | "maxStorageBufferBindingSize" | "maxUniformBufferBindingSize" |
  "maxComputeWorkgroupSizeX" | "maxComputeWorkgroupSizeY" | "maxComputeWorkgroupSizeZ" |
  "maxComputeInvocationsPerWorkgroup" | "maxComputeWorkgroupsPerDimension" |
  "maxStorageBuffersPerShaderStage" | "maxUniformBuffersPerShaderStage" | "maxBindingsPerBindGroup"
>;

/** Own the definition so callers cannot mutate validation results while work is pending. */
export function checkedDefinition(source: ComputeDefinition, limits: ComputeLimits): ComputeDefinition {
  // Check graph bounds before cloning: invalid cyclic/deep layouts cannot exhaust clone's stack.
  if (source.id.length === 0 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(source.entryPoint)) throw new RangeError("compute: invalid kernel identity");
  if (source.inputs.length > 4 || source.inputs.length + 1 > limits.maxStorageBuffersPerShaderStage || source.inputs.length + 3 > limits.maxBindingsPerBindGroup) throw new RangeError("compute: device storage binding limit exceeded");
  if ((source.uniforms === undefined ? 1 : 2) > limits.maxUniformBuffersPerShaderStage) throw new RangeError("compute: device uniform binding limit exceeded");
  const maxima = [Math.min(256, limits.maxComputeWorkgroupSizeX), Math.min(256, limits.maxComputeWorkgroupSizeY), Math.min(64, limits.maxComputeWorkgroupSizeZ)];
  if (source.workgroupSize.length !== 3) throw new RangeError("compute: workgroup must have three axes");
  for (let i = 0; i < 3; i++) integer(source.workgroupSize[i]!, 1, maxima[i]!, "workgroup axis");
  const total = source.workgroupSize.reduce((product, axis) => product * axis, 1);
  if (total > Math.min(256, limits.maxComputeInvocationsPerWorkgroup)) throw new RangeError("compute: workgroup invocation limit exceeded");
  checkUniform(source.dispatch, limits);
  const fields = source.dispatch.root.members;
  if (fields.length !== 3 || fields.some((field, i) => field.name !== ["x", "y", "z"][i] || field.node.kind !== "scalar" || field.node.scalar !== "u32")) throw new RangeError("compute: dispatch layout must contain x/y/z u32 fields");
  if (source.uniforms !== undefined) checkUniform(source.uniforms, limits);
  const names = new Set<string>();
  for (const buffer of [...source.inputs, source.output]) {
    if (buffer.name.length === 0 || names.has(buffer.name)) throw new RangeError("compute: duplicate resource name");
    names.add(buffer.name);
    if (buffer.layout.kind !== "array" || buffer.layout.padded || buffer.layout.offset !== 0) throw new RangeError("compute: resource must be a packed outer array");
    integer(buffer.layout.size, 4, Math.min(MAX_STORAGE_BYTES, limits.maxBufferSize, limits.maxStorageBufferBindingSize), "storage size");
    checkLayout(buffer.layout, buffer.layout.size);
  }
  return structuredClone(source);
}

export function checkedDomain(domain: ComputeDomain, definition: ComputeDefinition, limits: ComputeLimits): { domain: [number, number, number]; groups: [number, number, number] } {
  if (!Array.isArray(domain) || domain.length < 1 || domain.length > 3) throw new RangeError("compute: dispatch needs one to three logical axes");
  const axes: [number, number, number] = [domain[0], domain[1] === undefined ? 1 : domain[1], domain[2] === undefined ? 1 : domain[2]];
  for (const axis of axes) integer(axis, 1, 0xffff_ffff, "logical axis");
  const count = axes.reduce((product, axis) => product * axis, 1);
  if (!Number.isSafeInteger(count) || count > Math.min(0xffff_ffff, definition.output.layout.length)) throw new RangeError("compute: logical domain exceeds the output capacity");
  const groups = axes.map((axis, i) => Math.ceil(axis / definition.workgroupSize[i]!)) as [number, number, number];
  for (const group of groups) integer(group, 1, limits.maxComputeWorkgroupsPerDimension, "dispatch workgroup count");
  return { domain: axes, groups };
}

/** Packed uploads always copy exactly a resource/block's bytes; no external view is retained. */
export function copiedBytes(source: ArrayBufferView, size: number): Uint8Array<ArrayBuffer> {
  if (!ArrayBuffer.isView(source) || source.byteLength !== size) throw new RangeError(`compute: upload must contain exactly ${size} bytes`);
  return Uint8Array.from(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
}
