// Generates the asset fixtures of tests/assets (spec/assets.md section 7, decision 0058).
//
// Every file is built from explicit data in this script: no model was downloaded or exported, so
// the expected vertex values, transforms and image texels are known by construction. The
// supported project (`pass/assets_supported`) holds a multi-mesh GLB; every other project under
// `fail/` breaks exactly one row of the profile table (spec/assets.md section 3) or one rule of
// the declarations (section 2), and `expected.diag.json` next to it holds the exact diagnostics.
//
//   node tests/assets/tools/make-glb.mjs           write the files
//   node tests/assets/tools/make-glb.mjs --check   fail if a file on disk differs (npm run check)
//
// The output is byte-for-byte deterministic: no timestamps, a fixed zlib level.

import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Binary helpers
// ---------------------------------------------------------------------------

const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const SHORT = 5122;

function f32(...values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}
function u32(...values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeUInt32LE(value, index * 4));
  return buffer;
}
function u16(...values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}
function i16(...values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeInt16LE(value, index * 2));
  return buffer;
}
function u8(...values) {
  return Buffer.from(values);
}

const pad4 = (length) => (4 - (length % 4)) % 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** A PNG of `width` x `height` RGBA texels; `texels` is an array of [r, g, b, a], row by row. */
function png(width, height, texels) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const texel = texels[y * width + x];
      for (let c = 0; c < 4; c += 1) row[1 + x * 4 + c] = texel[c];
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A 1-bit grey PNG: large dimensions at a few kilobytes (every pixel black). */
function bigPng(width, height) {
  const row = Buffer.alloc(1 + Math.ceil(width / 8));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 1;
  header[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * An 8 x 8 baseline JPEG of one flat grey level: a valid image that any decoder opens. One
 * quantisation table of 16s, a Huffman table with the single DC category the level needs and an
 * AC table that holds only the end-of-block code, so the scan is two bytes.
 */
function jpegGrey(level) {
  const dc = Math.round((8 * (level - 128)) / 16);
  const category = dc === 0 ? 0 : Math.floor(Math.log2(Math.abs(dc))) + 1;
  const bits = dc >= 0 ? dc : dc + (1 << category) - 1;
  // Code '0' for the DC category, `category` bits of value, code '0' for end-of-block.
  const stream = (bits << 1) & ((1 << (category + 2)) - 1);
  const total = category + 2;
  const scan = Buffer.alloc(1);
  scan[0] = (stream << (8 - total)) | ((1 << (8 - total)) - 1);
  const segment = (marker, body) => {
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(body.length + 2, 2);
    return Buffer.concat([head, body]);
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xdb, Buffer.concat([u8(0), Buffer.alloc(64, 16)])),
    segment(0xc0, u8(8, 0, 8, 0, 8, 1, 1, 0x11, 0)),
    segment(0xc4, Buffer.concat([u8(0x00), u8(1, ...Array(15).fill(0)), u8(category)])),
    segment(0xc4, Buffer.concat([u8(0x10), u8(1, ...Array(15).fill(0)), u8(0)])),
    segment(0xda, u8(1, 1, 0x00, 0, 63, 0)),
    scan,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A binary glTF from its JSON text and BIN bytes (`bin` may be null: no BIN chunk). */
function glbBytes(jsonText, bin) {
  const json = Buffer.from(jsonText, "utf8");
  const jsonPadded = Buffer.concat([json, Buffer.alloc(pad4(json.length), 0x20)]);
  const binPadded = bin ? Buffer.concat([bin, Buffer.alloc(pad4(bin.length))]) : null;
  const total = 12 + 8 + jsonPadded.length + (binPadded ? 8 + binPadded.length : 0);
  const parts = [u32(0x46546c67, 2, total), u32(jsonPadded.length, 0x4e4f534a), jsonPadded];
  if (binPadded) parts.push(u32(binPadded.length, 0x004e4942), binPadded);
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// A small model builder
// ---------------------------------------------------------------------------

class Model {
  constructor() {
    this.json = {
      asset: { version: "2.0", generator: "mtek tests/assets/tools/make-glb.mjs" },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      materials: [],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }],
    };
    this.parts = [];
    this.size = 0;
  }

  /** Append bytes as a buffer view (4-byte aligned); the view's index. */
  view(data, extra = {}) {
    const padding = Buffer.alloc(pad4(this.size));
    this.parts.push(padding, data);
    const byteOffset = this.size + padding.length;
    this.size = byteOffset + data.length;
    this.json.bufferViews.push({ buffer: 0, byteOffset, byteLength: data.length, ...extra });
    return this.json.bufferViews.length - 1;
  }

  /** Append `data` as a view and describe it with one accessor; the accessor's index. */
  accessor(data, { componentType, type, count, view = {}, ...extra }) {
    const bufferView = this.view(data, view);
    this.json.accessors.push({ bufferView, componentType, count, type, ...extra });
    return this.json.accessors.length - 1;
  }

  positions(values) {
    const count = values.length / 3;
    const min = [0, 1, 2].map((a) => Math.min(...values.filter((_, i) => i % 3 === a)));
    const max = [0, 1, 2].map((a) => Math.max(...values.filter((_, i) => i % 3 === a)));
    return this.accessor(f32(...values), { componentType: FLOAT, type: "VEC3", count, min, max });
  }
  vec3s(values) {
    return this.accessor(f32(...values), { componentType: FLOAT, type: "VEC3", count: values.length / 3 });
  }
  vec2s(values) {
    return this.accessor(f32(...values), { componentType: FLOAT, type: "VEC2", count: values.length / 2 });
  }
  indices16(values) {
    return this.accessor(u16(...values), { componentType: UNSIGNED_SHORT, type: "SCALAR", count: values.length });
  }
  indices8(values) {
    return this.accessor(u8(...values), { componentType: UNSIGNED_BYTE, type: "SCALAR", count: values.length });
  }
  indices32(values) {
    return this.accessor(u32(...values), { componentType: UNSIGNED_INT, type: "SCALAR", count: values.length });
  }

  /** Interleave per-vertex `[position, normal, uv]` arrays in one strided view; the accessors. */
  interleaved(vertices) {
    const stride = 32;
    const data = Buffer.concat(vertices.map(([p, n, t]) => f32(...p, ...n, ...t)));
    const bufferView = this.view(data, { byteStride: stride, target: 34962 });
    const make = (byteOffset, type, extra = {}) => {
      this.json.accessors.push({ bufferView, byteOffset, componentType: FLOAT, count: vertices.length, type, ...extra });
      return this.json.accessors.length - 1;
    };
    const xs = vertices.map(([p]) => p);
    return {
      POSITION: make(0, "VEC3", {
        min: [0, 1, 2].map((a) => Math.min(...xs.map((p) => p[a]))),
        max: [0, 1, 2].map((a) => Math.max(...xs.map((p) => p[a]))),
      }),
      NORMAL: make(12, "VEC3"),
      TEXCOORD_0: make(24, "VEC2"),
    };
  }

  image(bytes, mimeType) {
    const bufferView = this.view(bytes);
    (this.json.images ??= []).push({ bufferView, mimeType });
    return this.json.images.length - 1;
  }

  mesh(name, primitives) {
    this.json.meshes.push(name === null ? { primitives } : { name, primitives });
    return this.json.meshes.length - 1;
  }

  node(node, root = false) {
    this.json.nodes.push(node);
    const index = this.json.nodes.length - 1;
    if (root) this.json.scenes[0].nodes.push(index);
    return index;
  }

  /** The `.glb` bytes. Empty arrays are left out: glTF forbids them. */
  glb({ bin = true } = {}) {
    const data = Buffer.concat(this.parts);
    this.json.buffers[0].byteLength = data.length;
    const json = { ...this.json };
    for (const key of Object.keys(json)) if (Array.isArray(json[key]) && json[key].length === 0) delete json[key];
    if (!bin) delete json.buffers;
    return glbBytes(JSON.stringify(json), bin ? data : null);
  }
}

const TRIANGLE = [0, 0, 0, 1, 0, 0, 0, 1, 0];

/** The smallest valid model: one triangle `Tri` with position, normal and uv, one material. */
function tri() {
  const m = new Model();
  const attributes = {
    POSITION: m.positions(TRIANGLE),
    NORMAL: m.vec3s([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    TEXCOORD_0: m.vec2s([0, 0, 1, 0, 0, 1]),
  };
  const indices = m.indices16([0, 1, 2]);
  m.json.materials.push({ name: "Plain", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } });
  const mesh = m.mesh("Tri", [{ attributes, indices, material: 0 }]);
  m.node({ name: "Tri", mesh }, true);
  return m;
}
const primitive0 = (m) => m.json.meshes[0].primitives[0];
const firstView = (m) => m.json.bufferViews[0];

// ---------------------------------------------------------------------------
// The supported model
// ---------------------------------------------------------------------------

const CHECKER = png(2, 2, [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 255, 255],
]);
const GREY_MASK = png(2, 2, [
  [255, 255, 255, 255],
  [128, 128, 128, 255],
  [128, 128, 128, 255],
  [255, 255, 255, 255],
]);
const WOOD = png(2, 2, [
  [139, 90, 43, 255],
  [160, 110, 60, 255],
  [120, 75, 35, 255],
  [150, 100, 50, 255],
]);

/**
 * `chair.glb`: six meshes that between them cover every layout the packager handles, one node
 * hierarchy, three materials (one textured with a nearest/clamp sampler that asks for mip-maps,
 * one with a JPEG and the default sampler, one with factors only).
 */
function supportedModel() {
  const m = new Model();
  // Quad: interleaved position/normal/uv, u16 indices.
  const quad = m.interleaved([
    [[-1, 0, -1], [0, 1, 0], [0, 0]],
    [[1, 0, -1], [0, 1, 0], [1, 0]],
    [[1, 0, 1], [0, 1, 0], [1, 1]],
    [[-1, 0, 1], [0, 1, 0], [0, 1]],
  ]);
  const quadIndices = m.indices16([0, 2, 1, 0, 3, 2]);
  // Wedge: a tetrahedron, position and normal, u8 indices.
  const wedge = {
    POSITION: m.positions([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    NORMAL: m.vec3s([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
  };
  const wedgeIndices = m.indices8([0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2]);
  // Tri: not indexed, position and uv.
  const triAttributes = {
    POSITION: m.positions([0, 0, 0, 2, 0, 0, 0, 2, 0]),
    TEXCOORD_0: m.vec2s([0, 0, 1, 0, 0, 1]),
  };
  // Twin: two primitives, the first indexed with positions only, the second not indexed.
  const twinA = { POSITION: m.positions([0, 0, 0, 1, 0, 0, 1, 1, 0]) };
  const twinAIndices = m.indices16([0, 1, 2]);
  const twinB = {
    POSITION: m.positions([0, 0, 1, 1, 0, 1, 1, 1, 1]),
    TEXCOORD_0: m.vec2s([0, 0, 1, 0, 1, 1]),
  };
  // Wide: positions only, u32 indices over four vertices.
  const wideAttributes = { POSITION: m.positions([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]) };
  const wideIndices = m.indices32([0, 1, 2, 2, 1, 3]);

  const checker = m.image(CHECKER, "image/png");
  const steel = m.image(jpegGrey(200), "image/jpeg");
  m.json.samplers = [{ magFilter: 9728, minFilter: 9984, wrapS: 33071, wrapT: 33071 }];
  m.json.textures = [{ source: checker, sampler: 0 }, { source: steel }];
  m.json.materials.push(
    {
      name: "Fabric",
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        baseColorTexture: { index: 0 },
        metallicFactor: 0,
        roughnessFactor: 0.9,
      },
    },
    {
      name: "Oak",
      pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 0.125, 1], metallicFactor: 0.1, roughnessFactor: 0.8 },
    },
    {
      name: "Steel",
      pbrMetallicRoughness: { baseColorFactor: [0.75, 0.75, 0.75, 1], baseColorTexture: { index: 1 }, metallicFactor: 1, roughnessFactor: 0.25 },
    },
  );
  const meshes = {
    Quad: m.mesh("Quad", [{ attributes: quad, indices: quadIndices, material: 0 }]),
    Wedge: m.mesh("Wedge", [{ attributes: wedge, indices: wedgeIndices, material: 1 }]),
    Tri: m.mesh("Tri", [{ attributes: triAttributes, material: 2 }]),
    Twin: m.mesh("Twin", [
      { attributes: twinA, indices: twinAIndices, material: 1 },
      { attributes: twinB, material: 2 },
    ]),
    Wide: m.mesh("Wide", [{ attributes: wideAttributes, indices: wideIndices }]),
  };
  // Nodes. Root: translation (1, 2, 3) and scale 2; Seat below it, turned a quarter about +Y;
  // Frame is a matrix node (scale (1, 2, 3), translation (5, 6, 7)); Spare is in no scene.
  const root = m.node({ name: "Root", translation: [1, 2, 3], scale: [2, 2, 2], children: [1, 2] }, true);
  const h = Math.SQRT1_2;
  m.node({ name: "Seat", translation: [0, 1, 0], rotation: [0, h, 0, h], mesh: meshes.Quad });
  m.node({ name: "Frame", matrix: [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 5, 6, 7, 1], mesh: meshes.Wedge });
  m.node({ name: "Spare", translation: [9, 9, 9] });
  void root;
  return m.glb();
}

// ---------------------------------------------------------------------------
// The projects
// ---------------------------------------------------------------------------

const files = new Map();
const put = (path, content) => files.set(path, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"));

const TOML = `[project]\nname = "fixture"\nlanguage = "0.1"\n`;

/** A project whose entry module declares `MODEL` from `models/model.glb` and uses `Tri`. */
function project(dir, glb, { toml = TOML, main, model = "models/model.glb", extra = {} } = {}) {
  put(`${dir}/mtek.toml`, toml);
  put(
    `${dir}/src/main.mtek`,
    main ??
      `const MODEL = asset.glb("../${model}");

scene Demo {
    camera Main {}
    entity Part {
        mesh: MODEL.mesh("Tri");
    }
}
`,
  );
  if (glb !== null) put(`${dir}/${model}`, glb);
  for (const [path, content] of Object.entries(extra)) put(`${dir}/${path}`, content);
}

/** Declaring project for a model in `fail/<name>`. */
function fail(name, glb, options) {
  project(`fail/${name}`, glb, options);
}

// ----- the supported project ------------------------------------------------

put("pass/assets_supported/mtek.toml", TOML);
put("pass/assets_supported/models/chair.glb", supportedModel());
put("pass/assets_supported/textures/wood.png", WOOD);
put("pass/assets_supported/textures/mask.png", GREY_MASK);
put(
  "pass/assets_supported/src/main.mtek",
  `// A GLB with six meshes, a node hierarchy and three materials, plus two standalone textures
// (spec/assets.md section 2). Every value is checked against the file at compile time.
const CHAIR = asset.glb("../models/chair.glb");
const WOOD = asset.texture("../textures/wood.png");
const MASK = asset.linear_texture("../textures/mask.png");

material Textured {
    param tint: color = #ffffff;
    param base: texture = texture.white();
    param mask: texture = texture.white();
    param filter: sampler = sampler.linear_repeat();

    fragment(input: SurfaceInput) -> color {
        let a = sample(base, filter, input.uv);
        let b = sample(mask, filter, input.uv);
        return color.linear(tint.rgb * a.xyz * b.xyz, 1.0);
    }
}

scene Showroom {
    camera Main {
        position: vec3(0.0, 2.0, 6.0);
        target: vec3(0.0, 0.5, 0.0);
    }
    entity Seat {
        mesh: CHAIR.mesh("Quad");
        position: CHAIR.node_position("Seat");
        rotation: CHAIR.node_rotation("Seat");
        scale: CHAIR.node_scale("Seat");
        material: Textured {
            tint: CHAIR.material_base_color("Fabric");
            base: CHAIR.material_texture("Fabric");
            mask: MASK;
            filter: sampler.nearest_clamp();
        };
    }
    entity Frame {
        mesh: CHAIR.mesh("Wedge");
        position: CHAIR.node_position("Frame");
        scale: CHAIR.node_scale("Frame");
        material: Unlit { color: CHAIR.material_base_color("Oak") };
    }
    entity Ground {
        mesh: CHAIR.mesh("Tri");
        material: Textured { base: WOOD };
    }
    entity Left {
        mesh: CHAIR.primitive("Twin", 0);
    }
    entity Right {
        mesh: CHAIR.primitive("Twin", 1);
        material: Textured { base: CHAIR.material_texture("Steel"); tint: CHAIR.material_base_color("Steel") };
    }
    entity Wide {
        mesh: CHAIR.mesh("Wide");
        position: CHAIR.node_position("Root");
    }
}
`,
);

// Assets declared in one module and used in another: the handles are constants like any
// other, so they are exported and imported.
put("pass/assets_imported/mtek.toml", TOML);
put("pass/assets_imported/models/chair.glb", supportedModel());
put("pass/assets_imported/textures/wood.png", WOOD);
put(
  "pass/assets_imported/src/library/assets.mtek",
  `export const CHAIR = asset.glb("../../models/chair.glb");
export const WOOD = asset.texture("../../textures/wood.png");
export const SEAT = CHAIR.mesh("Quad");
export const OAK = CHAIR.material_base_color("Oak");
`,
);
put(
  "pass/assets_imported/src/main.mtek",
  `import { CHAIR, WOOD, SEAT, OAK } from "./library/assets.mtek";

material Textured {
    param base: texture = texture.white();
    param filter: sampler = sampler.linear_repeat();
    fragment(input: SurfaceInput) -> color {
        let texel = sample(base, filter, input.uv);
        return color.linear(texel.xyz, 1.0);
    }
}

scene Demo {
    camera Main {}
    entity Seat {
        mesh: SEAT;
        material: Textured { base: WOOD };
    }
    entity Frame {
        mesh: CHAIR.mesh("Wedge");
        position: CHAIR.node_position("Frame");
        material: Unlit { color: OAK };
    }
}
`,
);

// ----- row 1: the container --------------------------------------------------

fail("e7001_gltf_extension", null, {
  main: `const MODEL = asset.glb("../models/scene.gltf");

scene Demo {
    camera Main {}
    entity Part {
        mesh: MODEL.mesh("Tri");
    }
}
`,
  extra: { "models/scene.gltf": `{"asset":{"version":"2.0"}}\n` },
});
fail("e7001_wrong_magic", Buffer.concat([Buffer.from("RIFF"), u32(2, 20), Buffer.alloc(8)]));
fail("e7001_json_text", Buffer.from(`{"asset":{"version":"2.0"}}`));
fail("e7001_truncated_header", glbBytes("{}", null).subarray(0, 9));
fail("e7001_version_1", (() => {
  const bytes = tri().glb();
  bytes.writeUInt32LE(1, 4);
  return bytes;
})());
fail("e7001_truncated_file", tri().glb().subarray(0, 300));
fail("e7001_bin_chunk_first", (() => {
  const bin = Buffer.alloc(8);
  const json = Buffer.from(`{"asset":{"version":"2.0"}}   `.padEnd(32, " "));
  return Buffer.concat([u32(0x46546c67, 2, 12 + 16 + 8 + json.length), u32(8, 0x004e4942), bin, u32(json.length, 0x4e4f534a), json]);
})());
fail("e7001_two_bin_chunks", (() => {
  const base = tri().glb();
  const extra = Buffer.concat([u32(4, 0x004e4942), Buffer.alloc(4)]);
  const bytes = Buffer.concat([base, extra]);
  bytes.writeUInt32LE(bytes.length, 8);
  return bytes;
})());
fail("e7001_unknown_chunk", (() => {
  const base = tri().glb();
  const extra = Buffer.concat([u32(4, 0x12345678), Buffer.alloc(4)]);
  const bytes = Buffer.concat([base, extra]);
  bytes.writeUInt32LE(bytes.length, 8);
  return bytes;
})());
fail("e7001_invalid_json", glbBytes(`{"asset": {"version": "2.0"`, null));
fail("e7001_not_gltf_2", glbBytes(`{"asset":{"version":"1.0"}}`, null));
fail("e7001_dangling_reference", (() => {
  const m = tri();
  primitive0(m).material = 7;
  return m.glb();
})());
fail("e7001_missing_bin_chunk", (() => {
  const m = tri();
  return rebuildContainer(m, () => {}, { bin: false });
})());

fail("e7003_external_buffer", (() => {
  const m = tri();
  m.json.buffers[0].uri = "model.bin";
  return m.glb();
})());
fail("e7003_data_uri_buffer", (() => {
  const m = tri();
  m.json.buffers[0].uri = "data:application/octet-stream;base64,AAAA";
  return m.glb();
})());
fail("e7003_external_image", (() => {
  const m = tri();
  m.json.images = [{ uri: "texture.png" }];
  m.json.textures = [{ source: 0 }];
  m.json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  return m.glb();
})());

// ----- row 2: sizes ----------------------------------------------------------

fail("e7002_file_too_large", (() => {
  const m = tri();
  m.view(Buffer.alloc(4096));
  return m.glb();
})(), { toml: `${TOML}\n[assets]\nmax_file_bytes = 2048\n` });
fail("e7002_json_chunk_too_large", Buffer.concat([u32(0x46546c67, 2, 20), u32(20 * 1024 * 1024, 0x4e4f534a)]));
fail("e7026_too_many_vertices", tri().glb(), { toml: `${TOML}\n[assets]\nmax_vertices_per_primitive = 2\n` });

// ----- row 3: extensions -----------------------------------------------------

fail("e7004_required_extension", (() => {
  const m = tri();
  m.json.extensionsUsed = ["KHR_draco_mesh_compression", "EXT_meshopt_compression"];
  m.json.extensionsRequired = ["KHR_draco_mesh_compression"];
  return m.glb();
})());
fail("e7005_used_extension", (() => {
  const m = tri();
  m.json.extensionsUsed = ["KHR_materials_unlit"];
  m.json.materials[0].extensions = { KHR_materials_unlit: {} };
  return m.glb();
})());
fail("e7005_undeclared_extension_object", (() => {
  const m = tri();
  m.json.materials[0].extensions = { KHR_materials_clearcoat: { clearcoatFactor: 1 } };
  return m.glb();
})());

// ----- row 4: modes ----------------------------------------------------------

fail("e7006_mode_lines", (() => {
  const m = tri();
  primitive0(m).mode = 1;
  return m.glb();
})());
fail("e7006_mode_triangle_strip", (() => {
  const m = tri();
  primitive0(m).mode = 5;
  return m.glb();
})());

// ----- row 5: attributes -----------------------------------------------------

fail("e7007_normalized_uv", (() => {
  const m = tri();
  const uv = m.accessor(u16(0, 0, 65535, 0, 0, 65535), {
    componentType: UNSIGNED_SHORT, type: "VEC2", count: 3, normalized: true,
  });
  primitive0(m).attributes.TEXCOORD_0 = uv;
  return m.glb();
})());
fail("e7007_integer_positions", (() => {
  const m = tri();
  const positions = m.accessor(i16(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0), {
    componentType: SHORT, type: "VEC3", count: 3, min: [0, 0, 0], max: [1, 1, 0],
  });
  primitive0(m).attributes.POSITION = positions;
  return m.glb();
})());
fail("e7008_joints_and_weights", (() => {
  const m = tri();
  primitive0(m).attributes.JOINTS_0 = m.accessor(u8(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), {
    componentType: UNSIGNED_BYTE, type: "VEC4", count: 3,
  });
  primitive0(m).attributes.WEIGHTS_0 = m.accessor(f32(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0), {
    componentType: FLOAT, type: "VEC4", count: 3,
  });
  return m.glb();
})());
fail("e7008_morph_targets", (() => {
  const m = tri();
  primitive0(m).targets = [{ POSITION: m.vec3s([0, 0, 1, 0, 0, 1, 0, 0, 1]) }];
  m.json.meshes[0].weights = [0.5];
  return m.glb();
})());
fail("e7009_vertex_colour", (() => {
  const m = tri();
  primitive0(m).attributes.COLOR_0 = m.accessor(f32(1, 0, 0, 0, 1, 0, 0, 0, 1), {
    componentType: FLOAT, type: "VEC3", count: 3,
  });
  return m.glb();
})());
fail("e7009_tangent", (() => {
  const m = tri();
  primitive0(m).attributes.TANGENT = m.accessor(f32(1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1), {
    componentType: FLOAT, type: "VEC4", count: 3,
  });
  return m.glb();
})());
fail("e7009_second_uv_set", (() => {
  const m = tri();
  primitive0(m).attributes.TEXCOORD_1 = m.vec2s([0, 0, 1, 0, 0, 1]);
  return m.glb();
})());
fail("e7009_custom_attribute", (() => {
  const m = tri();
  primitive0(m).attributes._BATCHID = m.accessor(f32(0, 0, 0), { componentType: FLOAT, type: "SCALAR", count: 3 });
  return m.glb();
})());
fail("e7010_no_position", (() => {
  const m = tri();
  delete primitive0(m).attributes.POSITION;
  return m.glb();
})());

// ----- row 6: indices --------------------------------------------------------

fail("e7014_index_out_of_range", (() => {
  const m = tri();
  primitive0(m).indices = m.indices16([0, 1, 3]);
  return m.glb();
})());
fail("e7014_index_count", (() => {
  const m = tri();
  primitive0(m).indices = m.indices16([0, 1, 2, 0]);
  return m.glb();
})());
fail("e7014_primitive_restart_index", (() => {
  const m = tri();
  primitive0(m).indices = m.indices16([0, 1, 65535]);
  return m.glb();
})());
fail("e7014_unindexed_vertex_count", (() => {
  const m = new Model();
  const attributes = { POSITION: m.positions([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]) };
  const mesh = m.mesh("Tri", [{ attributes }]);
  m.node({ name: "Tri", mesh }, true);
  return m.glb();
})());
fail("e7007_float_indices", (() => {
  const m = tri();
  primitive0(m).indices = m.accessor(f32(0, 1, 2), { componentType: FLOAT, type: "SCALAR", count: 3 });
  return m.glb();
})());

// ----- row 7: accessors ------------------------------------------------------

fail("e7011_sparse_accessor", (() => {
  const m = tri();
  const base = m.accessor(f32(0, 0, 0, 0, 0, 0, 0, 0, 0), { componentType: FLOAT, type: "VEC3", count: 3 });
  const indices = m.view(u16(1, 0));
  const values = m.view(f32(1, 1, 1));
  m.json.accessors[base].sparse = { count: 1, indices: { bufferView: indices, componentType: UNSIGNED_SHORT }, values: { bufferView: values } };
  primitive0(m).attributes.NORMAL = base;
  return m.glb();
})());
fail("e7011_accessor_without_view", (() => {
  const m = tri();
  m.json.accessors.push({ componentType: FLOAT, count: 3, type: "VEC3" });
  primitive0(m).attributes.NORMAL = m.json.accessors.length - 1;
  return m.glb();
})());
fail("e7025_view_outside_buffer", (() => {
  const m = tri();
  firstView(m).byteLength = 100000;
  return m.glb();
})());
fail("e7025_accessor_past_view", (() => {
  const m = tri();
  m.json.accessors[0].count = 40;
  return m.glb();
})());
fail("e7025_stride_too_small", (() => {
  const m = tri();
  firstView(m).byteStride = 8;
  return m.glb();
})());
fail("e7025_misaligned_offset", (() => {
  const m = tri();
  firstView(m).byteLength += 4; // room for the shifted accessor: only the alignment is wrong
  m.json.accessors[0].byteOffset = 2;
  return m.glb();
})());
fail("e7025_nan_position", (() => {
  const m = new Model();
  const attributes = { POSITION: m.accessor(f32(0, 0, 0, NaN, 0, 0, 0, 1, 0), { componentType: FLOAT, type: "VEC3", count: 3, min: [0, 0, 0], max: [1, 1, 0] }) };
  const mesh = m.mesh("Tri", [{ attributes }]);
  m.node({ name: "Tri", mesh }, true);
  return m.glb();
})());
fail("e7025_buffer_longer_than_chunk", (() => {
  const m = tri();
  return rebuildContainer(m, (json) => {
    json.buffers[0].byteLength += 4000;
  });
})());
fail("e7025_attribute_count_mismatch", (() => {
  const m = tri();
  m.json.accessors[1].count = 2;
  return m.glb();
})());

/** The model's container with its JSON edited by `edit` (lengths stay consistent). */
function rebuildContainer(m, edit, { bin = true } = {}) {
  const data = Buffer.concat(m.parts);
  m.json.buffers[0].byteLength = data.length;
  const json = structuredClone(m.json);
  edit(json);
  return glbBytes(JSON.stringify(json), bin ? data : null);
}

// ----- row 8: materials ------------------------------------------------------

const material0 = (m) => m.json.materials[0];
fail("e7015_alpha_blend", (() => {
  const m = tri();
  material0(m).alphaMode = "BLEND";
  return m.glb();
})());
fail("e7015_alpha_mask", (() => {
  const m = tri();
  material0(m).alphaMode = "MASK";
  material0(m).alphaCutoff = 0.5;
  return m.glb();
})());
fail("e7015_base_colour_alpha", (() => {
  const m = tri();
  material0(m).pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 0.5];
  return m.glb();
})());
function withTextures(m, count) {
  const image = m.image(CHECKER, "image/png");
  m.json.textures = Array.from({ length: count }, () => ({ source: image }));
}
fail("e7016_normal_texture", (() => {
  const m = tri();
  withTextures(m, 1);
  material0(m).normalTexture = { index: 0 };
  return m.glb();
})());
fail("e7016_double_sided", (() => {
  const m = tri();
  material0(m).doubleSided = true;
  return m.glb();
})());
fail("e7016_emissive_factor", (() => {
  const m = tri();
  material0(m).emissiveFactor = [1, 0.5, 0];
  return m.glb();
})());
fail("e7016_several_features", (() => {
  const m = tri();
  withTextures(m, 4);
  material0(m).pbrMetallicRoughness.metallicRoughnessTexture = { index: 0 };
  material0(m).normalTexture = { index: 1 };
  material0(m).occlusionTexture = { index: 2 };
  material0(m).emissiveTexture = { index: 3 };
  material0(m).emissiveFactor = [1, 1, 1];
  material0(m).doubleSided = true;
  return m.glb();
})());
fail("e7009_texcoord_1_texture", (() => {
  const m = tri();
  withTextures(m, 1);
  material0(m).pbrMetallicRoughness.baseColorTexture = { index: 0, texCoord: 1 };
  return m.glb();
})());

// ----- row 9: images ---------------------------------------------------------

function withImage(m, bytes, mimeType) {
  const image = m.image(bytes, mimeType);
  m.json.textures = [{ source: image }];
  material0(m).pbrMetallicRoughness.baseColorTexture = { index: 0 };
}
fail("e7017_webp_image", (() => {
  const m = tri();
  withImage(m, Buffer.concat([Buffer.from("RIFF"), u32(12), Buffer.from("WEBPVP8 "), Buffer.alloc(16)]), "image/webp");
  return m.glb();
})());
fail("e7017_oversized_image", (() => {
  const m = tri();
  withImage(m, bigPng(9000, 9000), "image/png");
  return m.glb();
})());
fail("e7017_mime_mismatch", (() => {
  const m = tri();
  withImage(m, CHECKER, "image/jpeg");
  return m.glb();
})());
fail("e7017_not_an_image", (() => {
  const m = tri();
  withImage(m, Buffer.from("this is not an image at all, just text"), "image/png");
  return m.glb();
})());
fail("e7017_image_without_data", (() => {
  const m = tri();
  m.json.images = [{ mimeType: "image/png" }];
  m.json.textures = [{ source: 0 }];
  return m.glb();
})());

// ----- row 10: samplers ------------------------------------------------------

fail("e7018_mirrored_repeat", (() => {
  const m = tri();
  withImage(m, CHECKER, "image/png");
  m.json.samplers = [{ wrapS: 33648, wrapT: 33648 }];
  m.json.textures[0].sampler = 0;
  return m.glb();
})());
fail("e7018_wrap_modes_differ", (() => {
  const m = tri();
  withImage(m, CHECKER, "image/png");
  m.json.samplers = [{ wrapS: 10497, wrapT: 33071 }];
  m.json.textures[0].sampler = 0;
  return m.glb();
})());
fail("e7018_filters_differ", (() => {
  const m = tri();
  withImage(m, CHECKER, "image/png");
  m.json.samplers = [{ magFilter: 9728, minFilter: 9729 }];
  m.json.textures[0].sampler = 0;
  return m.glb();
})());

// ----- row 11: node transforms (reported by the accessors) --------------------

function nodes(...list) {
  const m = tri();
  m.json.nodes = [];
  m.json.scenes[0].nodes = [];
  list.forEach((node, index) => m.node(node, index === 0));
  return m.glb();
}
const nodeProject = (name, glb, accessor) =>
  fail(name, glb, {
    main: `const MODEL = asset.glb("../models/model.glb");

scene Demo {
    camera Main {}
    entity Part {
        mesh: MODEL.mesh("Tri");
        ${accessor};
    }
}
`,
  });
// An eighth of a turn about +Z: below a parent with a non-uniform scale it shears.
const eighthZ = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)];
nodeProject(
  "e7013_shear",
  nodes(
    { name: "Stretched", scale: [1, 2, 1], children: [1] },
    { name: "Turned", rotation: eighthZ, mesh: 0 },
  ),
  'rotation: MODEL.node_rotation("Turned")',
);
nodeProject(
  "e7013_mirror",
  nodes({ name: "Mirrored", scale: [-1, 1, 1], mesh: 0 }),
  'position: MODEL.node_position("Mirrored")',
);
nodeProject(
  "e7013_zero_scale",
  nodes({ name: "Flat", scale: [0, 1, 1], mesh: 0 }),
  'rotation: MODEL.node_rotation("Flat")',
);
nodeProject(
  "e7013_projective_matrix",
  nodes({ name: "Warped", matrix: [1, 0, 0, 0.5, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], mesh: 0 }),
  'position: MODEL.node_position("Warped")',
);
nodeProject(
  "e7013_matrix_and_trs",
  nodes({ name: "Both", matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], translation: [1, 0, 0], mesh: 0 }),
  'position: MODEL.node_position("Both")',
);

// ----- row 12: animations and skins -------------------------------------------

fail("e7019_animation", (() => {
  const m = tri();
  const input = m.accessor(f32(0, 1), { componentType: FLOAT, type: "SCALAR", count: 2, min: [0], max: [1] });
  const output = m.accessor(f32(0, 0, 0, 1, 0, 0), { componentType: FLOAT, type: "VEC3", count: 2 });
  m.json.animations = [
    { channels: [{ sampler: 0, target: { node: 0, path: "translation" } }], samplers: [{ input, output }] },
  ];
  return m.glb();
})());
fail("e7019_skin", (() => {
  const m = tri();
  const ibm = m.accessor(f32(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), {
    componentType: FLOAT, type: "MAT4", count: 1,
  });
  m.json.skins = [{ joints: [0], inverseBindMatrices: ibm }];
  m.json.nodes[0].skin = 0;
  return m.glb();
})());

// ----- declarations ----------------------------------------------------------

const declaring = (extra) => `${extra}

scene Demo {
    camera Main {}
    entity Part {
        mesh: Box {};
    }
}
`;
put("fail/e7020_missing_file/mtek.toml", TOML);
put("fail/e7020_missing_file/src/main.mtek", declaring(`const MODEL = asset.glb("../models/absent.glb");\nconst WOOD = asset.texture("../textures/absent.png");`));
project("fail/e7021_outside_project", null, {
  main: declaring(`const MODEL = asset.glb("../../models/model.glb");\nconst WOOD = asset.texture("/etc/wood.png");\nconst BACK = asset.texture("..\\\\wood.png");\nconst EMPTY = asset.texture("");`),
});
project("fail/e7023_case_mismatch", tri().glb(), {
  main: declaring(`const MODEL = asset.glb("../Models/model.glb");\nconst OTHER = asset.glb("../models/MODEL.glb");`),
});
project("fail/e7901_remote_asset", null, {
  main: declaring(`const MODEL = asset.glb("https://example.com/chair.glb");\nconst WOOD = asset.texture("data:image/png;base64,AAAA");`),
});
project("fail/e7022_misuse", tri().glb(), {
  main: `const MODEL = asset.glb("../models/model.glb");
const NAME = "../models/model.glb";
const DYNAMIC = asset.glb(NAME);

fn pass_it(model: glb_asset) -> f32 {
    return 1.0;
}

scene Demo {
    camera Main {}
    entity Part {
        mesh: MODEL.mesh("Tri");
        position: vec3(MODEL, 0.0, 0.0);
    }
}

fn keep() -> f32 {
    let copy = MODEL;
    return 1.0;
}
`,
});
project("fail/e7902_model_field", tri().glb(), {
  main: `const MODEL = asset.glb("../models/model.glb");

scene Demo {
    camera Main {}
    entity Part {
        model: MODEL;
    }
}
`,
});

// Names: unknown (with a validated rename), ambiguous, wrong kind, node outside the scene, the
// primitive rules.
put("fail/e7024_unknown_names/mtek.toml", TOML);
put("fail/e7024_unknown_names/models/chair.glb", supportedModel());
put(
  "fail/e7024_unknown_names/src/main.mtek",
  `const CHAIR = asset.glb("../models/chair.glb");

scene Demo {
    camera Main {}
    entity Misspelled {
        mesh: CHAIR.mesh("Qaud");
    }
    entity Absent {
        mesh: CHAIR.mesh("Sofa");
        position: CHAIR.node_position("Spare");
        scale: CHAIR.node_scale("Rot");
    }
    entity Primitive {
        mesh: CHAIR.primitive("Twin", 2);
        material: Unlit { color: CHAIR.material_base_color("Oakk") };
    }
}
`,
);
put("fail/e7012_several_primitives/mtek.toml", TOML);
put("fail/e7012_several_primitives/models/chair.glb", supportedModel());
put(
  "fail/e7012_several_primitives/src/main.mtek",
  `const CHAIR = asset.glb("../models/chair.glb");

scene Demo {
    camera Main {}
    entity Both {
        mesh: CHAIR.mesh("Twin");
    }
}
`,
);
fail("e7024_ambiguous_and_unnamed", (() => {
  const m = tri();
  const second = m.mesh("Tri", [{ attributes: { POSITION: m.positions(TRIANGLE) } }]);
  m.node({ name: "Other", mesh: second }, true);
  m.mesh(null, [{ attributes: { POSITION: m.positions(TRIANGLE) } }]);
  return m.glb();
})());

// A mesh without uv drawn with a material that reads it.
put("fail/e7010_mesh_lacks_uv/mtek.toml", TOML);
put("fail/e7010_mesh_lacks_uv/models/chair.glb", supportedModel());
put(
  "fail/e7010_mesh_lacks_uv/src/main.mtek",
  `const CHAIR = asset.glb("../models/chair.glb");

material Checker {
    param tint: color = #ffffff;
    fragment(input: SurfaceInput) -> color {
        return color.linear(tint.rgb * input.uv.x, 1.0);
    }
}

scene Demo {
    camera Main {}
    entity Wedge {
        mesh: CHAIR.mesh("Wedge");
        material: Checker {};
    }
    entity Quad {
        mesh: CHAIR.mesh("Quad");
        material: Checker {};
    }
}
`,
);

// Limits on the packaged assets.
put("fail/e7026_total_bytes/mtek.toml", `${TOML}\n[assets]\nmax_total_bytes = 200\n`);
put("fail/e7026_total_bytes/models/chair.glb", supportedModel());
put(
  "fail/e7026_total_bytes/src/main.mtek",
  `const CHAIR = asset.glb("../models/chair.glb");

scene Demo {
    camera Main {}
    entity Quad {
        mesh: CHAIR.mesh("Quad");
    }
    entity Wedge {
        mesh: CHAIR.mesh("Wedge");
    }
}
`,
);

// Standalone textures.
const textureProject = (name, bytes, toml = TOML) => {
  put(`fail/${name}/mtek.toml`, toml);
  put(`fail/${name}/textures/image.dat`, bytes);
  put(
    `fail/${name}/src/main.mtek`,
    declaring(`const IMAGE = asset.texture("../textures/image.dat");`),
  );
};
textureProject("e7017_texture_not_png_or_jpeg", Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "latin1"));
textureProject("e7017_texture_oversized", bigPng(9000, 9000));
textureProject("e7017_texture_over_configured_limit", CHECKER, `${TOML}\n[assets]\nmax_texture_dimension = 1\n`);
textureProject("e7002_texture_file_too_large", bigPng(2000, 2000), `${TOML}\n[assets]\nmax_file_bytes = 64\n`);

// ---------------------------------------------------------------------------
// The browser fixtures of task M4-06 (decision 0060): `tests/browser/fixtures/m4/assets_scene` and `assets_corrupt`. Like
// everything above they are written from explicit data, so the expected pixels of `specs/m4/assets.spec.ts` are derived by
// hand from the numbers in this section, never from what the renderer draws.
//
// `assets_scene` is a 3 x 3 grid of 2 x 2 unit cells seen by an orthographic camera (height 6, so 16 pixels per unit) on
// a 96 x 96 target: cell (i, j) is centred at pixel (16 + 32 i, 16 + 32 j). Every mesh lies in the z = 0 plane, faces +Z
// and spans [-0.8, 0.8] in x and y (25.6 pixels) around its cell centre.
//
//   (0, 0) Checker  Panel with the GLB's 2 x 2 checker texture (red, green / blue, white), nearest and clamped
//   (1, 0) Corner   a non-indexed right triangle (right angle bottom left) in the base colour of "Oak"
//   (2, 0) Lacquer  Panel with the Pbr material "Lacquer" of the GLB, lit by a sun and an ambient term
//   (0, 1) Square   primitive 0 of the two-primitive mesh "Pair": a square (u16 indices), colour of "Slate"
//   (1, 1) Roof     primitive 1 of "Pair": an isosceles triangle with u8 indices (widened to u16), colour of "Oak"
//   (2, 1) Wood     Panel with the standalone sRGB texture textures/wood.png
//   (0, 2) Mask     Panel with the standalone linear texture textures/mask.png
//   (1, 2) Grey     Panel with the GLB's JPEG (one flat grey of 200)
//   (2, 2) Wood2    exactly like Wood: the two share a parameter block and are drawn with one instanced draw
//
// `assets_corrupt` has one standalone PNG whose header is valid (the compiler accepts it) and whose pixel data is not
// (the browser cannot decode it): the mount must fail with E7031.

const BROWSER_FIXTURES = "../browser/fixtures/m4";
const MASK_TEXELS = [
  [255, 255, 255, 255],
  [128, 128, 128, 255],
  [64, 64, 64, 255],
  [0, 0, 0, 255],
];
const MASK_PNG = png(2, 2, MASK_TEXELS);

/** A PNG with a valid signature, header and CRCs whose compressed pixel data is not a valid zlib stream. */
function corruptPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  // A stored deflate block whose length complement is wrong ("invalid stored block lengths").
  const garbage = Buffer.from([0x78, 0x01, 0x01, 0x05, 0x00, 0x00, 0x00, 1, 2, 3, 4, 5, 0, 0, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", garbage),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function sceneModel() {
  const m = new Model();
  const h = 0.8;
  // Panel: interleaved position / normal / uv, u16 indices. uv (0, 0) is the top left of the image: the vertex at the
  // top left of the quad (-h, +h) has uv (0, 0).
  const panel = m.interleaved([
    [[-h, -h, 0], [0, 0, 1], [0, 1]],
    [[h, -h, 0], [0, 0, 1], [1, 1]],
    [[h, h, 0], [0, 0, 1], [1, 0]],
    [[-h, h, 0], [0, 0, 1], [0, 0]],
  ]);
  const panelIndices = m.indices16([0, 1, 2, 0, 2, 3]);
  // Corner: not indexed; the right angle is at (-h, -h).
  const corner = { POSITION: m.positions([-h, -h, 0, h, -h, 0, -h, h, 0]) };
  // Pair: a square with u16 indices, then a triangle with u8 indices.
  const square = { POSITION: m.positions([-h, -h, 0, h, -h, 0, h, h, 0, -h, h, 0]) };
  const squareIndices = m.indices16([0, 1, 2, 0, 2, 3]);
  const roof = { POSITION: m.positions([-h, -h, 0, h, -h, 0, 0, h, 0]) };
  const roofIndices = m.indices8([0, 1, 2]);

  const checker = m.image(CHECKER, "image/png");
  const grey = m.image(jpegGrey(200), "image/jpeg");
  // NEAREST magnification and minification, CLAMP_TO_EDGE both ways: the preset sampler.nearest_clamp.
  m.json.samplers = [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }];
  m.json.textures = [{ source: checker, sampler: 0 }, { source: grey }];
  m.json.materials.push(
    { name: "Checker", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } },
    { name: "Oak", pbrMetallicRoughness: { baseColorFactor: [0.6, 0.3, 0.1, 1], metallicFactor: 0, roughnessFactor: 1 } },
    { name: "Slate", pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.8, 1], metallicFactor: 0, roughnessFactor: 1 } },
    { name: "Lacquer", pbrMetallicRoughness: { baseColorFactor: [0.8, 0.2, 0.1, 1], metallicFactor: 0, roughnessFactor: 0.5 } },
    { name: "Grey", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 1 }, metallicFactor: 0, roughnessFactor: 1 } },
  );
  const meshes = {
    Panel: m.mesh("Panel", [{ attributes: panel, indices: panelIndices, material: 0 }]),
    Corner: m.mesh("Corner", [{ attributes: corner, material: 1 }]),
    Pair: m.mesh("Pair", [
      { attributes: square, indices: squareIndices, material: 2 },
      { attributes: roof, indices: roofIndices, material: 1 },
    ]),
  };
  // The nodes the scene takes its first row of positions from.
  m.node({ name: "CheckerNode", translation: [-2, 2, 0], mesh: meshes.Panel }, true);
  m.node({ name: "CornerNode", translation: [0, 2, 0], mesh: meshes.Corner }, true);
  m.node({ name: "LacquerNode", translation: [2, 2, 0], mesh: meshes.Panel }, true);
  m.node({ name: "PairNode", mesh: meshes.Pair }, true);
  return m.glb();
}

const SCENE_TOML = `[project]\nname = "fixture"\nlanguage = "0.1"\n`;
const DECAL = `// Unlit: the tint times the texel, in linear space (the texture is sampled as linear values).
material Decal {
    param tint: color = #ffffff;
    param base: texture = texture.white();
    param filter: sampler = sampler.nearest_clamp();

    fragment(input: SurfaceInput) -> color {
        let texel = sample(base, filter, input.uv);
        return color.linear(tint.rgb * texel.xyz, 1.0);
    }
}
`;

put(`${BROWSER_FIXTURES}/assets_scene/mtek.toml`, SCENE_TOML);
put(`${BROWSER_FIXTURES}/assets_scene/models/scene.glb`, sceneModel());
put(`${BROWSER_FIXTURES}/assets_scene/textures/wood.png`, WOOD);
put(`${BROWSER_FIXTURES}/assets_scene/textures/mask.png`, MASK_PNG);
put(
  `${BROWSER_FIXTURES}/assets_scene/src/main.mtek`,
  `// Assets end to end (task M4-06, decision 0060): a GLB with three meshes (one with two primitives), five materials and
// two images, and two standalone textures, drawn in a 3 x 3 grid. The layout and the expected pixels are written down in
// tests/assets/tools/make-glb.mjs, which generates the GLB and the PNGs from explicit data.
const SCENE = asset.glb("../models/scene.glb");
const WOOD = asset.texture("../textures/wood.png");
const MASK = asset.linear_texture("../textures/mask.png");

${DECAL}
scene Showroom {
    clear_color: #102030;
    ambient_color: #ffffff;
    ambient_intensity: 0.2;

    camera Main {
        position: vec3(0.0, 0.0, 6.0);
        target: vec3(0.0, 0.0, 0.0);
        projection: Orthographic { height: 6.0; near: 0.1; far: 20.0 };
    }

    entity Sun {
        rotation: quat.euler(-0.9, 0.4, 0.0);
        light: DirectionalLight { intensity: 3.0 };
    }

    entity Checker {
        mesh: SCENE.mesh("Panel");
        position: SCENE.node_position("CheckerNode");
        material: Decal { base: SCENE.material_texture("Checker") };
    }
    entity Corner {
        mesh: SCENE.mesh("Corner");
        position: SCENE.node_position("CornerNode");
        material: Unlit { color: SCENE.material_base_color("Oak") };
    }
    entity Lacquer {
        mesh: SCENE.mesh("Panel");
        position: SCENE.node_position("LacquerNode");
        material: SCENE.material("Lacquer");
    }
    entity Square {
        mesh: SCENE.primitive("Pair", 0);
        position: vec3(-2.0, 0.0, 0.0);
        material: Unlit { color: SCENE.material_base_color("Slate") };
    }
    entity Roof {
        mesh: SCENE.primitive("Pair", 1);
        position: vec3(0.0, 0.0, 0.0);
        material: Unlit { color: SCENE.material_base_color("Oak") };
    }
    entity Wood {
        mesh: SCENE.mesh("Panel");
        position: vec3(2.0, 0.0, 0.0);
        material: Decal { base: WOOD };
    }
    entity Mask {
        mesh: SCENE.mesh("Panel");
        position: vec3(-2.0, -2.0, 0.0);
        material: Decal { base: MASK };
    }
    entity Grey {
        mesh: SCENE.mesh("Panel");
        position: vec3(0.0, -2.0, 0.0);
        material: Decal { base: SCENE.material_texture("Grey") };
    }
    entity Wood2 {
        mesh: SCENE.mesh("Panel");
        position: vec3(2.0, -2.0, 0.0);
        material: Decal { base: WOOD };
    }
}
`,
);

put(`${BROWSER_FIXTURES}/assets_corrupt/mtek.toml`, SCENE_TOML);
put(`${BROWSER_FIXTURES}/assets_corrupt/textures/broken.png`, corruptPng());
put(
  `${BROWSER_FIXTURES}/assets_corrupt/src/main.mtek`,
  `// One standalone PNG with a valid header and undecodable pixel data (task M4-06): the compiler accepts it, the browser
// cannot decode it, and the mount fails with E7031 at this declaration.
const BROKEN = asset.texture("../textures/broken.png");

${DECAL}
scene Corrupt {
    camera Main {
        position: vec3(0.0, 0.0, 4.0);
        target: vec3(0.0, 0.0, 0.0);
    }
    entity Cube {
        mesh: Box { size: vec3(1.0, 1.0, 1.0) };
        material: Decal { base: BROKEN };
    }
}
`,
);

// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const check = process.argv.includes("--check");
let problems = 0;
for (const [path, content] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const target = join(root, path);
  if (check) {
    if (!existsSync(target) || !readFileSync(target).equals(content)) {
      console.error(`${relative(resolve(root, "../.."), target).split("\\").join("/")} is out of date; run node tests/assets/tools/make-glb.mjs`);
      problems += 1;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
// Every file of a generated project must come from this script, except the expectations.
const generatedDirs = new Set([...files.keys()].map((p) => p.split("/").slice(0, 2).join("/")));
for (const file of walk(root)) {
  const rel = relative(root, file).split("\\").join("/");
  if (rel.startsWith("tools/") || rel.endsWith("expected.diag.json")) continue;
  if (!files.has(rel) && generatedDirs.has(rel.split("/").slice(0, 2).join("/"))) {
    console.error(`tests/assets/${rel} is not produced by make-glb.mjs`);
    problems += 1;
  }
}
if (check && problems > 0) process.exit(1);
if (!check) console.log(`wrote ${files.size} files under tests/assets and the browser asset fixtures`);
