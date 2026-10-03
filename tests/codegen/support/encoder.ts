// The independent encoder of the cross-check (spec/testing.md section 4.2).
//
// It serialises a CPU value into a block by walking the layout record's `LayoutNode` tree
// recursively and writing every leaf through a `DataView` at an absolute byte address,
// little-endian. It deliberately shares nothing with the generated writers: no word indices,
// no typed-array views, no per-field functions, and it never imports generated code. The only
// inputs are the record and the value.
import {
  type CpuValue,
  element,
  expectBoolean,
  expectNumber,
  property,
} from "./cpu-value.js";
import {
  type LayoutNode,
  type LayoutRecord,
  type ScalarKind,
  componentNames,
  elementType,
} from "./layout.js";

function writeScalar(view: DataView, address: number, scalar: ScalarKind, value: CpuValue | undefined, where: string): void {
  switch (scalar) {
    case "f32":
      view.setFloat32(address, expectNumber(value, where), true);
      return;
    case "i32":
      view.setInt32(address, expectNumber(value, where), true);
      return;
    case "u32":
      view.setUint32(address, expectNumber(value, where), true);
      return;
    case "bool32":
      view.setUint32(address, expectBoolean(value, where) ? 1 : 0, true);
      return;
  }
}

/**
 * Writes `value` for `node`. `origin` is the absolute byte address that `node.offset` is
 * relative to: the block start for struct members (their offsets are absolute within the
 * block), and the start of the current element inside an array.
 */
function encodeNode(
  view: DataView,
  node: LayoutNode,
  value: CpuValue | undefined,
  origin: number,
  mtekType: string,
  where: string,
): void {
  const address = origin + node.offset;
  switch (node.kind) {
    case "scalar":
      writeScalar(view, address, node.scalar, value, where);
      return;
    case "vector": {
      componentNames(mtekType, node.components).forEach((name, index) => {
        writeScalar(
          view,
          address + 4 * index,
          node.scalar,
          property(value, name, where),
          `${where}.${name}`,
        );
      });
      return;
    }
    case "matrix": {
      for (let column = 0; column < node.columns; column++) {
        for (let row = 0; row < node.rows; row++) {
          const index = column * node.rows + row;
          writeScalar(
            view,
            address + column * node.columnStride + 4 * row,
            "f32",
            element(value, index, where),
            `${where}[${index}]`,
          );
        }
      }
      return;
    }
    case "struct":
      for (const member of node.members) {
        encodeNode(
          view,
          member.node,
          property(value, member.name, where),
          origin,
          member.mtekType,
          `${where}.${member.name}`,
        );
      }
      return;
    case "array": {
      const inner = elementType(mtekType);
      for (let index = 0; index < node.length; index++) {
        encodeNode(
          view,
          node.element,
          element(value, index, where),
          address + index * node.stride,
          inner,
          `${where}[${index}]`,
        );
      }
      return;
    }
  }
}

/** Serialises `value` into a fresh, zeroed block of `record.size` bytes. */
export function encodeBlock(record: LayoutRecord, value: CpuValue): Uint8Array {
  const bytes = new Uint8Array(record.size);
  const view = new DataView(bytes.buffer);
  encodeNode(view, record.root, value, 0, record.root.name, "v");
  return bytes;
}
