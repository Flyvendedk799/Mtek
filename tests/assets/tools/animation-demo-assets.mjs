// The two humanoid models of examples/animation-composition (decision 0224), written from explicit data: no model was
// downloaded or exported, so the licence is that of this repository and the numbers are known by construction.
//
//   Hero.glb   a lizard-like biped, 1.84 m tall, T-pose, Mixamo-style joint names, a motion root above the hips, a four
//              joint tail and seven clips: Idle, Walk, Run, StrafeLeft, StrafeRight (travel in the "Root" joint, left foot
//              strikes at phase 0), Wave (a whole-body pose with the right arm waving), Dance (in place).
//   Guest.glb  a shorter-armed, longer-legged biped, A-pose, Unreal-style joint names, clavicles and an upper chest,
//              no clips. It plays the clips of Hero.glb through `clips_from` (decision 0223).
//
// Every clip is authored as world-space bone directions with the feet planted by a two-bone leg solve, so the stance
// feet do not slide against the travel of the root. All bind rotations are the identity (world-aligned bones), which
// keeps a joint's local rotation equal to the difference of two world rotations. The output is byte-for-byte
// deterministic (no timestamps; only Math.sin/cos/sqrt/acos, which V8 evaluates with its own fdlibm port).
//
// `tests/assets/tools/make-glb.mjs` writes (and `--check`s) the files; the browser tests import `HERO` and `GUEST` for the
// CPU reference of the skinned mesh.

const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;

// ---------------------------------------------------------------------------
// Small maths
// ---------------------------------------------------------------------------

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / len(a));
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
const qrot = (q, v) => {
  const t = mul(cross([q[0], q[1], q[2]], v), 2);
  return add(add(v, mul(t, q[3])), cross([q[0], q[1], q[2]], t));
};
/** The shortest rotation taking the unit vector `a` to the unit vector `b`. */
const qarc = (a, b) => {
  const d = dot(a, b);
  if (d < -0.999999) {
    const axis = unit(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(a, b);
  return qnorm([c[0], c[1], c[2], 1 + d]);
};
const yawQ = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const pitchQ = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const rollQ = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
const smooth = (x) => x * x * (3 - 2 * x);
const TAU = 2 * Math.PI;
const IDENTITY = [0, 0, 0, 1];

// ---------------------------------------------------------------------------
// GLB writing
// ---------------------------------------------------------------------------

const pad4 = (n) => (4 - (n % 4)) % 4;
const f32 = (values) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeFloatLE(v, i * 4));
  return b;
};
const u16 = (values) => {
  const b = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => b.writeUInt16LE(v, i * 2));
  return b;
};

class Writer {
  constructor() {
    this.json = { asset: { version: "2.0", generator: "mtek tests/assets/tools/animation-demo-assets.mjs" }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], skins: [], animations: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
    this.parts = [];
    this.size = 0;
  }

  view(data, extra = {}) {
    const padding = Buffer.alloc(pad4(this.size));
    this.parts.push(padding, data);
    const byteOffset = this.size + padding.length;
    this.size = byteOffset + data.length;
    this.json.bufferViews.push({ buffer: 0, byteOffset, byteLength: data.length, ...extra });
    return this.json.bufferViews.length - 1;
  }

  accessor(data, { componentType, type, count, view = {}, ...extra }) {
    const bufferView = this.view(data, view);
    this.json.accessors.push({ bufferView, componentType, count, type, ...extra });
    return this.json.accessors.length - 1;
  }

  floats(values, type, extra = {}) {
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    return this.accessor(f32(values), { componentType: FLOAT, type, count: values.length / width, ...extra });
  }

  glb() {
    const bin = Buffer.concat(this.parts);
    this.json.buffers[0].byteLength = bin.length;
    const json = { ...this.json };
    for (const key of Object.keys(json)) if (Array.isArray(json[key]) && json[key].length === 0) delete json[key];
    const text = Buffer.from(JSON.stringify(json), "utf8");
    const jsonPadded = Buffer.concat([text, Buffer.alloc(pad4(text.length), 0x20)]);
    const binPadded = Buffer.concat([bin, Buffer.alloc(pad4(bin.length))]);
    const head = Buffer.alloc(12);
    head.writeUInt32LE(0x46546c67, 0);
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
    const chunk = (type, data) => {
      const h = Buffer.alloc(8);
      h.writeUInt32LE(data.length, 0);
      h.writeUInt32LE(type, 4);
      return Buffer.concat([h, data]);
    };
    return Buffer.concat([head, chunk(0x4e4f534a, jsonPadded), chunk(0x004e4942, binPadded)]);
  }
}

// ---------------------------------------------------------------------------
// Meshes: capsule-like tubes and boxes, each rigidly bound to one joint
// ---------------------------------------------------------------------------

class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.joints = [];
    this.indices = [];
  }

  push(position, normal, joint, uv) {
    this.positions.push(...position);
    this.normals.push(...unit(normal));
    this.uvs.push(...uv);
    this.joints.push(joint);
    return this.joints.length - 1;
  }

  /** A tube from `a` to `b` with end domes, 8 sides, radii `ra` and `rb`. */
  tube(a, b, ra, rb, joint) {
    const axis = unit(sub(b, a));
    const side = unit(Math.abs(axis[1]) < 0.9 ? cross(axis, [0, 1, 0]) : cross(axis, [0, 0, 1]));
    const up = cross(axis, side);
    const sides = 8;
    const rings = [
      [sub(a, mul(axis, ra * 0.55)), ra * 0.72, -0.7],
      [a, ra, -0.25],
      [b, rb, 0.25],
      [add(b, mul(axis, rb * 0.55)), rb * 0.72, 0.7],
    ];
    const first = this.joints.length;
    for (const [centre, radius, tilt] of rings) {
      for (let k = 0; k < sides; k += 1) {
        const angle = (TAU * k) / sides;
        const radial = add(mul(side, Math.cos(angle)), mul(up, Math.sin(angle)));
        this.push(add(centre, mul(radial, radius)), add(radial, mul(axis, tilt)), joint, [k / sides, 0.5]);
      }
    }
    const apexA = this.push(sub(a, mul(axis, ra * 1.05)), mul(axis, -1), joint, [0, 0]);
    const apexB = this.push(add(b, mul(axis, rb * 1.05)), axis, joint, [1, 1]);
    for (let r = 0; r < 3; r += 1) {
      for (let k = 0; k < sides; k += 1) {
        const p = first + r * sides + k, q = first + r * sides + ((k + 1) % sides);
        this.indices.push(p, q, q + sides, p, q + sides, p + sides);
      }
    }
    for (let k = 0; k < sides; k += 1) {
      this.indices.push(apexA, first + ((k + 1) % sides), first + k);
      this.indices.push(apexB, first + 3 * sides + k, first + 3 * sides + ((k + 1) % sides));
    }
  }

  /** An axis-aligned box centred on `c` with half extents `h`. */
  box(c, h, joint) {
    const faces = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
      [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
    ];
    for (const [n, u, v] of faces) {
      const base = this.joints.length;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = add(c, [n[0] * h[0] + u[0] * su * h[0] + v[0] * sv * h[0], n[1] * h[1] + u[1] * su * h[1] + v[1] * sv * h[1], n[2] * h[2] + u[2] * su * h[2] + v[2] * sv * h[2]]);
        this.push(p, n, joint, [(su + 1) / 2, (sv + 1) / 2]);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}

// ---------------------------------------------------------------------------
// Rigs
// ---------------------------------------------------------------------------

/** Bones in parent-first order: `{ id, name, parent, pos }`; `pos` is the bind position in the model frame. */
function rigBones(list) {
  return list.map(([id, name, parent, pos], index) => ({ id, name, parent: parent === null ? -1 : list.findIndex((b) => b[0] === parent), pos, index }));
}

/** Hero (T-pose). Metres, +Y up, facing +Z, the character's left on +X. */
const HERO_DIMS = { ankle: 0.08, thigh: 0.44, shin: 0.44, hipHalf: 0.09, hipDrop: 0.04, upperArm: 0.3, foreArm: 0.27 };

function heroBones() {
  const d = HERO_DIMS;
  const hipY = d.ankle + d.thigh + d.shin;
  const list = [
    ["root", "Root", null, [0, 0, 0]],
    ["hips", "Hips", "root", [0, hipY + d.hipDrop, 0]],
    ["spine", "Spine", "hips", [0, 1.1, 0]],
    ["chest", "Spine1", "spine", [0, 1.28, 0]],
    ["neck", "Neck", "chest", [0, 1.52, 0]],
    ["head", "Head", "neck", [0, 1.62, 0]],
    ["headTop", "HeadTop_End", "head", [0, 1.84, 0]],
  ];
  for (const [side, sign, label] of [["L", 1, "Left"], ["R", -1, "Right"]]) {
    const shoulder = [sign * 0.17, 1.46, 0];
    list.push(
      [`upperArm.${side}`, `${label}Arm`, "chest", shoulder],
      [`lowerArm.${side}`, `${label}ForeArm`, `upperArm.${side}`, [sign * (0.17 + d.upperArm), 1.46, 0]],
      [`hand.${side}`, `${label}Hand`, `lowerArm.${side}`, [sign * (0.17 + d.upperArm + d.foreArm), 1.46, 0]],
    );
  }
  for (const [side, sign, label] of [["L", 1, "Left"], ["R", -1, "Right"]]) {
    const x = sign * d.hipHalf;
    list.push(
      [`upperLeg.${side}`, `${label}UpLeg`, "hips", [x, hipY, 0]],
      [`lowerLeg.${side}`, `${label}Leg`, `upperLeg.${side}`, [x, d.ankle + d.shin, 0]],
      [`foot.${side}`, `${label}Foot`, `lowerLeg.${side}`, [x, d.ankle, 0]],
      [`toes.${side}`, `${label}ToeBase`, `foot.${side}`, [x, d.ankle - 0.06, 0.13]],
    );
  }
  list.push(
    ["tail1", "Tail1", "hips", [0, 0.97, -0.1]],
    ["tail2", "Tail2", "tail1", [0, 0.9, -0.3]],
    ["tail3", "Tail3", "tail2", [0, 0.82, -0.5]],
    ["tail4", "Tail4", "tail3", [0, 0.74, -0.68]],
  );
  return rigBones(list);
}

function heroParts(bones, mesh) {
  const at = (id) => bones.find((b) => b.id === id);
  const tube = (from, to, ra, rb, joint = from) => mesh.tube(at(from).pos, at(to).pos, ra, rb, at(joint).index);
  mesh.box([0, 1.02, 0], [0.17, 0.1, 0.1], at("hips").index);
  tube("hips", "chest", 0.12, 0.13, "spine");
  mesh.box([0, 1.39, 0], [0.19, 0.15, 0.11], at("chest").index);
  tube("neck", "head", 0.055, 0.05);
  mesh.tube(at("head").pos, at("headTop").pos, 0.1, 0.095, at("head").index);
  for (const side of ["L", "R"]) {
    const sign = side === "L" ? 1 : -1;
    tube(`upperArm.${side}`, `lowerArm.${side}`, 0.05, 0.042);
    tube(`lowerArm.${side}`, `hand.${side}`, 0.042, 0.034);
    mesh.box(add(at(`hand.${side}`).pos, [sign * 0.05, 0, 0]), [0.05, 0.03, 0.04], at(`hand.${side}`).index);
    tube(`upperLeg.${side}`, `lowerLeg.${side}`, 0.075, 0.058);
    tube(`lowerLeg.${side}`, `foot.${side}`, 0.058, 0.045);
    mesh.box(add(at(`foot.${side}`).pos, [0, -0.045, 0.06]), [0.045, 0.035, 0.1], at(`foot.${side}`).index);
  }
  tube("tail1", "tail2", 0.06, 0.05);
  tube("tail2", "tail3", 0.05, 0.04);
  tube("tail3", "tail4", 0.04, 0.03);
  mesh.tube(at("tail4").pos, add(at("tail4").pos, [0, -0.05, -0.12]), 0.03, 0.012, at("tail4").index);
}

/** Guest (A-pose): legs 1.12x, arms 0.88x, spine 0.9x, with clavicles and an upper chest; Unreal-style names. */
const GUEST_DIMS = { ankle: 0.09, thigh: 0.49, shin: 0.49, hipHalf: 0.1, hipDrop: 0.05, upperArm: 0.264, foreArm: 0.238 };

function guestBones() {
  const d = GUEST_DIMS;
  const hipY = d.ankle + d.thigh + d.shin;
  const pelvis = [0, hipY + d.hipDrop, 0];
  const s1 = add(pelvis, [0, 0.09, 0]), s2 = add(s1, [0, 0.12, 0]), s3 = add(s2, [0, 0.12, 0]), neck = add(s3, [0, 0.19, 0]), head = add(neck, [0, 0.09, 0]);
  const list = [
    ["root", "root", null, [0, 0, 0]],
    ["hips", "pelvis", "root", pelvis],
    ["spine", "spine_01", "hips", s1],
    ["chest", "spine_02", "spine", s2],
    ["upperChest", "spine_03", "chest", s3],
    ["neck", "neck_01", "upperChest", neck],
    ["head", "head", "neck", head],
  ];
  const arm = unit([Math.SQRT1_2, -Math.SQRT1_2, 0]);
  for (const [side, sign, tag] of [["L", 1, "l"], ["R", -1, "r"]]) {
    const clavicle = add(s3, [sign * 0.03, 0.17, 0]);
    const shoulder = add(clavicle, [sign * 0.12, 0, 0]);
    const elbow = add(shoulder, [sign * arm[0] * d.upperArm, arm[1] * d.upperArm, 0]);
    const wrist = add(elbow, [sign * arm[0] * d.foreArm, arm[1] * d.foreArm, 0]);
    list.push(
      [`clavicle.${side}`, `clavicle_${tag}`, "upperChest", clavicle],
      [`upperArm.${side}`, `upperarm_${tag}`, `clavicle.${side}`, shoulder],
      [`lowerArm.${side}`, `lowerarm_${tag}`, `upperArm.${side}`, elbow],
      [`hand.${side}`, `hand_${tag}`, `lowerArm.${side}`, wrist],
    );
  }
  for (const [side, sign, tag] of [["L", 1, "l"], ["R", -1, "r"]]) {
    const x = sign * d.hipHalf;
    list.push(
      [`upperLeg.${side}`, `thigh_${tag}`, "hips", [x, hipY, 0]],
      [`lowerLeg.${side}`, `calf_${tag}`, `upperLeg.${side}`, [x, d.ankle + d.shin, 0]],
      [`foot.${side}`, `foot_${tag}`, `lowerLeg.${side}`, [x, d.ankle, 0]],
      [`toes.${side}`, `ball_${tag}`, `foot.${side}`, [x, d.ankle - 0.07, 0.14]],
    );
  }
  return rigBones(list);
}

function guestParts(bones, mesh) {
  const at = (id) => bones.find((b) => b.id === id);
  const tube = (from, to, ra, rb, joint = from) => mesh.tube(at(from).pos, at(to).pos, ra, rb, at(joint).index);
  mesh.box(add(at("hips").pos, [0, 0.02, 0]), [0.15, 0.1, 0.09], at("hips").index);
  tube("hips", "chest", 0.1, 0.11, "spine");
  tube("chest", "upperChest", 0.115, 0.125);
  mesh.box(add(at("upperChest").pos, [0, 0.07, 0]), [0.16, 0.12, 0.09], at("upperChest").index);
  tube("neck", "head", 0.045, 0.042);
  mesh.tube(at("head").pos, add(at("head").pos, [0, 0.2, 0]), 0.1, 0.09, at("head").index);
  for (const side of ["L", "R"]) {
    const sign = side === "L" ? 1 : -1;
    tube(`clavicle.${side}`, `upperArm.${side}`, 0.035, 0.04);
    tube(`upperArm.${side}`, `lowerArm.${side}`, 0.042, 0.036);
    tube(`lowerArm.${side}`, `hand.${side}`, 0.036, 0.03);
    mesh.box(add(at(`hand.${side}`).pos, [sign * 0.03, -0.035, 0]), [0.03, 0.045, 0.035], at(`hand.${side}`).index);
    tube(`upperLeg.${side}`, `lowerLeg.${side}`, 0.07, 0.052);
    tube(`lowerLeg.${side}`, `foot.${side}`, 0.052, 0.04);
    mesh.box(add(at(`foot.${side}`).pos, [0, -0.05, 0.07]), [0.04, 0.035, 0.1], at(`foot.${side}`).index);
  }
}

// ---------------------------------------------------------------------------
// Clips (Hero)
// ---------------------------------------------------------------------------

/** Two-bone leg solve in the model frame: thigh and shin directions for a hip joint, an ankle target, bending toward +Z. */
function legIK(hip, ankle, thigh, shin) {
  let axis = sub(ankle, hip), d = len(axis);
  const reach = (thigh + shin) * 0.9995;
  if (d > reach) { axis = mul(axis, reach / d); d = reach; }
  const e = unit(axis), a = (thigh * thigh - shin * shin + d * d) / (2 * d), h = Math.sqrt(Math.max(thigh * thigh - a * a, 0));
  const n = unit(sub([0, 0, 1], mul(e, e[2])));
  const knee = add(add(hip, mul(e, a)), mul(n, h));
  return [unit(sub(knee, hip)), unit(sub(add(hip, axis), knee))];
}

/**
 * A locomotion cycle. Foot offsets are relative to the root, which travels at `speed` along `axis` (a unit vector in the
 * XZ plane); a stance foot slides back at exactly that speed, so it stays where it was planted in the world.
 */
function gait({ period, duty, half, spread = 0, axis, hipVertical, bob, lift, armSwing, elbow, lean, twist, tailSway }) {
  return (t) => {
    const phi = t / period, d = HERO_DIMS;
    const speed = (2 * half) / (duty * period);
    const hips = [0.012 * Math.sin(TAU * phi) * (axis[2] !== 0 ? 1 : 0), d.ankle + hipVertical - bob * Math.cos(2 * TAU * phi) + d.hipDrop, 0];
    const yaw = twist * Math.sin(TAU * phi);
    const legs = {}, arms = {}, footPitch = {};
    for (const [side, sign, shift] of [["L", 1, 0], ["R", -1, 0.5]]) {
      const u = (((phi - shift) % 1) + 1) % 1;
      let along, height = d.ankle, pitch = 0;
      if (u < duty) along = half - (2 * half * u) / duty;
      else {
        const s = (u - duty) / (1 - duty);
        along = -half + 2 * half * smooth(s);
        height = d.ankle + lift * Math.sin(Math.PI * s);
        pitch = -0.45 * Math.sin(Math.PI * s);
      }
      const hipJoint = add(hips, qrot(yawQ(yaw), [sign * d.hipHalf, -d.hipDrop, 0]));
      const target = [sign * (d.hipHalf + spread) + axis[0] * along, height, axis[2] * along];
      legs[side] = legIK(hipJoint, target, d.thigh, d.shin);
      footPitch[side] = pitch;
      const swing = armSwing * Math.sin(TAU * (phi - shift) + Math.PI);
      const fold = elbow + 0.25 * armSwing * Math.sin(TAU * (phi - shift) + Math.PI + 1);
      arms[side] = [unit([sign * 0.12, -Math.cos(swing), Math.sin(swing)]), unit([sign * 0.1, -Math.cos(swing + fold), Math.sin(swing + fold)])];
    }
    return { root: mul(axis, speed * t), hips, hipsYaw: yaw, spineYaw: [-0.5 * yaw, -0.9 * yaw], spinePitch: [lean * 0.4, lean * 0.4, -lean * 0.3], legs, arms, footPitch, tail: tailPose(phi, tailSway, 1), head: [0.5 * yaw, 0] };
  };
}

/** Tail joints as cumulative yaw angles about +Y (a swish travelling down the tail). */
function tailPose(phi, amplitude, rate) {
  return [0, 1, 2, 3].map((i) => amplitude * (i + 1) * 0.5 * Math.sin(TAU * rate * phi - 0.7 * i));
}

function idlePose(t) {
  const d = HERO_DIMS, phi = t / 2;
  const vertical = 0.845, hips = [0, d.ankle + vertical + 0.004 * Math.sin(TAU * phi) + d.hipDrop, 0];
  const legs = {}, arms = {}, footPitch = { L: 0, R: 0 };
  for (const [side, sign] of [["L", 1], ["R", -1]]) {
    legs[side] = legIK(add(hips, [sign * d.hipHalf, -d.hipDrop, 0]), [sign * d.hipHalf * 1.4, d.ankle, 0], d.thigh, d.shin);
    arms[side] = [unit([sign * 0.2, -1, 0.04]), unit([sign * 0.13, -1, 0.2 + 0.03 * Math.sin(TAU * phi)])];
  }
  return { root: [0, 0, 0], hips, hipsYaw: 0.03 * Math.sin(TAU * phi), spineYaw: [0, 0], spinePitch: [0.01 * Math.sin(TAU * phi), 0.02 * Math.sin(TAU * phi), -0.01], legs, arms, footPitch, tail: tailPose(phi, 0.18, 1), head: [0.12 * Math.sin(TAU * phi), 0] };
}

/** A whole-body pose (weight on one leg, feet apart, hips turned) with the right arm waving: a layer masked to the upper body takes only the waving. */
function wavePose(t) {
  const d = HERO_DIMS, phi = t / 1.6, w = TAU * 2.5 * phi;
  const hips = [0.05, d.ankle + 0.82 + d.hipDrop, 0];
  const legs = {}, arms = {};
  for (const [side, sign, z] of [["L", 1, 0.06], ["R", -1, -0.04]]) {
    legs[side] = legIK(add(hips, [sign * d.hipHalf, -d.hipDrop, 0]), [sign * (d.hipHalf + 0.09), d.ankle, z], d.thigh, d.shin);
  }
  arms.L = [unit([0.3, -1, 0.1]), unit([0.25, -1, 0.3])];
  arms.R = [unit([-0.86, 0.5, 0.1]), unit([-0.16 - 0.55 * Math.sin(w), 0.97, 0.06 + 0.12 * Math.cos(w)])];
  return { root: [0, 0, 0], hips, hipsYaw: 0.08, spineYaw: [0.03, -0.18], spinePitch: [0, 0, 0.04], legs, arms, footPitch: { L: 0, R: 0 }, tail: tailPose(phi, 0.2, 1), head: [-0.25 + 0.05 * Math.sin(w), 0.1] };
}

function dancePose(t) {
  const d = HERO_DIMS, phi = t / 2, a = TAU * phi;
  const vertical = 0.82 + 0.035 * Math.cos(2 * a), sway = 0.045 * Math.sin(a);
  const hips = [sway, d.ankle + vertical + d.hipDrop, 0];
  const legs = {}, arms = {}, footPitch = {};
  for (const [side, sign, sh] of [["L", 1, 0], ["R", -1, Math.PI]]) {
    const tap = Math.max(0, Math.sin(a + sh)) * 0.07;
    const wide = sign * (d.hipHalf + 0.07);
    legs[side] = legIK(add(hips, [sign * d.hipHalf, -d.hipDrop, 0]), [wide, d.ankle + tap, 0.02 * tap / 0.07], d.thigh, d.shin);
    footPitch[side] = -4 * tap;
    arms[side] = [unit([sign * (0.6 + 0.3 * Math.sin(a + sh)), 0.35 + 0.55 * Math.sin(a + sh), 0.1]), unit([sign * 0.5, 0.75 + 0.2 * Math.cos(a + sh), 0.3])];
  }
  return { root: [0, 0, 0], hips, hipsYaw: 0.25 * Math.sin(a), spineYaw: [-0.2 * Math.sin(a), -0.2 * Math.sin(a)], spinePitch: [0.04, 0.05, 0], legs, arms, footPitch, tail: tailPose(phi, 0.3, 2), head: [0.2 * Math.sin(2 * a), 0.05 * Math.cos(a)] };
}

export const HERO_CLIPS = [
  { name: "Idle", duration: 2, pose: idlePose, driven: "all" },
  { name: "Walk", duration: 1, pose: gait({ period: 1, duty: 0.6, half: 0.35, axis: [0, 0, 1], hipVertical: 0.79, bob: 0.012, lift: 0.07, armSwing: 0.4, elbow: 0.35, lean: 0.03, twist: 0.08, tailSway: 0.12 }), driven: "all" },
  { name: "Run", duration: 0.7, pose: gait({ period: 0.7, duty: 0.38, half: 0.38, axis: [0, 0, 1], hipVertical: 0.765, bob: 0.03, lift: 0.16, armSwing: 0.7, elbow: 1.0, lean: 0.2, twist: 0.12, tailSway: 0.2 }), driven: "all" },
  { name: "StrafeLeft", duration: 0.8, pose: gait({ period: 0.8, duty: 0.6, half: 0.2, spread: 0.13, axis: [1, 0, 0], hipVertical: 0.8, bob: 0.01, lift: 0.05, armSwing: 0.12, elbow: 0.2, lean: 0, twist: 0.03, tailSway: 0.1 }), driven: "all" },
  { name: "StrafeRight", duration: 0.8, pose: gait({ period: 0.8, duty: 0.6, half: 0.2, spread: 0.13, axis: [-1, 0, 0], hipVertical: 0.8, bob: 0.01, lift: 0.05, armSwing: 0.12, elbow: 0.2, lean: 0, twist: 0.03, tailSway: 0.1 }), driven: "all" },
  { name: "Wave", duration: 1.6, pose: wavePose, driven: "all" },
  { name: "Dance", duration: 2, pose: dancePose, driven: "all" },
];

const FRAMES_PER_SECOND = 30;

/** World rotation of every bone for a pose; bones without an explicit target follow their parent. */
function worldRotations(bones, pose) {
  const out = new Map();
  const explicit = new Map();
  const set = (id, q) => explicit.set(id, q);
  set("hips", qnorm(qmul(yawQ(pose.hipsYaw), IDENTITY)));
  set("chest", qnorm(qmul(yawQ(pose.spineYaw[1]), pitchQ(pose.spinePitch[1]))));
  set("spine", qnorm(qmul(yawQ(pose.spineYaw[0]), pitchQ(pose.spinePitch[0]))));
  set("neck", qnorm(qmul(yawQ(pose.head[0] * 0.5), pitchQ(pose.spinePitch[2]))));
  set("head", qnorm(qmul(yawQ(pose.head[0]), pitchQ(pose.head[1]))));
  for (const [i, angle] of pose.tail.entries()) set(`tail${i + 1}`, yawQ(angle));
  const firstChild = (id) => bones.find((b) => b.parent >= 0 && bones[b.parent].id === id);
  for (const side of ["L", "R"]) {
    const [upper, lower] = pose.arms[side], [legUpper, legLower] = pose.legs[side];
    const rest = (id) => unit(sub(firstChild(id).pos, bones.find((b) => b.id === id).pos));
    set(`upperArm.${side}`, qarc(rest(`upperArm.${side}`), upper));
    set(`lowerArm.${side}`, qarc(rest(`lowerArm.${side}`), lower));
    set(`upperLeg.${side}`, qarc(rest(`upperLeg.${side}`), legUpper));
    set(`lowerLeg.${side}`, qarc(rest(`lowerLeg.${side}`), legLower));
    set(`foot.${side}`, pitchQ(pose.footPitch[side]));
  }
  const world = (bone) => {
    if (out.has(bone.id)) return out.get(bone.id);
    const q = explicit.get(bone.id) ?? (bone.parent < 0 ? IDENTITY : world(bones[bone.parent]));
    out.set(bone.id, q);
    return q;
  };
  for (const bone of bones) world(bone);
  return out;
}

function buildClip(w, bones, clip) {
  const steps = Math.round(clip.duration * FRAMES_PER_SECOND);
  const times = Array.from({ length: steps + 1 }, (_, i) => Math.fround(i / FRAMES_PER_SECOND));
  const timesAccessor = w.floats(times, "SCALAR", { min: [times[0]], max: [times[steps]] });
  const driven = new Set(clip.driven === "all" ? [...bones.filter((b) => !["root", "headTop", "hand.L", "hand.R", "toes.L", "toes.R"].includes(b.id)).map((b) => b.id)] : clip.driven);
  const rotations = new Map([...driven].map((id) => [id, []]));
  const rootValues = [], hipsValues = [];
  for (let i = 0; i <= steps; i += 1) {
    const pose = clip.pose(times[i]);
    const world = worldRotations(bones, pose);
    for (const id of driven) {
      const bone = bones.find((b) => b.id === id);
      const parent = bone.parent < 0 ? IDENTITY : world.get(bones[bone.parent].id);
      let local = qnorm(qmul(qconj(parent), world.get(id)));
      const previous = rotations.get(id);
      if (previous.length >= 4 && previous.slice(-4).reduce((s, v, k) => s + v * local[k], 0) < 0) local = local.map((v) => -v);
      previous.push(...local);
    }
    if (clip.driven === "all") {
      rootValues.push(...pose.root);
      hipsValues.push(...sub(pose.hips, bones.find((b) => b.id === "hips").pos));
    }
  }
  const samplers = [], channels = [];
  const addChannel = (node, path, values, type) => {
    samplers.push({ input: timesAccessor, output: w.floats(values.map((v) => Math.fround(v)), type), interpolation: "LINEAR" });
    channels.push({ sampler: samplers.length - 1, target: { node, path } });
  };
  const bindOf = (id) => bones.find((b) => b.id === id);
  for (const id of driven) addChannel(NODE_OF.get(id), "rotation", rotations.get(id), "VEC4");
  if (clip.driven === "all") {
    const root = bindOf("root"), hips = bindOf("hips");
    addChannel(NODE_OF.get("root"), "translation", rootValues.map((v, k) => v + root.pos[k % 3]), "VEC3");
    addChannel(NODE_OF.get("hips"), "translation", hipsValues.map((v, k) => v + (hips.pos[k % 3] - root.pos[k % 3])), "VEC3");
  }
  return { name: clip.name, samplers, channels };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Node index of each bone id for the model being written (node 0 is the skinned mesh node `Body`). */
let NODE_OF = new Map();

function writeModel(bones, fillMesh, clips) {
  const w = new Writer();
  const mesh = new MeshBuilder();
  fillMesh(bones, mesh);
  const position = [0, 1, 2].map((a) => mesh.positions.filter((_, i) => i % 3 === a));
  const joints = [];
  const weights = [];
  for (const j of mesh.joints) { joints.push(j, 0, 0, 0); weights.push(1, 0, 0, 0); }
  const attributes = {
    POSITION: w.floats(mesh.positions.map((v) => Math.fround(v)), "VEC3", { min: position.map((p) => Math.min(...p)), max: position.map((p) => Math.max(...p)) }),
    NORMAL: w.floats(mesh.normals.map((v) => Math.fround(v)), "VEC3"),
    TEXCOORD_0: w.floats(mesh.uvs, "VEC2"),
    JOINTS_0: w.accessor(Buffer.from(joints), { componentType: UNSIGNED_BYTE, type: "VEC4", count: mesh.joints.length }),
    WEIGHTS_0: w.floats(weights, "VEC4"),
  };
  const indices = w.accessor(u16(mesh.indices), { componentType: UNSIGNED_SHORT, type: "SCALAR", count: mesh.indices.length });
  w.json.meshes.push({ name: "Body", primitives: [{ attributes, indices }] });
  NODE_OF = new Map(bones.map((b, i) => [b.id, i + 1]));
  w.json.nodes.push({ name: "Body", mesh: 0, skin: 0 });
  for (const bone of bones) {
    const parent = bone.parent < 0 ? null : bones[bone.parent];
    const node = { name: bone.name, translation: (parent === null ? bone.pos : sub(bone.pos, parent.pos)).map((v) => Math.fround(v)) };
    const kids = bones.filter((b) => b.parent === bone.index).map((b) => NODE_OF.get(b.id));
    if (kids.length > 0) node.children = kids;
    w.json.nodes.push(node);
  }
  w.json.scenes[0].nodes.push(0, 1);
  const inverseBind = bones.flatMap((b) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.pos[0], -b.pos[1], -b.pos[2], 1]);
  w.json.skins.push({ joints: bones.map((b) => NODE_OF.get(b.id)), skeleton: 1, inverseBindMatrices: w.floats(inverseBind.map((v) => Math.fround(v)), "MAT4") });
  for (const clip of clips) {
    const { name, samplers, channels } = buildClip(w, bones, clip);
    w.json.animations.push({ name, samplers, channels });
  }
  return { glb: w.glb(), mesh, bones };
}

function build(which) {
  const result = which === "hero" ? writeModel(heroBones(), heroParts, HERO_CLIPS) : writeModel(guestBones(), guestParts, []);
  return result;
}

const hero = build("hero");
const guest = build("guest");

/** The model files and the skinned vertex data (positions, normals, joint per vertex, triangle indices) of each rig. */
export const HERO = { glb: hero.glb, bones: hero.bones, positions: hero.mesh.positions, normals: hero.mesh.normals, joints: hero.mesh.joints, indices: hero.mesh.indices };
export const GUEST = { glb: guest.glb, bones: guest.bones, positions: guest.mesh.positions, normals: guest.mesh.normals, joints: guest.mesh.joints, indices: guest.mesh.indices };
export const HERO_DIMENSIONS = HERO_DIMS;
export const GUEST_DIMENSIONS = GUEST_DIMS;
