// A minimal PNG writer and reader for the pictures of the runtime benchmark: 8-bit RGBA, filter type 0 on every row, one IDAT
// chunk. The reader accepts exactly what the writer produces (and says so otherwise), so the parity pictures stored with
// the raw results can be read back by the report generator without a dependency.
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array, level = 6): Buffer {
  const stride = width * 4 + 1;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * stride] = 0;
    rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(rows, { level })), chunk("IEND", Buffer.alloc(0))]);
}

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error("only non-interlaced 8-bit RGBA PNGs are supported");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  if (raw.length !== stride * height) throw new Error("unexpected PNG data length");
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    if (raw[y * stride] !== 0) throw new Error("only PNGs with filter type 0 are supported");
    rgba.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * width * 4);
  }
  return { width, height, rgba };
}
