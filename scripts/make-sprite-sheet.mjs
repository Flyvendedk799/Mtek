// Eight explicit star frames for sprite-pop. No external images or dependencies.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

function chunk(name, data) {
  const body = Buffer.concat([Buffer.from(name), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, body, checksum]);
}

const cell = 32, width = cell * 4, height = cell * 2;
const pixels = Buffer.alloc(height * (1 + width * 4));
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const frame = Math.floor(y / cell) * 4 + Math.floor(x / cell);
    const dx = (x % cell) - 15.5, dy = (y % cell) - 15.5;
    const radius = 4 + frame * 1.3;
    const angle = Math.atan2(dy, dx) + frame * Math.PI / 16;
    const edge = radius * (0.72 + 0.28 * Math.cos(angle * 5));
    const index = y * (1 + width * 4) + 1 + x * 4;
    if (Math.hypot(dx, dy) <= edge) {
      pixels.set([255, 240 - frame * 16, 64 + frame * 20, 255], index);
    }
  }
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 6;
const directory = resolve(import.meta.dirname, "../examples/sprite-pop/textures");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "star.png"), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
]));
