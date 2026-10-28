// src/scene/uniform-scale.ts
var FLOAT32_SCALE_ROUND_OFF = 19073486328125e-19;
function numericallyUniformScale(x, y, z) {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && x > 0 && y > 0 && z > 0 && Math.abs(x / y - 1) <= FLOAT32_SCALE_ROUND_OFF && Math.abs(x / z - 1) <= FLOAT32_SCALE_ROUND_OFF;
}

// src/scene/humanoid-rig.ts
var REQUIRED_HUMANOID_BONES = [
  "hips",
  "spine",
  "head",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand"
], OPTIONAL_HUMANOID_BONES = [
  "chest",
  "upperChest",
  "neck",
  "leftShoulder",
  "rightShoulder",
  "leftToes",
  "rightToes"
], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len = (a) => Math.hypot(a[0], a[1], a[2]), unit = (a) => {
  let l = len(a);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}, orth = (a, n) => sub(a, mul(n, dot(a, n))), qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
], qconj = (q) => [-q[0], -q[1], -q[2], q[3]], qnorm = (q) => {
  let l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}, qrot = (q, v) => {
  let t = mul(cross(q, v), 2);
  return add(add(v, mul(t, q[3])), cross(q, t));
};
function qarc(a, b) {
  let d = dot(a, b);
  if (d < -1 + 1e-9) {
    let axis = unit(len(cross(a, [1, 0, 0])) > 1e-3 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
    return [axis[0], axis[1], axis[2], 0];
  }
  let c = cross(a, b);
  return qnorm([c[0], c[1], c[2], 1 + d]);
}
function qbasis(x, y, z) {
  let [m00, m10, m20] = [x[0], x[1], x[2]], [m01, m11, m21] = [y[0], y[1], y[2]], [m02, m12, m22] = [z[0], z[1], z[2]], t = m00 + m11 + m22;
  if (t > 0) {
    let s2 = Math.sqrt(t + 1) * 2;
    return qnorm([(m21 - m12) / s2, (m02 - m20) / s2, (m10 - m01) / s2, s2 / 4]);
  }
  if (m00 > m11 && m00 > m22) {
    let s2 = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return qnorm([s2 / 4, (m01 + m10) / s2, (m02 + m20) / s2, (m21 - m12) / s2]);
  }
  if (m11 > m22) {
    let s2 = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return qnorm([(m01 + m10) / s2, s2 / 4, (m12 + m21) / s2, (m02 - m20) / s2]);
  }
  let s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return qnorm([(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]);
}
function worldSimilarity(skin, order, local) {
  let rot = [], scale = [], pos = [];
  for (let i of order) {
    let { t, r, s } = local(i), p = skin.nodes[i].parent;
    p < 0 ? (rot[i] = qnorm(r), scale[i] = s, pos[i] = [t[0], t[1], t[2]]) : (rot[i] = qnorm(qmul(rot[p], r)), scale[i] = scale[p] * s, pos[i] = add(pos[p], mul(qrot(rot[p], t), scale[p])));
  }
  return { rot, scale, pos };
}
function nodeOrder(skin) {
  let seen = /* @__PURE__ */ new Set(), out = [], visit = (i) => {
    if (seen.has(i)) return;
    let p = skin.nodes[i].parent;
    p >= 0 && visit(p), seen.add(i), out.push(i);
  };
  return skin.nodes.forEach((_, i) => visit(i)), out;
}
function analyse(skin) {
  let n = skin.nodes.length, order = nodeOrder(skin), bind = worldSimilarity(skin, order, (i) => {
    let node = skin.nodes[i];
    return { t: node.translation, r: node.rotation, s: node.scale[0] };
  }), m = skin.meshNode, inv = qconj(bind.rot[m]), P = bind.pos.map((p) => mul(qrot(inv, sub(p, bind.pos[m])), 1 / bind.scale[m])), Q = bind.rot.map((r) => qnorm(qmul(inv, r))), S = bind.scale.map((s) => s / bind.scale[m]), isJoint = skin.nodes.map((_, i) => skin.joints.includes(i)), jp = skin.nodes.map((_, i) => {
    let p = skin.nodes[i].parent;
    for (; p >= 0 && !isJoint[p]; ) p = skin.nodes[p].parent;
    return p;
  }), kids = skin.nodes.map(() => []);
  for (let i = 0; i < n; i++) isJoint[i] && jp[i] >= 0 && kids[jp[i]].push(i);
  let height = new Array(n).fill(0), size = new Array(n).fill(1);
  for (let k = order.length - 1; k >= 0; k--) {
    let i = order[k];
    !isJoint[i] || jp[i] < 0 || (height[jp[i]] = Math.max(height[jp[i]], height[i] + 1), size[jp[i]] = size[jp[i]] + size[i]);
  }
  return { skin, count: n, order, isJoint, P, Q, S, meshRot: bind.rot[m], origin: { pos: mul(qrot(inv, mul(bind.pos[m], -1)), 1 / bind.scale[m]), scale: 1 / bind.scale[m] }, jp, kids, height, size };
}
var uniformScales = (skin) => skin.nodes.every((n) => numericallyUniformScale(n.scale[0], n.scale[1], n.scale[2])), NAME_TABLE_SPEC = "hips:hips hip pelvis waist cog;torso:spine chest upperchest uppchest torso abdomen back ribcage;neck:neck;head:head;leg.upper:thigh upleg upperleg uleg femur;leg.lower:calf shin lowerleg lowleg knee tibia;leg.foot:ankle foot;leg.toe:toe toes toebase ball;leg:leg;arm.shoulder:shoulder clavicle collar collarbone clav;arm.upper:upperarm uparm humerus;arm.lower:forearm lowerarm lowarm elbow ulna;arm.hand:hand wrist;arm:arm", NAME_TABLE = /* @__PURE__ */ new Map();
for (let row of NAME_TABLE_SPEC.split(";")) {
  let [key, words] = row.split(":"), [family, role] = key.split(".");
  for (let word of words.split(" ")) NAME_TABLE.set(word, role === void 0 ? { family } : { family, role });
}
var NOISE_WORDS = "mixamorig mixamo def org mch j b bip valvebiped cc base bone joint skeleton armature rig c", NOISE = new Set(NOISE_WORDS.split(" "));
function parseName(name) {
  let words = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z]+/).filter((w) => w !== "").map((w) => w.toLowerCase()), side2 = "", stem = [];
  for (let w of words)
    NOISE.has(w) || (w === "left" || w === "l" ? side2 = "l" : w === "right" || w === "r" ? side2 = "r" : stem.push(w));
  let key = stem.join(""), found = key === "hip" ? side2 === "" ? { family: "hips" } : { family: "leg", role: "upper" } : NAME_TABLE.get(key);
  return found === void 0 || (found.family === "leg" || found.family === "arm") != (side2 !== "") ? { side: side2 } : found.role === void 0 ? { family: found.family, side: side2 } : { family: found.family, role: found.role, side: side2 };
}

// src/scene/humanoid.ts
var ankleBend = Math.cos(50 * Math.PI / 180);
function continuation(g, from, kids) {
  let far = (k) => len(sub(g.P[k], g.P[from]));
  return [...kids].sort((a, b) => g.height[b] - g.height[a] || far(b) - far(a) || a - b)[0];
}
function limbChain(g, start, names) {
  let out = [start];
  for (let cur = start; ; ) {
    let kids = g.kids[cur], role = names[cur].role;
    if (kids.length === 0 || role === "hand" || role === "toe" || kids.filter((k) => g.height[k] >= 1).length >= 2) return out;
    cur = continuation(g, cur, kids), out.push(cur);
  }
}
var pathLength = (g, c, from, to) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += len(sub(g.P[c[i + 1]], g.P[c[i]]));
  return sum;
}, hint = (names, joint, role) => names[joint].role === void 0 ? 0 : names[joint].role === role ? -0.7 : 0.7;
function splitLeg(g, c, names) {
  let n = c.length - 1;
  if (n < 2) return;
  let a = c.findIndex((j, i) => i >= 2 && names[j].role === "foot");
  if (a < 0) {
    a = n;
    for (let i = 2; i < n; i++)
      if (dot(unit(sub(g.P[c[i + 1]], g.P[c[i]])), unit(sub(g.P[c[i]], g.P[c[0]]))) < ankleBend) {
        a = i;
        break;
      }
    a === n && n >= 3 && pathLength(g, c, n - 1, n) < 0.5 * pathLength(g, c, n - 2, n - 1) && (a = n - 1);
  }
  let k = -1, cost = 1 / 0;
  for (let i = 1; i < a; i++) {
    let upper = pathLength(g, c, 0, i), lower = pathLength(g, c, i, a);
    if (upper < 1e-9 || lower < 1e-9) continue;
    let here = Math.abs(Math.log(upper / lower)) + hint(names, c[i], "lower");
    here < cost && (cost = here, k = i);
  }
  if (!(k < 0))
    return a < n ? { upper: c[0], lower: c[k], foot: c[a], toes: c[a + 1] } : { upper: c[0], lower: c[k], foot: c[a] };
}
function splitArm(g, whole, names) {
  let last = whole.length - 1;
  for (let i = 2; i < last; i++)
    if (dot(unit(sub(g.P[whole[i + 1]], g.P[whole[i]])), unit(sub(g.P[whole[i]], g.P[whole[0]]))) < 0.5) {
      last = i;
      break;
    }
  let c = whole.slice(0, last + 1), best, cost = 1 / 0;
  for (let u = 0; u <= 1; u++)
    for (let e = u + 1; e < last; e++)
      for (let n = e + 1; n <= last; n++) {
        let upper = pathLength(g, c, u, e), lower = pathLength(g, c, e, n);
        if (upper < 1e-9 || lower < 1e-9) continue;
        let here = Math.abs(Math.log(upper / lower)) + 0.1 * (n - e - 1) + hint(names, c[u], "upper") + hint(names, c[e], "lower") + hint(names, c[n], "hand") + (u === 1 ? hint(names, c[0], "shoulder") : names[c[0]].role === "shoulder" ? 0.7 : 0);
        here < cost && (cost = here, best = u === 1 ? { shoulder: c[0], upper: c[1], lower: c[e], hand: c[n] } : { upper: c[0], lower: c[e], hand: c[n] });
      }
  return best;
}
function mirrorError(g, a, b, n) {
  let m = Math.min(3, a.length, b.length), mid = mul(add(g.P[a[0]], g.P[b[0]]), 0.5), scale = len(sub(g.P[a[m - 1]], g.P[a[0]]));
  if (scale < 1e-9) return 1 / 0;
  let sum = 0;
  for (let j = 0; j < m; j++) {
    let p = g.P[a[j]], mirrored = sub(p, mul(n, 2 * dot(sub(p, mid), n)));
    sum += len(sub(mirrored, g.P[b[j]]));
  }
  return sum / m / scale;
}
function spinePath(g, s, up, lat, names) {
  let path = [s], arms, top = -1, pick = (cur, list) => list.filter((k) => {
    let o = sub(g.P[k], g.P[cur]);
    return Math.abs(dot(o, lat)) <= 0.35 * len(o);
  }).sort((a, b) => g.height[b] - g.height[a] || dot(up, sub(g.P[b], g.P[a])))[0];
  for (let cur = s; ; ) {
    let kids = g.kids[cur];
    if (kids.length === 0) break;
    let rest = kids;
    if (arms === void 0) {
      let limbs = kids.filter((k) => g.height[k] >= 2);
      for (let i = 0; i < limbs.length && arms === void 0; i++)
        for (let j = i + 1; j < limbs.length && arms === void 0; j++) {
          let p = limbs[i], q = limbs[j], sp = dot(sub(g.P[p], g.P[cur]), lat), sq = dot(sub(g.P[q], g.P[cur]), lat);
          sp * sq < 0 && Math.abs(sp + sq) <= 0.35 * Math.max(Math.abs(sp), Math.abs(sq)) && mirrorError(g, limbChain(g, p, names), limbChain(g, q, names), lat) <= 0.35 && (arms = [p, q], top = cur);
        }
      arms !== void 0 && (rest = kids.filter((k) => k !== arms[0] && k !== arms[1]));
    }
    let next = pick(cur, rest);
    if (next === void 0) break;
    path.push(next), cur = next;
  }
  if (arms === void 0) return;
  let above = path.slice(path.indexOf(top) + 1), m = above.length;
  if (m === 0) return;
  let head = above[m - 1];
  return (m >= 2 && g.kids[above[m - 2]].length >= 2 || m >= 3 && g.kids[head].length === 0 && len(sub(g.P[head], g.P[above[m - 2]])) > 1.5 * len(sub(g.P[above[m - 2]], g.P[above[m - 3]]))) && (head = above[m - 2]), { arms, head };
}
function structure(g, names) {
  let best, bestKey = -1;
  for (let h = 0; h < g.count; h++) {
    if (!g.isJoint[h]) continue;
    let limbs = g.kids[h].filter((k) => g.height[k] >= 2);
    if (!(limbs.length < 3))
      for (let i = 0; i < limbs.length; i++)
        for (let j = i + 1; j < limbs.length; j++) {
          let a = limbs[i], b = limbs[j], A = limbChain(g, a, names), B = limbChain(g, b, names);
          if (A.length < 3 || B.length < 3) continue;
          let n = unit(sub(g.P[a], g.P[b]));
          if (mirrorError(g, A, B, n) > 0.2) continue;
          let dA = unit(sub(g.P[A[2]], g.P[a])), dB = unit(sub(g.P[B[2]], g.P[b]));
          if (dot(dA, dB) < 0.8) continue;
          let up = unit(mul(add(dA, dB), -1)), lat = unit(orth(n, up));
          for (let s of limbs) {
            if (s === a || s === b) continue;
            let sp = spinePath(g, s, up, lat, names);
            if (sp === void 0 || dot(unit(sub(g.P[sp.head], g.P[h])), up) < 0.6) continue;
            let key = g.size[h] * 1e3 + g.size[s];
            key > bestKey && (bestKey = key, best = { legs: [a, b], arms: sp.arms, head: sp.head });
          }
        }
  }
  return best;
}
function nameAnchors(g, names) {
  let joints = names.map((_, i) => i).filter((i) => g.isJoint[i]), top = (family, side2) => {
    let same = (i) => names[i].family === family && names[i].side === side2, tops = joints.filter((i) => same(i) && !(g.jp[i] >= 0 && same(g.jp[i])));
    return tops.length === 1 ? tops[0] : void 0;
  }, out = {}, [ll, lr, al, ar] = [top("leg", "l"), top("leg", "r"), top("arm", "l"), top("arm", "r")];
  ll !== void 0 && lr !== void 0 && (out.legs = [ll, lr]), al !== void 0 && ar !== void 0 && (out.arms = [al, ar]);
  let heads = joints.filter((i) => names[i].family === "head");
  if (heads.length === 1) out.head = heads[0];
  else if (heads.length === 0) {
    let necks = joints.filter((i) => names[i].family === "neck"), tips = necks.filter((i) => !necks.some((o) => g.jp[o] === i));
    necks.length >= 2 && tips.length === 1 && (out.head = tips[0]);
  }
  return out;
}
var ancestors = (g, i) => {
  let out = [];
  for (let c = i; c >= 0; c = g.jp[c]) out.push(c);
  return out;
};
function lca(g, of) {
  let common = ancestors(g, of[0]);
  for (let i of of) {
    let up = new Set(ancestors(g, i));
    common = common.filter((c) => up.has(c));
  }
  return common[0] ?? -1;
}
var COSINE_UPRIGHT = 0.75;
function build(g, names, an, sided) {
  let hips = lca(g, [an.legs[0], an.legs[1], an.head]);
  if (hips < 0 || [an.legs[0], an.legs[1], an.head].includes(hips)) return "the legs and the head do not meet at a hips joint";
  let legs = an.legs.map((s) => splitLeg(g, limbChain(g, s, names), names)), arms = an.arms.map((s) => splitArm(g, limbChain(g, s, names), names));
  if (legs[0] === void 0 || legs[1] === void 0) return "a leg chain has fewer than hip, knee and ankle joints";
  if (arms[0] === void 0 || arms[1] === void 0) return "an arm chain has fewer than shoulder, elbow and wrist joints";
  let above0 = ancestors(g, an.head), path = above0.slice(0, above0.indexOf(hips) + 1).reverse(), top = lca(g, [g.jp[an.arms[0]], g.jp[an.arms[1]]]);
  for (; top >= 0 && !path.includes(top); ) top = g.jp[top];
  let ti = path.indexOf(top);
  if (ti < 1 || ti >= path.length - 1) return "the arms do not attach to a spine between the hips and the head";
  let torso = path.slice(1, ti + 1), above = path.slice(ti + 1, path.length - 1), up = unit(sub(g.P[an.head], g.P[hips])), axis = (l) => unit(sub(g.P[l.foot], g.P[l.upper])), legPair = [legs[0], legs[1]], upright = -dot(up, unit(add(axis(legs[0]), axis(legs[1]))));
  if (upright < COSINE_UPRIGHT) return "the spine is not opposed to the legs (not an upright biped)";
  if ([legs[0], legs[1]].some((l) => dot(sub(g.P[l.foot], g.P[hips]), up) >= 0) || dot(sub(g.P[an.head], g.P[top]), up) <= 0)
    return "the feet are not below the hips or the head is not above the arms";
  let vote = (f) => {
    let scale = (pathLength(g, [legs[0].upper, legs[0].lower, legs[0].foot], 0, 2) + pathLength(g, [legs[1].upper, legs[1].lower, legs[1].foot], 0, 2)) / 2, toes = 0, knees = 0;
    for (let l of legPair) {
      l.toes !== void 0 && (toes += dot(orth(sub(g.P[l.toes], g.P[l.foot]), up), f));
      let u = g.P[l.upper], w = g.P[l.foot], k = g.P[l.lower], t = len(sub(k, u)) / (len(sub(k, u)) + len(sub(w, k)));
      knees += dot(sub(k, add(u, mul(sub(w, u), t))), f);
    }
    return Math.abs(toes) > 0.1 * scale ? { sign: Math.sign(toes), source: 1 } : Math.abs(knees) > 0.02 * scale ? { sign: Math.sign(knees), source: 0.95 } : { sign: dot(qrot(qconj(g.meshRot), [0, 0, 1]), f) >= 0 ? 1 : -1, source: 0.85 };
  }, left, factor;
  if (sided.legs || sided.arms) {
    let pair = sided.legs ? an.legs : an.arms;
    left = unit(orth(sub(g.P[pair[0]], g.P[pair[1]]), up)), factor = sided.legs && sided.arms && dot(left, unit(orth(sub(g.P[an.arms[0]], g.P[an.arms[1]]), up))) <= 0 ? 0.5 : 1;
    let v = vote(unit(cross(left, up)));
    v.source === 1 && v.sign < 0 && (factor *= 0.5);
  } else {
    let provisional = unit(orth(sub(g.P[an.legs[0]], g.P[an.legs[1]]), up)), v = vote(unit(cross(provisional, up)));
    left = v.sign < 0 ? mul(provisional, -1) : provisional, factor = v.source;
  }
  let forward = unit(cross(left, up)), order = (pair, about, named) => named || dot(sub(g.P[pair[0]], g.P[about]), left) >= dot(sub(g.P[pair[1]], g.P[about]), left) ? [0, 1] : [1, 0], [ll, rl] = order(an.legs, hips, sided.legs), [la, ra] = order(an.arms, top, sided.arms), [LL, RL, LA, RA] = [legs[ll], legs[rl], arms[la], arms[ra]], bones = {
    hips,
    spine: torso[0],
    head: an.head,
    leftUpperLeg: LL.upper,
    leftLowerLeg: LL.lower,
    leftFoot: LL.foot,
    rightUpperLeg: RL.upper,
    rightLowerLeg: RL.lower,
    rightFoot: RL.foot,
    leftUpperArm: LA.upper,
    leftLowerArm: LA.lower,
    leftHand: LA.hand,
    rightUpperArm: RA.upper,
    rightLowerArm: RA.lower,
    rightHand: RA.hand
  }, optional = [
    ["chest", torso[1]],
    ["upperChest", torso.length >= 3 ? torso[torso.length - 1] : void 0],
    ["neck", above.find((j) => names[j].family === "neck") ?? above[0]],
    ["leftShoulder", LA.shoulder],
    ["rightShoulder", RA.shoulder],
    ["leftToes", LL.toes],
    ["rightToes", RL.toes]
  ];
  for (let [bone, joint] of optional) joint !== void 0 && (bones[bone] = joint);
  let tilt = upright >= 0.95 ? 1 : 0.6 + 0.4 * (upright - COSINE_UPRIGHT) / (0.95 - COSINE_UPRIGHT);
  return { bones, up, forward, factor: factor * tilt };
}
function nameMatch(g, names, bone, joint) {
  let p = names[joint], side2 = bone.startsWith("left") ? "l" : bone.startsWith("right") ? "r" : "", rest = side2 === "" ? bone : bone.slice(side2 === "l" ? 4 : 5), part = rest[0].toLowerCase() + rest.slice(1);
  if (p.family === void 0 || p.side !== side2) return 0;
  switch (part) {
    case "hips":
      return p.family === "hips" ? 2 : p.family === "torso" && !(g.jp[joint] >= 0 && names[g.jp[joint]].family === "torso") ? 1 : 0;
    case "spine":
    case "chest":
    case "upperChest":
      return p.family === "torso" ? 2 : 0;
    case "neck":
      return p.family === "neck" ? 2 : 0;
    case "head":
      return p.family === "head" ? 2 : p.family === "neck" ? 1 : 0;
    default: {
      let [family, role] = {
        upperArm: ["arm", "upper"],
        lowerArm: ["arm", "lower"],
        hand: ["arm", "hand"],
        shoulder: ["arm", "shoulder"],
        upperLeg: ["leg", "upper"],
        lowerLeg: ["leg", "lower"],
        foot: ["leg", "foot"],
        toes: ["leg", "toe"]
      }[part];
      return p.family !== family ? 0 : p.role === role ? 2 : p.role === void 0 ? 1 : 0;
    }
  }
}
function mapHumanoid(skin) {
  try {
    if (skin.joints.length < REQUIRED_HUMANOID_BONES.length) return { error: `a humanoid needs at least ${REQUIRED_HUMANOID_BONES.length} joints, the skin has ${skin.joints.length}` };
    let g = analyse(skin), names = skin.nodes.map((n) => parseName(n.name)), byName = nameAnchors(g, names), byShape = structure(g, names), attempts = [], legs = byName.legs ?? byShape?.legs, arms = byName.arms ?? byShape?.arms, head = byName.head ?? byShape?.head;
    legs !== void 0 && arms !== void 0 && head !== void 0 && attempts.push([{ legs, arms, head }, { legs: byName.legs !== void 0, arms: byName.arms !== void 0 }]), byShape !== void 0 && (attempts.length === 0 || attempts[0][0].legs !== byShape.legs || attempts[0][0].arms !== byShape.arms) && attempts.push([byShape, { legs: !1, arms: !1 }]);
    let failure = "no leg pair, arm pair and head found by name or by structure";
    for (let [anchors, sided] of attempts) {
      let built = build(g, names, anchors, sided);
      if (typeof built == "string") {
        anchors === attempts[0][0] && (failure = built);
        continue;
      }
      let bones = {}, evidence = {}, sum = 0;
      for (let [bone, joint] of Object.entries(built.bones)) {
        let name = skin.nodes[joint].name;
        if (skin.nodes.filter((n) => n.name === name).length !== 1) return { error: `the bone name ${JSON.stringify(name)} is not unique` };
        let match = nameMatch(g, names, bone, joint);
        bones[bone] = name, evidence[bone] = match > 0 ? "name" : "structure", REQUIRED_HUMANOID_BONES.includes(bone) && (sum += match === 2 ? 1 : match === 1 ? 0.9 : 0.75);
      }
      return {
        bones,
        evidence,
        confidence: Math.round(Math.min(1, sum / REQUIRED_HUMANOID_BONES.length * built.factor) * 1e3) / 1e3,
        unmapped: OPTIONAL_HUMANOID_BONES.filter((b) => bones[b] === void 0),
        up: built.up,
        forward: built.forward
      };
    }
    return { error: failure };
  } catch (e) {
    return { error: `the skin could not be analysed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// src/scene/animation-script.ts
var LIMBS = { left_leg: "leftLeg", right_leg: "rightLeg", left_arm: "leftArm", right_arm: "rightArm" }, MAX_BLEND_SAMPLES = 32, vec3 = (value) => {
  let v = value;
  return typeof v == "object" && v !== null && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? v : void 0;
}, Frame = class {
  /** The inverse of the linear part, row-major. */
  inverse = new Float64Array(9);
  linear = new Float64Array(9);
  origin;
  valid;
  constructor(world) {
    let m = (r, c) => world[c * 4 + r];
    this.origin = { x: m(0, 3), y: m(1, 3), z: m(2, 3) };
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) this.linear[r * 3 + c] = m(r, c);
    let L = this.linear, cofactor = (r0, c0) => {
      let [r1, r2] = [(r0 + 1) % 3, (r0 + 2) % 3], [c1, c2] = [(c0 + 1) % 3, (c0 + 2) % 3];
      return L[r1 * 3 + c1] * L[r2 * 3 + c2] - L[r1 * 3 + c2] * L[r2 * 3 + c1];
    }, determinant = L[0] * cofactor(0, 0) + L[1] * cofactor(0, 1) + L[2] * cofactor(0, 2);
    if (this.valid = Number.isFinite(determinant) && Math.abs(determinant) > 1e-12, this.valid) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) this.inverse[r * 3 + c] = cofactor(c, r) / determinant;
  }
  /** A world position in mesh-local space. */
  position(p) {
    let d = [p.x - this.origin.x, p.y - this.origin.y, p.z - this.origin.z], I = this.inverse;
    return [0, 1, 2].map((r) => I[r * 3] * d[0] + I[r * 3 + 1] * d[1] + I[r * 3 + 2] * d[2]);
  }
  /** A world surface normal in mesh-local space (the transpose of the linear part), normalised; undefined for a zero normal. */
  normal(n) {
    let L = this.linear, v = [0, 1, 2].map((c) => L[c] * n.x + L[3 + c] * n.y + L[6 + c] * n.z), length = Math.hypot(v[0], v[1], v[2]);
    return length > 1e-12 && Number.isFinite(length) ? [v[0] / length, v[1] / length, v[2] / length] : void 0;
  }
  /** A mesh-local displacement in world space (rotation and scale of the entity, no translation). */
  displacement(v) {
    let L = this.linear;
    return { x: L[0] * v.x + L[1] * v.y + L[2] * v.z, y: L[3] * v.x + L[4] * v.y + L[5] * v.z, z: L[6] * v.x + L[7] * v.y + L[8] * v.z };
  }
}, AnimationScript = class {
  constructor(host) {
    this.host = host;
  }
  host;
  states = /* @__PURE__ */ new WeakMap();
  state(player) {
    let state = this.states.get(player);
    return state === void 0 && (state = { pending: [], parameter: void 0, humanoid: "unknown", limbs: /* @__PURE__ */ new Set(), foot: !1, chains: /* @__PURE__ */ new Set(), reported: /* @__PURE__ */ new Set() }, this.states.set(player, state)), state;
  }
  /** Reports `code` once per entity and `key`; returns false for the caller to return. */
  fail(player, slot, spanId, code, key, message) {
    let state = this.state(player), id = `${code}:${key}`;
    return state.reported.has(id) || (state.reported.add(id), this.host.report(code, slot, spanId, message)), !1;
  }
  /** Runs a mutation of the host API; a refusal (`RangeError`) is `E8113`, once per reason. */
  guarded(player, slot, spanId, what, run) {
    try {
      return run(), !0;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return this.fail(player, slot, spanId, "E8113", error.message, `${what} was dropped: ${error.message}.`);
    }
  }
  hasClip(skin, name) {
    return skin.clips.some((clip) => clip.name === name);
  }
  hasJoint(skin, name) {
    return skin.nodes.some((node) => node.name === name);
  }
  unknown(player, slot, spanId, kind, name, what) {
    return this.fail(player, slot, spanId, "E8111", `${kind}:${name}`, `${what} was dropped: the entity has no ${kind} '${name}'.`);
  }
  /** Maps the skeleton once; false (with `E8112`, once) when it is no humanoid. */
  ensureHumanoid(player, slot, spanId, what) {
    let state = this.state(player);
    if (state.humanoid === "mapped") return !0;
    if (state.humanoid === "unknown") {
      let map = mapHumanoid(player.skin);
      if ("error" in map)
        return state.humanoid = "rejected", this.fail(player, slot, spanId, "E8112", "humanoid", `${what} was dropped: the skeleton is not a humanoid (${map.error}).`), !1;
      try {
        player.setHumanoid(map);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        return state.humanoid = "rejected", this.fail(player, slot, spanId, "E8112", "humanoid", `${what} was dropped: the skeleton cannot be used as a humanoid (${error.message}).`), !1;
      }
      return state.humanoid = "mapped", !0;
    }
    return !1;
  }
  frame(slot) {
    let world = this.host.world(slot), frame = world === void 0 ? void 0 : new Frame(world);
    return frame?.valid === !0 ? frame : void 0;
  }
  // ---- layers ----
  setLayer(slot, id, clip, weight, additive, mask, spanId) {
    let player = this.host.player(slot);
    if (player === void 0 || !Number.isFinite(weight)) return !1;
    let what = `animation.set_layer('${id}')`;
    return this.hasClip(player.skin, clip) ? mask !== "" && !this.hasJoint(player.skin, mask) ? this.unknown(player, slot, spanId, "joint", mask, what) : this.guarded(player, slot, spanId, what, () => {
      player.layers.set(id, { clip, weight: Math.max(0, Math.min(1, weight)), additive, ...mask === "" ? {} : { subtree: mask } });
    }) : this.unknown(player, slot, spanId, "clip", clip, what);
  }
  fadeLayer(slot, id, weight, seconds, spanId) {
    let player = this.host.player(slot);
    return player === void 0 || !Number.isFinite(weight) || !Number.isFinite(seconds) || seconds < 0 ? !1 : player.layers.fade(id, Math.max(0, Math.min(1, weight)), seconds) || this.unknown(player, slot, spanId, "layer", id, `animation.fade_layer('${id}')`);
  }
  removeLayer(slot, id) {
    let player = this.host.player(slot);
    return player === void 0 || !player.layers.inspect().some((layer) => layer.id === id) ? !1 : (player.layers.remove(id), !0);
  }
  // ---- blend spaces ----
  blendSample(slot, clip, x, y, spanId) {
    let player = this.host.player(slot);
    if (player === void 0 || !Number.isFinite(x) || !Number.isFinite(y)) return !1;
    let what = `animation.blend_sample('${clip}')`;
    if (!this.hasClip(player.skin, clip)) return this.unknown(player, slot, spanId, "clip", clip, what);
    let state = this.state(player);
    return state.pending.length >= MAX_BLEND_SAMPLES ? this.fail(player, slot, spanId, "E8113", "blend-size", `${what} was dropped: a blend space holds at most ${String(MAX_BLEND_SAMPLES)} samples.`) : (state.pending.push({ clip, x, y }), !0);
  }
  blendPlay(slot, looping, speed, spanId) {
    let player = this.host.player(slot);
    if (player === void 0 || !Number.isFinite(speed) || speed < 0) return !1;
    let state = this.state(player), samples = state.pending, parameter = state.parameter;
    return state.pending = [], state.parameter = void 0, samples.length === 0 ? this.fail(player, slot, spanId, "E8111", "blend:pending", "animation.blend_play was dropped: no blend_sample came before it.") : this.guarded(player, slot, spanId, "animation.blend_play", () => {
      player.blend.set({ samples, looping, speed, ...parameter === void 0 ? {} : { parameter } });
    });
  }
  blendParameter(slot, x, y) {
    let player = this.host.player(slot);
    if (player === void 0 || !Number.isFinite(x) || !Number.isFinite(y)) return !1;
    let state = this.state(player);
    return state.pending.length > 0 && (state.parameter = { x, y }), player.blend.active && player.blend.setParameter(x, y), player.blend.active || state.pending.length > 0;
  }
  blendClear(slot) {
    let player = this.host.player(slot);
    if (player === void 0) return !1;
    let state = this.state(player), had = player.blend.active || state.pending.length > 0;
    return state.pending = [], state.parameter = void 0, player.blend.active && player.blend.set(void 0), had;
  }
  blendPhase(slot) {
    let player = this.host.player(slot);
    return player?.blend.active === !0 ? Math.fround(player.blend.phase) : 0;
  }
  // ---- limbs, feet and chains ----
  limbGoal(slot, limb, goal, weight, spanId) {
    let player = this.host.player(slot), target = vec3(goal);
    if (player === void 0 || target === void 0 || !Number.isFinite(weight)) return !1;
    let what = `animation.limb_goal('${limb}')`, name = LIMBS[limb];
    if (name === void 0) return this.unknown(player, slot, spanId, "limb", limb, what);
    if (!this.ensureHumanoid(player, slot, spanId, what)) return !1;
    let frame = this.frame(slot);
    if (frame === void 0) return !1;
    let applied = this.guarded(player, slot, spanId, what, () => {
      player.ik.setLimb(`limb:${limb}`, { limb: name, target: frame.position(target), weight: Math.max(0, Math.min(1, weight)) });
    });
    return applied && this.state(player).limbs.add(limb), applied;
  }
  clearLimb(slot, limb, spanId) {
    let player = this.host.player(slot);
    return player === void 0 ? !1 : LIMBS[limb] === void 0 ? this.unknown(player, slot, spanId, "limb", limb, `animation.clear_limb('${limb}')`) : this.state(player).limbs.delete(limb) ? (player.ik.remove(`limb:${limb}`), !0) : !1;
  }
  footPlacement(slot, left, right, leftNormal, rightNormal, leftWeight, rightWeight, spanId) {
    let player = this.host.player(slot), [l, r, ln, rn] = [vec3(left), vec3(right), vec3(leftNormal), vec3(rightNormal)];
    if (player === void 0 || l === void 0 || r === void 0 || ln === void 0 || rn === void 0 || !Number.isFinite(leftWeight) || !Number.isFinite(rightWeight)) return !1;
    let what = "animation.foot_placement";
    if (!this.ensureHumanoid(player, slot, spanId, what)) return !1;
    let frame = this.frame(slot);
    if (frame === void 0) return !1;
    let ground = (point, normal, weight) => {
      let local = frame.normal(normal);
      return { point: frame.position(point), weight: Math.max(0, Math.min(1, weight)), ...local === void 0 ? {} : { normal: local } };
    }, applied = this.guarded(player, slot, spanId, what, () => {
      player.ik.setFootPlacement({ left: ground(l, ln, leftWeight), right: ground(r, rn, rightWeight) });
    });
    return applied && (this.state(player).foot = !0), applied;
  }
  clearFootPlacement(slot) {
    let player = this.host.player(slot);
    if (player === void 0) return !1;
    let state = this.state(player);
    return state.foot ? (state.foot = !1, player.ik.setFootPlacement(void 0), !0) : !1;
  }
  chainGoal(slot, id, endJoint, length, goal, weight, spanId) {
    let player = this.host.player(slot), target = vec3(goal);
    if (player === void 0 || target === void 0 || !Number.isFinite(weight) || !Number.isInteger(length)) return !1;
    let what = `animation.chain_goal('${id}')`, end = player.skin.nodes.findIndex((node) => node.name === endJoint);
    if (end < 0) return this.unknown(player, slot, spanId, "joint", endJoint, what);
    let chain = [];
    for (let node = end; node >= 0 && chain.length < length; node = player.skin.nodes[node].parent) chain.unshift(player.skin.nodes[node].name);
    if (length < 2 || chain.length < length)
      return this.fail(player, slot, spanId, "E8113", `chain:${id}:${String(length)}`, `${what} was dropped: '${endJoint}' and ${String(length - 1)} ancestors do not form a chain of ${String(length)} joints.`);
    let frame = this.frame(slot);
    if (frame === void 0) return !1;
    let applied = this.guarded(player, slot, spanId, what, () => {
      player.ik.set(id, { chain, target: frame.position(target), weight: Math.max(0, Math.min(1, weight)) });
    });
    return applied && this.state(player).chains.add(id), applied;
  }
  clearChain(slot, id) {
    let player = this.host.player(slot);
    return player === void 0 || !this.state(player).chains.delete(id) ? !1 : (player.ik.remove(id), !0);
  }
  // ---- root motion ----
  rootMotion(slot, joint, spanId) {
    let player = this.host.player(slot);
    return player === void 0 ? !1 : joint === "" ? (player.setRootMotion(void 0), !0) : this.hasJoint(player.skin, joint) ? (player.setRootMotion(joint), !0) : this.unknown(player, slot, spanId, "joint", joint, `animation.root_motion('${joint}')`);
  }
  /** The root displacement accumulated since the last call, in world space; consumed. Zero without root ownership. */
  takeRootMotion(slot) {
    let zero = { x: 0, y: 0, z: 0 }, player = this.host.player(slot);
    if (player === void 0) return zero;
    let local = player.consumeRootMotionLocal(), world = this.host.world(slot);
    if (world === void 0) return zero;
    let d = new Frame(world).displacement(local);
    return { x: Math.fround(d.x), y: Math.fround(d.y), z: Math.fround(d.z) };
  }
};

// src/scene/clips.ts
function sampleChannelInto(channel, time, out) {
  let comps = channelWidth(channel), times = channel.times, count = times.length, values = channel.values, identity2 = () => {
    out[0] = 0, out[1] = 0, out[2] = 0, comps === 4 && (out[3] = 1);
  };
  if (count === 0) {
    identity2();
    return;
  }
  let first = times[0] ?? 0;
  if (time <= first) {
    for (let i = 0; i < comps; i += 1) out[i] = values[i] ?? 0;
    comps === 4 && normalizeInto(out);
    return;
  }
  let hi = 1;
  for (; hi < count && (times[hi] ?? 0) <= time; ) hi += 1;
  let lo = hi - 1, from = lo * comps;
  if (channel.interpolation === "step" || hi >= count) {
    for (let i = 0; i < comps; i += 1) out[i] = values[from + i] ?? 0;
    comps === 4 && normalizeInto(out);
    return;
  }
  let t0 = times[lo] ?? 0, span = (times[hi] ?? t0) - t0, t = span === 0 ? 0 : (time - t0) / span, to = hi * comps;
  if (comps === 4) {
    let dot3 = 0;
    for (let i = 0; i < 4; i += 1) dot3 += (values[from + i] ?? 0) * (values[to + i] ?? 0);
    let sign = dot3 < 0 ? -1 : 1, angle = Math.acos(Math.min(1, Math.abs(dot3))), sine = Math.sin(angle), aWeight = sine > 1e-6 ? Math.sin((1 - t) * angle) / sine : 1 - t, bWeight = sine > 1e-6 ? Math.sin(t * angle) / sine : t;
    for (let i = 0; i < 4; i += 1) {
      let a = values[from + i] ?? 0;
      out[i] = a * aWeight + sign * (values[to + i] ?? 0) * bWeight;
    }
    normalizeInto(out);
    return;
  }
  for (let i = 0; i < 3; i += 1) {
    let a = values[from + i] ?? 0;
    out[i] = a + ((values[to + i] ?? a) - a) * t;
  }
}
function channelWidth(channel) {
  return channel.path === "rotation" ? 4 : 3;
}
function normalizeInto(value) {
  let length = Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0);
  if (!(length > 0)) {
    value[0] = 0, value[1] = 0, value[2] = 0, value[3] = 1;
    return;
  }
  for (let i = 0; i < 4; i += 1) value[i] = (value[i] ?? 0) / length;
}
var ClipPlayers = class {
  players = [];
  scratch = new Float64Array(4);
  add(clip) {
    this.remove(clip.slot), this.players.push({
      clip,
      time: 0,
      playing: !0,
      looping: !0,
      speed: 1,
      finished: !1,
      weight: 1,
      fadeFrom: 1,
      fadeTo: 1,
      fadeTime: 0,
      fadeDuration: 0,
      previous: 0,
      travel: 0
    });
  }
  player(slot) {
    return this.players.find((player) => player.clip.slot === slot);
  }
  play(slot, looping, speed) {
    let p = this.player(slot);
    return p === void 0 || !Number.isFinite(speed) || speed < 0 ? !1 : (p.time = 0, p.previous = 0, p.travel = 0, p.looping = looping, p.speed = speed, p.finished = !looping && p.clip.duration === 0, p.playing = !p.finished, !0);
  }
  pause(slot) {
    let p = this.player(slot);
    return p === void 0 ? !1 : (p.playing = !1, !0);
  }
  resume(slot) {
    let p = this.player(slot);
    return p === void 0 || p.finished ? !1 : (p.playing = !0, !0);
  }
  seek(slot, time) {
    let p = this.player(slot);
    return p === void 0 || !Number.isFinite(time) ? !1 : (p.time = Math.max(0, Math.min(p.clip.duration, time)), p.previous = p.time, p.travel = 0, p.finished = !p.looping && p.time === p.clip.duration, p.finished && (p.playing = !1), !0);
  }
  fade(slot, weight, duration) {
    let p = this.player(slot);
    return p === void 0 || !Number.isFinite(weight) || !Number.isFinite(duration) || duration < 0 ? !1 : (p.fadeFrom = p.weight, p.fadeTo = Math.max(0, Math.min(1, weight)), p.fadeDuration = duration, p.fadeTime = 0, duration === 0 && (p.weight = p.fadeTo), !0);
  }
  time(slot) {
    return this.player(slot)?.time ?? 0;
  }
  duration(slot) {
    return this.player(slot)?.clip.duration ?? 0;
  }
  weight(slot) {
    return this.player(slot)?.weight ?? 0;
  }
  playing(slot) {
    return this.player(slot)?.playing ?? !1;
  }
  finished(slot) {
    return this.player(slot)?.finished ?? !1;
  }
  /** Number of wraps during the latest advance; seeking and play reset this to zero. */
  wraps(slot) {
    let p = this.player(slot);
    return p === void 0 || p.clip.duration <= 0 ? 0 : Math.max(0, Math.round((p.previous + p.travel - p.time) / p.clip.duration));
  }
  /** A marker in (0, duration] crossed during the latest advance, even across wraps/hitches. */
  crossed(slot, marker) {
    let p = this.player(slot);
    if (p === void 0 || !Number.isFinite(marker) || marker <= 0 || marker > p.clip.duration || p.travel <= 0) return !1;
    let distance = marker - p.previous;
    return distance <= 0 && p.looping && (distance += p.clip.duration), distance > 0 && distance <= p.travel;
  }
  remove(slot) {
    let index = this.players.findIndex((player) => player.clip.slot === slot);
    index >= 0 && this.players.splice(index, 1);
  }
  /** Writes every channel at `time` (the player's own time when omitted) without advancing. */
  pose(apply, time) {
    for (let player of this.players)
      for (let channel of player.clip.channels) this.write(apply, player, channel, time ?? player.time);
  }
  poseSlot(slot, apply) {
    let p = this.player(slot);
    if (p !== void 0) for (let channel of p.clip.channels) this.write(apply, p, channel, p.time);
  }
  /** Advances by `dt` seconds, wrapping after the duration, then writes the new pose. */
  advance(dt, apply) {
    if (!(!Number.isFinite(dt) || dt < 0))
      for (let player of this.players) {
        player.previous = player.time, player.travel = player.playing ? dt * player.speed : 0;
        let next = player.time + player.travel, { duration } = player.clip;
        if (!player.looping && next >= duration ? (next = duration, player.travel = duration - player.time, player.finished = !0, player.playing = !1) : duration > 0 && next > duration && (next %= duration), duration === 0 && (next = 0), player.time = next, player.fadeDuration > 0) {
          player.fadeTime = Math.min(player.fadeDuration, player.fadeTime + dt);
          let t = player.fadeTime / player.fadeDuration, eased = t * t * (3 - 2 * t);
          player.weight = player.fadeFrom + (player.fadeTo - player.fadeFrom) * eased;
        }
        for (let channel of player.clip.channels) this.write(apply, player, channel, next);
      }
  }
  write(apply, player, channel, time) {
    sampleChannelInto(channel, time, this.scratch);
    let weight = player.weight;
    if (channel.path === "rotation") {
      let w = this.scratch[3] ?? 1, sign = w < 0 ? -1 : 1, angle = Math.acos(Math.min(1, Math.abs(w))), sine = Math.sin(angle), factor = sine > 1e-6 ? Math.sin(weight * angle) / sine : weight;
      for (let i = 0; i < 3; i += 1) this.scratch[i] = (this.scratch[i] ?? 0) * factor * sign;
      this.scratch[3] = Math.cos(weight * angle), normalizeInto(this.scratch);
    } else {
      let base = channel.path === "scale" ? 1 : 0;
      for (let i = 0; i < 3; i += 1) this.scratch[i] = base + ((this.scratch[i] ?? base) - base) * weight;
    }
    apply(player.clip.slot, channel, this.scratch);
  }
};

// src/scene/skin-problem.ts
function skinProblem(skin, vertices) {
  let n = skin.nodes.length;
  if (n > 256 || skin.joints.length > 128) return "skin exceeds the 256-node or 128-joint profile";
  let index = (i, max) => Number.isInteger(i) && i >= 0 && i < max, finite2 = (values, length) => values.length === length && values.every(Number.isFinite);
  if (!index(skin.meshNode, n) || skin.joints.length === 0 || skin.joints.some((j) => !index(j, n)) || skin.inverseBind.length !== skin.joints.length || skin.inverseBind.some((m) => !finite2(m, 16))) return "skin node or inverse-bind count is invalid";
  if (skin.indices.length !== vertices || skin.weights.length !== vertices) return "skin influences do not match the vertex count";
  for (let i = 0; i < n; i++) {
    let node = skin.nodes[i];
    if (node.parent !== -1 && !index(node.parent, n) || !finite2(node.translation, 3) || !finite2(node.rotation, 4) || !finite2(node.scale, 3) || node.scale.some((v) => v <= 0) || Math.hypot(...node.rotation) < 1e-8) return "invalid skeletal bind transform";
    let parent = i;
    for (let depth = 0; parent >= 0; depth++) {
      if (!index(parent, n)) return "invalid skeletal bind transform";
      if (depth >= n) return "cyclic skeletal hierarchy";
      parent = skin.nodes[parent].parent;
    }
  }
  for (let i = 0; i < vertices; i++) {
    let weights = skin.weights[i];
    if (skin.indices[i].length !== 4 || skin.indices[i].some((j) => !index(j, skin.joints.length)) || !finite2(weights, 4) || weights.some((w) => w < 0) || Math.abs(weights.reduce((a, b) => a + b, 0) - 1) > 1e-3) return "invalid vertex joint indices or weights";
  }
  let names = /* @__PURE__ */ new Set();
  for (let clip of skin.clips) {
    if (names.has(clip.name)) return "duplicate skeletal clip name";
    if (!Number.isFinite(clip.duration) || clip.duration < 0) return "invalid skeletal clip duration";
    names.add(clip.name);
    let channels = /* @__PURE__ */ new Set();
    for (let c of clip.channels) {
      let key = String(c.node) + c.path;
      if (!index(c.node, n) || channels.has(key) || c.times.length === 0 || c.values.length !== c.times.length * (c.path === "rotation" ? 4 : 3) || c.values.some((v) => !Number.isFinite(v)) || c.times.some((t, i) => !Number.isFinite(t) || t < 0 || t > clip.duration || i > 0 && t <= c.times[i - 1]) || c.path === "scale" && c.values.some((v) => v <= 0)) return "invalid skeletal clip channel";
      if (c.path === "rotation") {
        for (let k = 0; k < c.values.length; k += 4) if (Math.hypot(...c.values.slice(k, k + 4)) < 1e-8) return "invalid skeletal rotation";
      }
      channels.add(key);
    }
  }
}

// src/scene/humanoid-retarget.ts
var ALL_BONES = [...REQUIRED_HUMANOID_BONES, ...OPTIONAL_HUMANOID_BONES], CHAINS = [
  ["hips", "spine", "chest", "upperChest", "neck", "head"],
  ["leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"],
  ["rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"],
  ["leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes"],
  ["rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes"]
], CANONICAL = {
  hips: [0, 1, 0],
  spine: [0, 1, 0],
  chest: [0, 1, 0],
  upperChest: [0, 1, 0],
  neck: [0, 1, 0],
  leftShoulder: [1, 0, 0],
  leftUpperArm: [1, 0, 0],
  leftLowerArm: [1, 0, 0],
  rightShoulder: [-1, 0, 0],
  rightUpperArm: [-1, 0, 0],
  rightLowerArm: [-1, 0, 0],
  leftUpperLeg: [0, -1, 0],
  leftLowerLeg: [0, -1, 0],
  rightUpperLeg: [0, -1, 0],
  rightLowerLeg: [0, -1, 0],
  leftFoot: [0, 0, 1],
  rightFoot: [0, 0, 1]
};
function side(skin, map, what) {
  let problem = skinProblem(skin, skin.indices.length);
  if (problem !== void 0) throw new RangeError(`${what}: ${problem}`);
  if (!uniformScales(skin)) throw new RangeError(`${what}: humanoid retargeting requires uniform bind scales`);
  let index = /* @__PURE__ */ new Map();
  skin.nodes.forEach((n, i) => index.set(n.name, i));
  let up = unit(map.up), forward = unit(map.forward), left = cross(up, forward);
  return {
    skin,
    rig: analyse(skin),
    map,
    basis: qbasis(left, up, forward),
    left,
    up,
    forward,
    node: (bone) => index.get(map.bones[bone])
  };
}
function mapOf(skin, given, what) {
  let map = given ?? mapHumanoid(skin);
  if ("error" in map) throw new RangeError(`Humanoid mapping failed for the ${what}: ${map.error}`);
  return map;
}
function restOrientations(s, shared, correct) {
  let out = /* @__PURE__ */ new Map(), turn = /* @__PURE__ */ new Map();
  for (let chain of CHAINS) {
    let members = chain.filter((b) => shared.includes(b));
    members.forEach((bone, i) => {
      let next = members[i + 1], canonical = CANONICAL[bone], rotation = [0, 0, 0, 1];
      if (correct && next !== void 0 && canonical !== void 0) {
        let bind = sub(s.rig.P[s.node(next)], s.rig.P[s.node(bone)]);
        len(bind) > 1e-9 && (rotation = qarc(unit(bind), qrot(s.basis, canonical)));
      } else correct && i > 0 && (rotation = turn.get(members[i - 1]));
      turn.set(bone, rotation), out.set(bone, qnorm(qmul(rotation, s.rig.Q[s.node(bone)])));
    });
  }
  return out;
}
var legLength = (s) => {
  let sum = 0;
  for (let prefix of ["left", "right"]) {
    let [u, l, f] = ["UpperLeg", "LowerLeg", "Foot"].map((p) => s.rig.P[s.node(`${prefix}${p}`)]);
    sum += len(sub(l, u)) + len(sub(f, l));
  }
  return sum / 2;
}, dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function retargetHumanoid(source, target, options = {}) {
  let { translationScale, restCorrection = !0, maxKeyInterval = 1 / 30 } = options;
  if (translationScale !== void 0 && !(Number.isFinite(translationScale) && translationScale > 0)) throw new RangeError("Retarget translation scale must be positive");
  if (!(Number.isFinite(maxKeyInterval) && maxKeyInterval > 0)) throw new RangeError("The retarget key interval must be positive");
  let S = side(source, mapOf(source, options.sourceMap, "source"), "source"), T = side(target, mapOf(target, options.targetMap, "target"), "target"), shared = ALL_BONES.filter((b) => S.map.bones[b] !== void 0 && T.map.bones[b] !== void 0), restS = restOrientations(S, shared, restCorrection), restT = restOrientations(T, shared, restCorrection), B = qmul(T.basis, qconj(S.basis)), sourceOf = /* @__PURE__ */ new Map(), targetOf = /* @__PURE__ */ new Map();
  for (let b of shared)
    sourceOf.set(S.node(b), b), targetOf.set(T.node(b), b);
  let ratio = translationScale ?? legLength(T) / legLength(S), hipsS = S.node("hips"), hipsT = T.node("hips"), ground = (x) => ["leftFoot", "rightFoot"].reduce((sum, b) => sum + dotv(x.rig.P[x.node(b)], x.up), 0) / 2, reference = (x, bone) => [dotv(x.rig.P[bone], x.left), dotv(x.rig.P[bone], x.up), dotv(x.rig.P[bone], x.forward)], bindS = reference(S, hipsS), bindT = reference(T, hipsT), groundS = ground(S), groundT = ground(T), pelvis = (x) => dotv(x.rig.P[x.node("hips")], x.up) - (dotv(x.rig.P[x.node("leftUpperLeg")], x.up) + dotv(x.rig.P[x.node("rightUpperLeg")], x.up)) / 2, pelvisS = pelvis(S), pelvisT = pelvis(T), orderS = S.rig.order, orderT = T.rig.order, tNode = (i) => T.skin.nodes[i], hipsParent = tNode(hipsT).parent, hipsParentScale = hipsParent < 0 ? T.rig.origin.scale : T.rig.S[hipsParent], clips = S.skin.clips.map((clip) => {
    let rotation = /* @__PURE__ */ new Map(), translation = /* @__PURE__ */ new Map();
    for (let c of clip.channels) (c.path === "rotation" ? rotation : c.path === "translation" ? translation : /* @__PURE__ */ new Map()).set(c.node, c);
    let stamps = /* @__PURE__ */ new Set([0, clip.duration]);
    for (let c of clip.channels) for (let t of c.times) stamps.add(t);
    let times = [...stamps].filter((t) => t >= 0 && t <= clip.duration).sort((a, b) => a - b), dense = [];
    times.forEach((t, i) => {
      dense.push(t);
      let gap = times[i + 1] === void 0 ? 0 : times[i + 1] - t, steps = Math.ceil(gap / maxKeyInterval - 1e-9);
      for (let k = 1; k < steps; k++) dense.push(t + gap * k / steps);
    }), times = dense;
    let scratch = new Float64Array(4), sample = (map, node, t, bind) => {
      let c = map.get(node);
      return c === void 0 ? bind : (sampleChannelInto(c, t, scratch), scratch);
    }, rotations = /* @__PURE__ */ new Map(), hips = [];
    for (let b of shared) rotations.set(T.node(b), []);
    let animatedHips = [...translation.keys()].some((n) => {
      for (let c = hipsS; c >= 0; c = S.skin.nodes[c].parent) if (c === n) return !0;
      return !1;
    }), Qs = [], Qt = [], meshInverseT = qconj(T.rig.meshRot);
    for (let t of times) {
      let world = worldSimilarity(S.skin, orderS, (i) => {
        let n = S.skin.nodes[i], r = sample(rotation, i, t, n.rotation), q = [r[0], r[1], r[2], r[3]], p = sample(translation, i, t, n.translation);
        return { t: [p[0], p[1], p[2]], r: q, s: n.scale[0] };
      }), inverseMesh = qconj(world.rot[S.skin.meshNode]);
      for (let i of orderS) Qs[i] = qnorm(qmul(inverseMesh, world.rot[i]));
      for (let i of orderT) {
        let parent = tNode(i).parent, base = parent < 0 ? meshInverseT : Qt[parent], bone = targetOf.get(i);
        if (bone === void 0) {
          Qt[i] = qnorm(qmul(base, tNode(i).rotation));
          continue;
        }
        let a = S.node(bone), delta = qmul(Qs[a], qconj(restS.get(bone)));
        Qt[i] = qnorm(qmul(qmul(qmul(B, delta), qconj(B)), restT.get(bone)));
        let local = qnorm(qmul(qconj(base), Qt[i])), list = rotations.get(i), at2 = list.length - 4, flip = at2 >= 0 && list[at2] * local[0] + list[at2 + 1] * local[1] + list[at2 + 2] * local[2] + list[at2 + 3] * local[3] < 0 ? -1 : 1;
        list.push(local[0] * flip, local[1] * flip, local[2] * flip, local[3] * flip);
      }
      if (animatedHips) {
        let meshPos = world.pos[S.skin.meshNode], p = mul3(qrot(inverseMesh, sub(world.pos[hipsS], meshPos)), 1 / world.scale[S.skin.meshNode]), c = [dotv(p, S.left), dotv(p, S.up), dotv(p, S.forward)], l = bindT[0] + ratio * (c[0] - bindS[0]), u = groundT + pelvisT + ratio * (c[1] - pelvisS - groundS), f = bindT[2] + ratio * (c[2] - bindS[2]), mine = [T.left[0] * l + T.up[0] * u + T.forward[0] * f, T.left[1] * l + T.up[1] * u + T.forward[1] * f, T.left[2] * l + T.up[2] * u + T.forward[2] * f], parentPos = hipsParent < 0 ? T.rig.origin.pos : T.rig.P[hipsParent], parentRot = hipsParent < 0 ? meshInverseT : Qt[hipsParent], local = mul3(qrot(qconj(parentRot), sub(mine, parentPos)), 1 / hipsParentScale);
        hips.push(local[0], local[1], local[2]);
      }
    }
    let channels = [...rotations].map(([node, values]) => ({ node, path: "rotation", interpolation: "linear", times, values }));
    return animatedHips && channels.push({ node: hipsT, path: "translation", interpolation: "linear", times, values: hips }), { name: clip.name, duration: clip.duration, channels };
  }), result = { ...target, clips }, problem = skinProblem(result, result.indices.length);
  if (problem !== void 0) throw new RangeError(`Humanoid retargeting produced an invalid skin: ${problem}`);
  return result;
}
var mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// src/math/mat4.ts
function at(a, i) {
  let value = a[i];
  if (value === void 0) throw new RangeError(`matrix index ${i} out of range`);
  return value;
}
function identity() {
  let m = new Float32Array(16);
  return m[0] = 1, m[5] = 1, m[10] = 1, m[15] = 1, m;
}
function multiplyInto(out, a, b) {
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  return out;
}
function rotationInto(m, q) {
  let { x, y, z, w } = q, xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return m[0] = 1 - 2 * (yy + zz), m[1] = 2 * (xy + wz), m[2] = 2 * (xz - wy), m[3] = 0, m[4] = 2 * (xy - wz), m[5] = 1 - 2 * (xx + zz), m[6] = 2 * (yz + wx), m[7] = 0, m[8] = 2 * (xz + wy), m[9] = 2 * (yz - wx), m[10] = 1 - 2 * (xx + yy), m[11] = 0, m[12] = 0, m[13] = 0, m[14] = 0, m[15] = 1, m;
}
function fromRotationTranslationScaleInto(out, scratch, rotationQuat, translationVec, scale) {
  let r = rotationInto(scratch, rotationQuat), sx = scale.x, sy = scale.y, sz = scale.z;
  return out[0] = r[0] * sx, out[1] = r[1] * sx, out[2] = r[2] * sx, out[3] = 0, out[4] = r[4] * sy, out[5] = r[5] * sy, out[6] = r[6] * sy, out[7] = 0, out[8] = r[8] * sz, out[9] = r[9] * sz, out[10] = r[10] * sz, out[11] = 0, out[12] = translationVec.x, out[13] = translationVec.y, out[14] = translationVec.z, out[15] = 1, out;
}
function normalMatrixInto(out, offset, model) {
  let a = at(model, 0), b = at(model, 4), c = at(model, 8), d = at(model, 1), e = at(model, 5), f = at(model, 9), g = at(model, 2), h = at(model, 6), i = at(model, 10), c00 = e * i - f * h, c01 = f * g - d * i, c02 = d * h - e * g, c10 = c * h - b * i, c11 = a * i - c * g, c12 = b * g - a * h, c20 = b * f - c * e, c21 = c * d - a * f, c22 = a * e - b * d, det = a * c00 + b * c01 + c * c02;
  if (det === 0 || !Number.isFinite(det))
    throw new RangeError("normal matrix of a singular transform is undefined");
  let inv = 1 / det;
  return out[offset] = c00 * inv, out[offset + 1] = c10 * inv, out[offset + 2] = c20 * inv, out[offset + 3] = 0, out[offset + 4] = c01 * inv, out[offset + 5] = c11 * inv, out[offset + 6] = c21 * inv, out[offset + 7] = 0, out[offset + 8] = c02 * inv, out[offset + 9] = c12 * inv, out[offset + 10] = c22 * inv, out[offset + 11] = 0, out[offset + 12] = 0, out[offset + 13] = 0, out[offset + 14] = 0, out[offset + 15] = 1, out;
}

// src/scene/animation-players.ts
var AnimationPlayers = class {
  nodes = new ClipPlayers();
  /** The skeletal player of `slot`: none without the animation module. */
  skin(slot) {
  }
  share(source, targets) {
    throw new RangeError("Animation sharing needs a skinned source");
  }
  detach(slot) {
    throw new RangeError("Animation detaching needs a skinned entity");
  }
  add(clip) {
    this.nodes.add(clip);
  }
  addSkin(slot, skin, clip) {
    throw new Error("A skinned mesh needs the animation module, which is not loaded");
  }
  remove(slot) {
    this.nodes.remove(slot);
  }
  copyPose(target, source) {
    return !1;
  }
  transition(slot, name, seconds, looping, speed) {
    return !1;
  }
  play(slot, looping, speed) {
    return this.nodes.play(slot, looping, speed);
  }
  pause(slot) {
    return this.nodes.pause(slot);
  }
  resume(slot) {
    return this.nodes.resume(slot);
  }
  seek(slot, time) {
    return this.nodes.seek(slot, time);
  }
  fade(slot, weight, duration) {
    return this.nodes.fade(slot, weight, duration);
  }
  time(slot) {
    return this.nodes.time(slot);
  }
  duration(slot) {
    return this.nodes.duration(slot);
  }
  weight(slot) {
    return this.nodes.weight(slot);
  }
  playing(slot) {
    return this.nodes.playing(slot);
  }
  finished(slot) {
    return this.nodes.finished(slot);
  }
  crossed(slot, marker) {
    return this.nodes.crossed(slot, marker);
  }
  /** `distance` is the camera distance of a slot, which only skeletal update policies use. */
  advance(dt, apply, distance) {
    this.nodes.advance(dt, apply);
  }
  pose(apply, time) {
    this.nodes.pose(apply, time);
  }
  poseSlot(slot, apply) {
    this.nodes.poseSlot(slot, apply);
  }
};

// src/scene/pose-layers.ts
function multiplyQuat(out, at2, a, ai, b, bi) {
  let x = a[ai], y = a[ai + 1], z = a[ai + 2], w = a[ai + 3], u = b[bi], v = b[bi + 1], s = b[bi + 2], t = b[bi + 3];
  out[at2] = w * u + x * t + y * s - z * v, out[at2 + 1] = w * v - x * s + y * t + z * u, out[at2 + 2] = w * s + x * v - y * u + z * t, out[at2 + 3] = w * t - x * u - y * v - z * s;
}
function blendQuat(out, at2, b, bi, weight) {
  let dot3 = 0;
  for (let i = 0; i < 4; i++) dot3 += out[at2 + i] * b[bi + i];
  let angle = Math.acos(Math.min(1, Math.abs(dot3))), sine = Math.sin(angle), aWeight = sine > 1e-6 ? Math.sin((1 - weight) * angle) / sine : 1 - weight, bWeight = (sine > 1e-6 ? Math.sin(weight * angle) / sine : weight) * (dot3 < 0 ? -1 : 1);
  for (let i = 0; i < 4; i++)
    out[at2 + i] = out[at2 + i] * aWeight + b[bi + i] * bWeight;
  let length = Math.hypot(out[at2], out[at2 + 1], out[at2 + 2], out[at2 + 3]);
  for (let i = 0; i < 4; i++) out[at2 + i] = out[at2 + i] / length;
}
var PoseLayers = class {
  constructor(skin) {
    this.skin = skin;
  }
  skin;
  layers = /* @__PURE__ */ new Map();
  value = new Float64Array(4);
  rotation = new Float64Array(4);
  inverse = new Float64Array(4);
  revision = 0;
  inspect() {
    return [...this.layers].map(([id, { options, mask, clock, weight, fade }]) => ({
      id,
      clip: options.clip,
      weight,
      targetWeight: fade?.to ?? weight,
      fadeRemaining: fade === void 0 ? 0 : fade.duration - fade.elapsed,
      additive: options.additive ?? !1,
      time: clock.time(0),
      duration: clock.duration(0),
      playing: clock.playing(0),
      mask: [...mask]
    }));
  }
  set(id, options) {
    let clip = this.skin.clips.find((c) => c.name === options.clip);
    if (id === "" || clip === void 0)
      throw new RangeError("A layer needs an ID and an existing clip");
    if (!Number.isFinite(options.weight) || options.weight < 0 || options.weight > 1 || !Number.isFinite(options.speed ?? 1) || (options.speed ?? 1) < 0)
      throw new RangeError("Invalid animation layer weight or speed");
    let mask = new Float64Array(this.skin.nodes.length).fill(
      options.mask === void 0 && options.subtree === void 0 ? 1 : 0
    );
    if (options.subtree !== void 0) {
      let root = this.skin.nodes.findIndex((n) => n.name === options.subtree);
      if (root < 0) throw new RangeError(`Invalid bone mask: ${options.subtree}`);
      this.skin.nodes.forEach((_, i) => {
        for (let node = i; node >= 0; node = this.skin.nodes[node].parent)
          if (node === root) {
            mask[i] = 1;
            break;
          }
      });
    }
    for (let [name, weight] of Object.entries(options.mask ?? {})) {
      let i = this.skin.nodes.findIndex((n) => n.name === name);
      if (i < 0 || !Number.isFinite(weight) || weight < 0 || weight > 1)
        throw new RangeError(`Invalid bone mask: ${name}`);
      mask[i] = weight;
    }
    let previous = this.layers.get(id), clock = previous?.options.clip === options.clip ? previous.clock : new ClipPlayers();
    if (clock !== previous?.clock)
      clock.add({ slot: 0, duration: clip.duration, channels: [] }), clock.play(0, options.looping ?? !0, options.speed ?? 1);
    else if (previous.options.speed !== options.speed || previous.options.looping !== options.looping) {
      let time = clock.time(0);
      clock.play(0, options.looping ?? !0, options.speed ?? 1), clock.seek(0, time);
    }
    this.layers.set(id, { options: { ...options }, mask, clock, weight: options.weight }), this.revision++;
  }
  /**
   * Move a layer's weight to `weight` over `seconds` along a smoothstep, from the weight it has now,
   * replacing any fade in progress. The layer keeps its phase; zero seconds is immediate.
   */
  fade(id, weight, seconds) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1 || !Number.isFinite(seconds) || seconds < 0)
      throw new RangeError("Invalid animation layer fade weight or duration");
    let layer = this.layers.get(id);
    return layer === void 0 ? !1 : (seconds === 0 || weight === layer.weight ? (delete layer.fade, layer.weight = weight) : layer.fade = { from: layer.weight, to: weight, elapsed: 0, duration: seconds }, this.revision++, !0);
  }
  remove(id) {
    this.layers.delete(id) && this.revision++;
  }
  clear() {
    this.layers.size > 0 && (this.layers.clear(), this.revision++);
  }
  seek(id, seconds) {
    let layer = this.layers.get(id);
    return layer === void 0 || !layer.clock.seek(0, seconds) ? !1 : (this.revision++, !0);
  }
  crossed(id, marker) {
    return this.layers.get(id)?.clock.crossed(0, marker) ?? !1;
  }
  advance(dt) {
    for (let layer of this.layers.values()) {
      let before = layer.clock.time(0);
      layer.clock.advance(dt, () => {
      }), before !== layer.clock.time(0) && this.revision++;
      let fade = layer.fade;
      if (fade === void 0 || dt === 0) continue;
      fade.elapsed = Math.min(fade.duration, fade.elapsed + dt);
      let t = fade.elapsed / fade.duration;
      layer.weight = fade.elapsed === fade.duration ? fade.to : fade.from + (fade.to - fade.from) * t * t * (3 - 2 * t), fade.elapsed === fade.duration && delete layer.fade, this.revision++;
    }
  }
  apply(pose, bind) {
    for (let { options, mask, clock, weight } of this.layers.values()) {
      let clip = this.skin.clips.find((c) => c.name === options.clip);
      for (let channel of clip.channels) {
        let w = weight * mask[channel.node];
        if (w === 0) continue;
        sampleChannelInto(channel, clock.time(0), this.value);
        let at2 = channel.node * 10 + (channel.path === "translation" ? 0 : channel.path === "rotation" ? 3 : 7);
        if (channel.path === "rotation")
          if (options.additive === !0) {
            for (let i = 0; i < 4; i++)
              this.inverse[i] = bind[at2 + i] * (i < 3 ? -1 : 1);
            multiplyQuat(this.rotation, 0, this.inverse, 0, this.value, 0), this.value.set([0, 0, 0, 1]), blendQuat(this.value, 0, this.rotation, 0, w), multiplyQuat(pose, at2, pose, at2, this.value, 0);
          } else blendQuat(pose, at2, this.value, 0, w);
        else
          for (let c = 0; c < 3; c++)
            options.additive !== !0 ? pose[at2 + c] = pose[at2 + c] + (this.value[c] - pose[at2 + c]) * w : channel.path === "scale" ? pose[at2 + c] = pose[at2 + c] * (1 + (this.value[c] / bind[at2 + c] - 1) * w) : pose[at2 + c] = pose[at2 + c] + (this.value[c] - bind[at2 + c]) * w;
      }
    }
  }
};

// src/scene/limb-ik.ts
var LIMB_NAMES = ["leftLeg", "rightLeg", "leftArm", "rightArm"], KNEE_MAX_FLEXION = 150 * Math.PI / 180, ELBOW_MAX_FLEXION = 145 * Math.PI / 180, DEFAULT_SOFTNESS = 0.05, MAX_FLEXION_LIMIT = 175 * Math.PI / 180, BONES = {
  leftLeg: ["leftUpperLeg", "leftLowerLeg", "leftFoot"],
  rightLeg: ["rightUpperLeg", "rightLowerLeg", "rightFoot"],
  leftArm: ["leftUpperArm", "leftLowerArm", "leftHand"],
  rightArm: ["rightUpperArm", "rightLowerArm", "rightHand"]
}, isLeg = (limb) => limb === "leftLeg" || limb === "rightLeg", finite = (values) => Array.from(values).every(Number.isFinite), EPS = 1e-9;
function reachLimits(a, b, minFlexion, maxFlexion, softness) {
  let min = Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(maxFlexion))), max = Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(minFlexion))), width = softness * (max - min);
  return { min, max, softMin: min + width, softMax: max - width };
}
function softReach(distance, limits) {
  if (distance > limits.softMax) {
    let width = limits.max - limits.softMax;
    return width > 0 ? limits.softMax + width * (1 - Math.exp(-(distance - limits.softMax) / width)) : limits.max;
  }
  if (distance < limits.softMin) {
    let width = limits.softMin - limits.min;
    return width > 0 ? limits.softMin - width * (1 - Math.exp(-(limits.softMin - distance) / width)) : limits.min;
  }
  return distance;
}
function minimumDrop(toTarget, up, reach) {
  let p = toTarget[0] * up[0] + toTarget[1] * up[1] + toTarget[2] * up[2], q = toTarget[0] ** 2 + toTarget[1] ** 2 + toTarget[2] ** 2 - reach * reach;
  if (q <= 0) return 0;
  let discriminant = p * p - q;
  if (discriminant < 0) return Math.max(0, -p);
  let root = Math.sqrt(discriminant);
  return -p + root < 0 ? 0 : Math.max(0, -p - root);
}
var dot2 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function cross2(o, a, b) {
  let x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  o[0] = x, o[1] = y, o[2] = z;
}
function length3(a) {
  return Math.hypot(a[0], a[1], a[2]);
}
function normalize3(a) {
  let length = length3(a);
  return length > EPS && (a[0] = a[0] / length, a[1] = a[1] / length, a[2] = a[2] / length), length;
}
function perpendicular(o, a) {
  let ax = Math.abs(a[0]), ay = Math.abs(a[1]), az = Math.abs(a[2]);
  ax <= ay && ax <= az ? (o[0] = 0, o[1] = -a[2], o[2] = a[1]) : ay <= az ? (o[0] = a[2], o[1] = 0, o[2] = -a[0]) : (o[0] = -a[1], o[1] = a[0], o[2] = 0), normalize3(o);
}
function qmul2(o, a, b) {
  let ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  o[0] = aw * bx + ax * bw + ay * bz - az * by, o[1] = aw * by - ax * bz + ay * bw + az * bx, o[2] = aw * bz + ax * by - ay * bx + az * bw, o[3] = aw * bw - ax * bx - ay * by - az * bz;
}
function qconj2(o, a) {
  o[0] = -a[0], o[1] = -a[1], o[2] = -a[2], o[3] = a[3];
}
function qnormalize(o) {
  let length = Math.hypot(o[0], o[1], o[2], o[3]);
  length > EPS ? (o[0] = o[0] / length, o[1] = o[1] / length, o[2] = o[2] / length, o[3] = o[3] / length) : (o[0] = 0, o[1] = 0, o[2] = 0, o[3] = 1);
}
function qrotate(o, q, at2, x, y, z) {
  let qx = q[at2], qy = q[at2 + 1], qz = q[at2 + 2], qw = q[at2 + 3], tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  o[0] = x + qw * tx + (qy * tz - qz * ty), o[1] = y + qw * ty + (qz * tx - qx * tz), o[2] = z + qw * tz + (qx * ty - qy * tx);
}
function qaxis(o, axis, angle) {
  let s = Math.sin(angle / 2);
  o[0] = axis[0] * s, o[1] = axis[1] * s, o[2] = axis[2] * s, o[3] = Math.cos(angle / 2);
}
function qfromto(o, from, to, prefer, scratch) {
  let d = dot2(from, to);
  if (d < -1 + 1e-12) {
    if (prefer !== void 0) {
      let along = dot2(prefer, from);
      scratch[0] = prefer[0] - along * from[0], scratch[1] = prefer[1] - along * from[1], scratch[2] = prefer[2] - along * from[2];
    } else scratch.fill(0);
    normalize3(scratch) < 1e-6 && perpendicular(scratch, from), o[0] = scratch[0], o[1] = scratch[1], o[2] = scratch[2], o[3] = 0;
    return;
  }
  cross2(o, from, to), o[3] = 1 + d, qnormalize(o);
}
function qslerp(o, a, b, t) {
  let cosine = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], sign = cosine < 0 ? -1 : 1;
  cosine = Math.min(1, Math.abs(cosine));
  let angle = Math.acos(cosine), sine = Math.sin(angle), wa = sine > 1e-6 ? Math.sin((1 - t) * angle) / sine : 1 - t, wb = (sine > 1e-6 ? Math.sin(t * angle) / sine : t) * sign, x = a[0] * wa + b[0] * wb, y = a[1] * wa + b[1] * wb, z = a[2] * wa + b[2] * wb, w = a[3] * wa + b[3] * wb;
  o[0] = x, o[1] = y, o[2] = z, o[3] = w, qnormalize(o);
}
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), LimbIK = class {
  constructor(skin) {
    this.skin = skin;
    this.n = skin.nodes.length, this.parentOf = Int32Array.from(skin.nodes.map((node) => node.parent)), this.bind = new Float64Array(this.n * 10), skin.nodes.forEach((node, i) => {
      this.bind.set(node.translation, i * 10);
      let length = Math.hypot(...node.rotation);
      this.bind.set(node.rotation.map((v) => v / length), i * 10 + 3), this.bind.set(node.scale, i * 10 + 7);
    }), this.gp = new Float64Array(this.n * 3), this.gq = new Float64Array(this.n * 4), this.gs = new Float64Array(this.n);
    let seen = /* @__PURE__ */ new Set(), visit = (i) => {
      if (seen.has(i)) return;
      let parent = this.parentOf[i];
      parent >= 0 && visit(parent), seen.add(i), this.order.push(i);
    };
    for (let i = 0; i < this.n; i++) visit(i);
    for (let i = 0; i < LIMB_NAMES.length; i++) this.requests.push({ rig: void 0, weight: 1, softness: 0, min: 0, max: 0, target: new Float64Array(3), pole: new Float64Array(3), hasPole: !1, rotation: new Float64Array(4), hasRotation: !1, rotationWeight: 1 });
  }
  skin;
  revision = 0;
  n;
  parentOf;
  order = [];
  bind;
  /** Similarity transform of every node (decision 0209 uniform scale): position, rotation, scale. */
  gp;
  gq;
  gs;
  relevant = new Uint8Array(0);
  map;
  rigs = /* @__PURE__ */ new Map();
  hips = -1;
  up = new Float64Array([0, 0, 1]);
  soleDefault = 0;
  groundDefault = 0;
  maxDropDefault = 0;
  goals = /* @__PURE__ */ new Map();
  byLimb = /* @__PURE__ */ new Map();
  placement;
  pendingDt = 0;
  drop = 0;
  dropReady = !1;
  required = 0;
  converging = !1;
  states = /* @__PURE__ */ new Map();
  // scratch
  requests = [];
  s = Array.from({ length: 16 }, () => new Float64Array(3));
  r = Array.from({ length: 13 }, () => new Float64Array(4));
  spare = new Float64Array(3);
  local = new Float64Array(3);
  get humanoid() {
    return this.map;
  }
  /** True while the smoothed hips drop is still converging; the owner must keep evaluating. */
  get animating() {
    return this.converging;
  }
  get active() {
    return this.goals.size > 0 || this.placement !== void 0;
  }
  /** Accumulates elapsed time for hips smoothing; consumed by the next evaluation. */
  advance(dt) {
    this.placement !== void 0 && (this.pendingDt += dt);
  }
  // ------------------------------------------------------------------ configuration
  /** Resolves a map to skin nodes and derives each limb's hinge from the bind pose. `undefined` removes every goal. */
  setHumanoid(map) {
    if (map === void 0) {
      this.map = void 0, this.rigs = /* @__PURE__ */ new Map(), this.goals.clear(), this.byLimb.clear(), this.placement = void 0, this.resetState(), this.revision++;
      return;
    }
    let index = (bone) => {
      let name = map.bones[bone], found = name === void 0 ? -1 : this.skin.nodes.findIndex((node) => node.name === name);
      if (found < 0) throw new RangeError(`Humanoid map needs ${bone} to name a skin node`);
      return found;
    }, descends = (node, ancestor) => {
      for (let i = this.parentOf[node]; i >= 0; i = this.parentOf[i]) if (i === ancestor) return !0;
      return !1;
    }, up = Float64Array.from(map.up), forward = Float64Array.from(map.forward);
    if (!finite(map.up) || !finite(map.forward) || map.up.length !== 3 || map.forward.length !== 3 || normalize3(up) < 1e-8 || normalize3(forward) < 1e-8)
      throw new RangeError("Humanoid map needs finite non-zero up and forward vectors");
    let hips = index("hips"), nodes = /* @__PURE__ */ new Map();
    for (let limb of LIMB_NAMES) {
      let [u, l, e] = BONES[limb].map(index);
      if (!descends(l, u) || !descends(e, l)) throw new RangeError(`Humanoid map: ${limb} bones must descend upper, lower, end`);
      nodes.set(limb, [u, l, e]);
    }
    this.compute(this.bind, !1);
    let meshQ = this.skin.meshNode * 4, meshP = this.skin.meshNode * 3, meshS = this.gs[this.skin.meshNode], forwardG = new Float64Array(3), upG = new Float64Array(3);
    qrotate(forwardG, this.gq, meshQ, forward[0], forward[1], forward[2]), normalize3(forwardG), qrotate(upG, this.gq, meshQ, up[0], up[1], up[2]), normalize3(upG);
    let rigs = /* @__PURE__ */ new Map(), heights = {};
    for (let limb of LIMB_NAMES) {
      let [u, l, e] = nodes.get(limb), pu = this.gp.subarray(u * 3, u * 3 + 3), pl = this.gp.subarray(l * 3, l * 3 + 3), pe = this.gp.subarray(e * 3, e * 3 + 3), axis = new Float64Array([pe[0] - pu[0], pe[1] - pu[1], pe[2] - pu[2]]), upper = new Float64Array([pl[0] - pu[0], pl[1] - pu[1], pl[2] - pu[2]]), total = length3(upper) + Math.hypot(pe[0] - pl[0], pe[1] - pl[1], pe[2] - pl[2]);
      normalize3(axis) < EPS && axis.set(upper), normalize3(axis);
      let along = dot2(upper, axis), offset = new Float64Array([upper[0] - along * axis[0], upper[1] - along * axis[1], upper[2] - along * axis[2]]), sign = isLeg(limb) ? 1 : -1, anatomical = new Float64Array([sign * forwardG[0], sign * forwardG[1], sign * forwardG[2]]), side2 = dot2(anatomical, axis);
      for (let c = 0; c < 3; c++) anatomical[c] = anatomical[c] - side2 * axis[c];
      let anatomicalLength = normalize3(anatomical), offsetLength = normalize3(offset), bend = new Float64Array(3);
      if (offsetLength > 3e-3 * total) {
        if (bend.set(offset), anatomicalLength > 1e-3 && dot2(bend, anatomical) < -0.25) for (let c = 0; c < 3; c++) bend[c] = -bend[c];
      } else if (anatomicalLength > 1e-3) bend.set(anatomical);
      else {
        let rise = dot2(upG, axis);
        for (let c = 0; c < 3; c++) bend[c] = upG[c] - rise * axis[c];
        normalize3(bend) < 1e-3 && perpendicular(bend, axis);
      }
      let hingeWorld = new Float64Array(3);
      cross2(hingeWorld, bend, axis), normalize3(hingeWorld);
      let conj = new Float64Array(4);
      qconj2(conj, this.gq.subarray(u * 4, u * 4 + 4));
      let hinge = new Float64Array(3);
      qrotate(hinge, conj, 0, hingeWorld[0], hingeWorld[1], hingeWorld[2]);
      let singularWorld = new Float64Array(3);
      if (isLeg(limb)) singularWorld.set(upG);
      else {
        let left = new Float64Array(3);
        cross2(left, upG, forwardG), normalize3(left);
        let outward = limb === "leftArm" ? 1 : -1;
        for (let c = 0; c < 3; c++) singularWorld[c] = -outward * left[c] - forwardG[c];
        normalize3(singularWorld);
      }
      let parentConj = new Float64Array(4), singular = new Float64Array(3), parent = this.parentOf[u];
      qconj2(parentConj, this.gq.subarray(parent * 4, parent * 4 + 4)), qrotate(singular, parentConj, 0, singularWorld[0], singularWorld[1], singularWorld[2]), rigs.set(limb, { limb, u, l, e, hinge, singular, reach: total / meshS, maxFlexion: isLeg(limb) ? KNEE_MAX_FLEXION : ELBOW_MAX_FLEXION });
    }
    let height = (node) => {
      let dx = this.gp[node * 3] - this.gp[meshP], dy = this.gp[node * 3 + 1] - this.gp[meshP + 1], dz = this.gp[node * 3 + 2] - this.gp[meshP + 2];
      return (dx * upG[0] + dy * upG[1] + dz * upG[2]) / meshS;
    };
    heights.left = height(nodes.get("leftLeg")[2]), heights.right = height(nodes.get("rightLeg")[2]), this.groundDefault = 0, this.soleDefault = Math.max(0, Math.min(heights.left, heights.right)), this.maxDropDefault = 0.5 * Math.min(rigs.get("leftLeg").reach, rigs.get("rightLeg").reach);
    let relevant = new Uint8Array(this.n), mark = (node) => {
      for (let i = node; i >= 0 && relevant[i] === 0; i = this.parentOf[i]) relevant[i] = 1;
    };
    mark(this.skin.meshNode), mark(hips);
    for (let [u, l, e] of nodes.values())
      mark(u), mark(l), mark(e);
    this.relevant = relevant, this.map = map, this.rigs = rigs, this.hips = hips, this.up = up, this.resetState(), this.revision++;
  }
  resetState() {
    this.drop = 0, this.dropReady = !1, this.required = 0, this.converging = !1, this.pendingDt = 0, this.states.clear();
  }
  /** Sets (or replaces) the goal `id`. At most one goal drives each limb, and foot placement owns both legs while it is set. */
  set(id, goal) {
    if (this.map === void 0) throw new RangeError("Limb IK needs a humanoid map: call setHumanoid first");
    if (id === "" || !LIMB_NAMES.includes(goal.limb)) throw new RangeError("A limb goal needs an ID and a limb name");
    if (this.placement !== void 0 && isLeg(goal.limb)) throw new RangeError("Foot placement owns both legs; clear it before setting a leg goal");
    let holder = this.byLimb.get(goal.limb);
    if (holder !== void 0 && holder !== id) throw new RangeError(`Limb ${goal.limb} is already driven by goal ${holder}`);
    let weight = goal.weight ?? 1, rotationWeight = goal.rotationWeight ?? 1, softness = goal.softness ?? DEFAULT_SOFTNESS, min = goal.flexion?.min ?? 0, max = goal.flexion?.max ?? (isLeg(goal.limb) ? KNEE_MAX_FLEXION : ELBOW_MAX_FLEXION);
    if (goal.target.length !== 3 || !finite(goal.target) || !Number.isFinite(weight) || weight < 0 || weight > 1 || !Number.isFinite(rotationWeight) || rotationWeight < 0 || rotationWeight > 1 || !Number.isFinite(softness) || softness < 0 || softness > 0.5)
      throw new RangeError("Invalid limb target, weight, rotation weight or softness");
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || min >= max || max > MAX_FLEXION_LIMIT)
      throw new RangeError("Invalid limb flexion range: need 0 <= min < max <= 175 degrees");
    let pole;
    if (goal.pole !== void 0) {
      let length = Math.hypot(...goal.pole);
      if (goal.pole.length !== 3 || !finite(goal.pole) || !Number.isFinite(length) || length < 1e-8) throw new RangeError("Invalid limb pole direction");
      pole = goal.pole.map((v) => v / length);
    }
    let rotation;
    if (goal.rotation !== void 0) {
      let length = Math.hypot(...goal.rotation);
      if (goal.rotation.length !== 4 || !finite(goal.rotation) || !Number.isFinite(length) || length < 1e-8) throw new RangeError("Invalid limb orientation quaternion");
      rotation = goal.rotation.map((v) => v / length);
      let end = this.rigs.get(goal.limb).e;
      for (let node = this.skin.meshNode; node >= 0; node = this.parentOf[node])
        if (node === end) throw new RangeError("Limb orientation mesh frame cannot descend from the end effector");
    }
    holder === void 0 && this.byLimb.set(goal.limb, id), this.goals.set(id, { id, limb: goal.limb, target: [...goal.target], weight, pole, rotation, rotationWeight, softness, min, max }), this.revision++;
  }
  /** Sets or (with `undefined`) clears foot placement. State such as the smoothed drop survives replacement. */
  setFootPlacement(placement) {
    if (placement === void 0) {
      this.placement !== void 0 && (this.placement = void 0, this.resetState(), this.revision++);
      return;
    }
    if (this.map === void 0) throw new RangeError("Foot placement needs a humanoid map: call setHumanoid first");
    if (this.byLimb.has("leftLeg") || this.byLimb.has("rightLeg")) throw new RangeError("Foot placement owns both legs; remove leg goals first");
    let smoothing = placement.smoothing ?? 0.1, softness = placement.softness ?? DEFAULT_SOFTNESS, soleOffset = placement.soleOffset ?? this.soleDefault, groundLevel = placement.groundLevel ?? this.groundDefault, maxDrop = placement.maxDrop ?? this.maxDropDefault;
    if (!Number.isFinite(smoothing) || smoothing < 0 || !Number.isFinite(softness) || softness < 0 || softness > 0.5 || !Number.isFinite(soleOffset) || soleOffset < 0 || !Number.isFinite(groundLevel) || !Number.isFinite(maxDrop) || maxDrop < 0)
      throw new RangeError("Invalid foot placement smoothing, softness, sole offset, ground level or maximum drop");
    let ground = (side2, g) => {
      let weight = g.weight ?? 1;
      if (g.height === void 0 == (g.point === void 0)) throw new RangeError(`Foot placement ${side2} needs exactly one of height or point`);
      if (g.height !== void 0 && !Number.isFinite(g.height)) throw new RangeError(`Foot placement ${side2} height must be finite`);
      if (g.point !== void 0 && (g.point.length !== 3 || !finite(g.point))) throw new RangeError(`Foot placement ${side2} point must be three finite numbers`);
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new RangeError(`Foot placement ${side2} weight must be in [0, 1]`);
      let normal;
      if (g.normal !== void 0) {
        let length = Math.hypot(...g.normal);
        if (g.normal.length !== 3 || !finite(g.normal) || !Number.isFinite(length) || length < 1e-8) throw new RangeError(`Foot placement ${side2} normal must be a finite non-zero vector`);
        normal = g.normal.map((v) => v / length);
      }
      return { height: g.height, point: g.point === void 0 ? void 0 : [...g.point], normal, weight };
    }, left = ground("left", placement.left), right = ground("right", placement.right);
    this.placement = { left, right, smoothing, soleOffset, groundLevel, maxDrop, softness }, this.revision++;
  }
  remove(id) {
    let goal = this.goals.get(id);
    return goal === void 0 ? !1 : (this.goals.delete(id), this.byLimb.delete(goal.limb), this.states.delete(goal.limb), this.revision++, !0);
  }
  has(id) {
    return this.goals.has(id);
  }
  /** Removes every goal and foot placement; the humanoid map stays. */
  clear() {
    this.goals.size === 0 && this.placement === void 0 || (this.goals.clear(), this.byLimb.clear(), this.placement = void 0, this.resetState(), this.revision++);
  }
  inspect() {
    let vec = (v) => ({ x: v[0], y: v[1], z: v[2] }), limbs = [...this.goals.values()].map((goal) => {
      let rig = this.rigs.get(goal.limb), state = this.states.get(goal.limb);
      return {
        id: goal.id,
        limb: goal.limb,
        nodes: [rig.u, rig.l, rig.e],
        target: vec(goal.target),
        weight: goal.weight,
        ...goal.rotation === void 0 ? {} : { rotation: { x: goal.rotation[0], y: goal.rotation[1], z: goal.rotation[2], w: goal.rotation[3] } },
        rotationWeight: goal.rotationWeight,
        ...goal.pole === void 0 ? {} : { pole: vec(goal.pole) },
        softness: goal.softness,
        flexionRange: { min: goal.min, max: goal.max },
        flexion: state?.flexion ?? null,
        residual: state?.residual ?? null
      };
    }), ground = (g, limb) => ({
      ...g.height === void 0 ? {} : { height: g.height },
      ...g.point === void 0 ? {} : { point: vec(g.point) },
      ...g.normal === void 0 ? {} : { normal: vec(g.normal) },
      weight: g.weight,
      flexion: this.states.get(limb)?.flexion ?? null,
      residual: this.states.get(limb)?.residual ?? null
    }), p = this.placement;
    return { limbs, footPlacement: p === void 0 ? null : {
      left: ground(p.left, "leftLeg"),
      right: ground(p.right, "rightLeg"),
      smoothing: p.smoothing,
      soleOffset: p.soleOffset,
      groundLevel: p.groundLevel,
      maxDrop: p.maxDrop,
      softness: p.softness,
      requiredDrop: this.required,
      drop: this.drop
    } };
  }
  // ------------------------------------------------------------------ evaluation
  /** Global similarity transforms (position, rotation, uniform scale) of the pose, in double precision. */
  compute(pose, check) {
    for (let i of this.order) {
      let at2 = i * 10, parent = this.parentOf[i], sx = pose[at2 + 7];
      if (check && this.relevant[i] === 1 && !numericallyUniformScale(sx, pose[at2 + 8], pose[at2 + 9]))
        throw new RangeError("Limb IK requires uniform ancestor scales");
      if (parent < 0) {
        this.gp[i * 3] = pose[at2], this.gp[i * 3 + 1] = pose[at2 + 1], this.gp[i * 3 + 2] = pose[at2 + 2];
        for (let c = 0; c < 4; c++) this.gq[i * 4 + c] = pose[at2 + 3 + c];
        this.gs[i] = sx;
      } else {
        let scale = this.gs[parent];
        qrotate(this.spare, this.gq, parent * 4, pose[at2], pose[at2 + 1], pose[at2 + 2]), this.gp[i * 3] = this.gp[parent * 3] + scale * this.spare[0], this.gp[i * 3 + 1] = this.gp[parent * 3 + 1] + scale * this.spare[1], this.gp[i * 3 + 2] = this.gp[parent * 3 + 2] + scale * this.spare[2];
        let q = this.r[9];
        q[0] = pose[at2 + 3], q[1] = pose[at2 + 4], q[2] = pose[at2 + 5], q[3] = pose[at2 + 6], qmul2(q, this.gq.subarray(parent * 4, parent * 4 + 4), q);
        for (let c = 0; c < 4; c++) this.gq[i * 4 + c] = q[c];
        this.gs[i] = scale * sx;
      }
    }
  }
  apply(pose) {
    let rigs = this.rigs;
    if (this.map === void 0 || this.goals.size === 0 && this.placement === void 0) {
      this.converging = !1;
      return;
    }
    this.compute(pose, !0);
    let mesh = this.skin.meshNode, requests = [], used = this.requests, slot = 0, prepare = (rig) => {
      let r = used[slot++];
      return r.rig = rig, r;
    };
    if (this.placement !== void 0) {
      let left = prepare(rigs.get("leftLeg")), right = prepare(rigs.get("rightLeg"));
      this.placeFeet(pose, left, right), left.weight > 0 && requests.push(left), right.weight > 0 && requests.push(right);
    }
    for (let limb of LIMB_NAMES) {
      let id = this.byLimb.get(limb);
      if (id === void 0) continue;
      let goal = this.goals.get(id);
      if (goal.weight === 0) continue;
      let r = prepare(rigs.get(limb));
      r.weight = goal.weight, r.softness = goal.softness, r.min = goal.min, r.max = goal.max, r.rotationWeight = goal.rotationWeight, qrotate(r.target, this.gq, mesh * 4, goal.target[0], goal.target[1], goal.target[2]);
      for (let c = 0; c < 3; c++) r.target[c] = this.gp[mesh * 3 + c] + this.gs[mesh] * r.target[c];
      r.hasPole = goal.pole !== void 0, goal.pole !== void 0 && (qrotate(r.pole, this.gq, mesh * 4, goal.pole[0], goal.pole[1], goal.pole[2]), normalize3(r.pole)), r.hasRotation = goal.rotation !== void 0, goal.rotation !== void 0 && qmul2(r.rotation, this.gq.subarray(mesh * 4, mesh * 4 + 4), goal.rotation), requests.push(r);
    }
    for (let request of requests) this.solve(pose, request);
  }
  /** Foot targets, minimum hips drop, hips shift and (re)computed transforms; fills the two leg requests. */
  placeFeet(pose, left, right) {
    let placement = this.placement, mesh = this.skin.meshNode, meshQ = mesh * 4, sMesh = this.gs[mesh], upG = this.s[0];
    qrotate(upG, this.gq, meshQ, this.up[0], this.up[1], this.up[2]), normalize3(upG);
    let required = 0, toTarget = this.s[1], normalG = this.s[2], targetG = this.s[3];
    for (let [request, ground] of [[left, placement.left], [right, placement.right]]) {
      let rig = request.rig, u = rig.u, e = rig.e;
      request.weight = ground.weight, request.softness = placement.softness, request.min = 0, request.max = KNEE_MAX_FLEXION, request.rotationWeight = 1, request.hasPole = !1, request.hasRotation = !0;
      let hasNormal = !1;
      ground.normal !== void 0 && (qrotate(normalG, this.gq, meshQ, ground.normal[0], ground.normal[1], ground.normal[2]), normalize3(normalG), hasNormal = !0);
      let pe = e * 3;
      if (ground.point !== void 0) {
        let clearance = placement.soleOffset, n = hasNormal ? ground.normal : this.up;
        qrotate(targetG, this.gq, meshQ, ground.point[0] + n[0] * clearance, ground.point[1] + n[1] * clearance, ground.point[2] + n[2] * clearance);
        for (let c = 0; c < 3; c++) targetG[c] = this.gp[mesh * 3 + c] + sMesh * targetG[c];
      } else {
        let height = ground.height, animated = ((this.gp[pe] - this.gp[mesh * 3]) * upG[0] + (this.gp[pe + 1] - this.gp[mesh * 3 + 1]) * upG[1] + (this.gp[pe + 2] - this.gp[mesh * 3 + 2]) * upG[2]) / sMesh, slope = hasNormal ? Math.max(0.5, dot2(normalG, upG)) : 1, lifted = animated + (height - placement.groundLevel), floor = height + placement.soleOffset / slope, wanted2 = Math.max(lifted, floor);
        for (let c = 0; c < 3; c++) targetG[c] = this.gp[pe + c] + upG[c] * sMesh * (wanted2 - animated);
      }
      for (let c = 0; c < 3; c++) request.target[c] = targetG[c];
      let qe = this.r[0], tilt = this.r[1];
      for (let c = 0; c < 4; c++) qe[c] = this.gq[e * 4 + c];
      hasNormal ? (qfromto(tilt, upG, normalG, void 0, this.spare), qmul2(request.rotation, tilt, qe)) : request.rotation.set(qe);
      let a = Math.hypot(this.gp[rig.l * 3] - this.gp[u * 3], this.gp[rig.l * 3 + 1] - this.gp[u * 3 + 1], this.gp[rig.l * 3 + 2] - this.gp[u * 3 + 2]), b = Math.hypot(this.gp[pe] - this.gp[rig.l * 3], this.gp[pe + 1] - this.gp[rig.l * 3 + 1], this.gp[pe + 2] - this.gp[rig.l * 3 + 2]), limits = reachLimits(a, b, 0, KNEE_MAX_FLEXION, placement.softness);
      for (let c = 0; c < 3; c++) toTarget[c] = targetG[c] - this.gp[u * 3 + c];
      required = Math.max(required, ground.weight * minimumDrop(toTarget, upG, limits.softMax) / sMesh);
    }
    this.required = required;
    let wanted = Math.min(required, placement.maxDrop);
    if (!this.dropReady || placement.smoothing === 0 ? (this.drop = wanted, this.dropReady = !0) : this.drop += (wanted - this.drop) * (1 - Math.exp(-this.pendingDt / placement.smoothing)), this.pendingDt = 0, this.converging = Math.abs(this.drop - wanted) > 1e-9, this.converging || (this.drop = wanted), this.drop > 0 && this.hips >= 0) {
      let displacement = this.drop * sMesh, parent = this.parentOf[this.hips], delta = this.local;
      if (delta[0] = -upG[0] * displacement, delta[1] = -upG[1] * displacement, delta[2] = -upG[2] * displacement, parent >= 0) {
        let conj = this.r[2];
        qconj2(conj, this.gq.subarray(parent * 4, parent * 4 + 4)), qrotate(delta, conj, 0, delta[0], delta[1], delta[2]);
        let scale = this.gs[parent];
        for (let c = 0; c < 3; c++) delta[c] = delta[c] / scale;
      }
      for (let c = 0; c < 3; c++) pose[this.hips * 10 + c] = pose[this.hips * 10 + c] + delta[c];
      this.compute(pose, !1);
    }
  }
  /** Solves one limb in skeleton-root space and writes the blended local rotations of upper, lower and (optionally) end. */
  solve(pose, request) {
    let { rig } = request, { u, l, e } = rig, gp = this.gp, gq = this.gq, [du, dl, ehat, hc, hs, q, uDir, lDir, tmp] = [this.s[4], this.s[5], this.s[6], this.s[7], this.s[8], this.s[9], this.s[10], this.s[11], this.s[12]], reference = this.s[13], chord = this.s[14], work3 = this.s[15];
    for (let c = 0; c < 3; c++)
      du[c] = gp[l * 3 + c] - gp[u * 3 + c], dl[c] = gp[e * 3 + c] - gp[l * 3 + c];
    let a = normalize3(du), b = normalize3(dl);
    if (!(a > EPS && b > EPS)) return;
    for (let c = 0; c < 3; c++) ehat[c] = request.target[c] - gp[u * 3 + c];
    let distance = normalize3(ehat);
    if (distance <= EPS) {
      for (let c = 0; c < 3; c++) ehat[c] = gp[e * 3 + c] - gp[u * 3 + c];
      normalize3(ehat) <= EPS && ehat.set(du);
    }
    let limits = reachLimits(a, b, request.min, request.max, request.softness), effective = Math.max(softReach(distance, limits), 1e-12), flexion = Math.acos(clamp((effective * effective - a * a - b * b) / (2 * a * b), -1, 1)), hipAngle = Math.acos(clamp((a * a + effective * effective - b * b) / (2 * a * effective), -1, 1));
    qrotate(hc, gq, u * 4, rig.hinge[0], rig.hinge[1], rig.hinge[2]);
    let explicit = !1;
    if (request.hasPole) {
      let along = dot2(request.pole, ehat);
      for (let c = 0; c < 3; c++) q[c] = request.pole[c] - along * ehat[c];
      normalize3(q) > 1e-3 && (cross2(hs, q, ehat), explicit = !0);
    }
    let swing = this.r[3], turn = this.r[4], upper = this.r[5], lower = this.r[6], work = this.r[7], work2 = this.r[8];
    if (!explicit) {
      let parent = this.parentOf[u];
      for (let c = 0; c < 3; c++) chord[c] = gp[e * 3 + c] - gp[u * 3 + c];
      normalize3(chord) <= EPS && chord.set(du);
      let across = dot2(hc, chord);
      for (let c = 0; c < 3; c++) work3[c] = hc[c] - across * chord[c];
      normalize3(work3) < 1e-6 && perpendicular(work3, chord), qrotate(reference, gq, parent * 4, rig.singular[0], rig.singular[1], rig.singular[2]);
      for (let c = 0; c < 3; c++) reference[c] = -reference[c];
      qfromto(swing, chord, reference, work3, tmp), qrotate(hs, swing, 0, work3[0], work3[1], work3[2]), qfromto(swing, reference, ehat, hs, tmp), qrotate(hs, swing, 0, hs[0], hs[1], hs[2]);
      let along = dot2(hs, ehat);
      for (let c = 0; c < 3; c++) hs[c] = hs[c] - along * ehat[c];
      normalize3(hs) < 1e-6 && perpendicular(hs, ehat);
    }
    cross2(q, ehat, hs);
    let sine = Math.sin(hipAngle), cosine = Math.cos(hipAngle);
    for (let c = 0; c < 3; c++) uDir[c] = cosine * ehat[c] + sine * q[c];
    for (let c = 0; c < 3; c++) lDir[c] = gp[u * 3 + c] + effective * ehat[c] - (gp[u * 3 + c] + a * uDir[c]);
    normalize3(lDir) < EPS && lDir.set(ehat), qfromto(swing, du, uDir, hs, tmp), qrotate(tmp, swing, 0, hc[0], hc[1], hc[2]), cross2(q, tmp, hs);
    let twist = Math.atan2(dot2(uDir, q), dot2(tmp, hs));
    qaxis(turn, uDir, twist), qmul2(upper, turn, swing), qrotate(tmp, upper, 0, dl[0], dl[1], dl[2]), qfromto(lower, tmp, lDir, hs, this.spare);
    let w = request.weight, parentU = this.parentOf[u], parentL = this.parentOf[l], parentE = this.parentOf[e], animatedParent = this.r[0], solved = this.r[1], write = (node, rotation, weight) => {
      let at2 = node * 10 + 3;
      for (let c = 0; c < 4; c++) animatedParent[c] = pose[at2 + c];
      qslerp(solved, animatedParent, rotation, weight);
      for (let c = 0; c < 4; c++) pose[at2 + c] = solved[c];
    };
    parentU >= 0 ? qconj2(work, gq.subarray(parentU * 4, parentU * 4 + 4)) : (work[0] = 0, work[1] = 0, work[2] = 0, work[3] = 1), qmul2(work2, upper, gq.subarray(u * 4, u * 4 + 4));
    let lowerCarry = this.r[2], endCarry = this.r[9];
    qmul2(work2, work, work2), qnormalize(work2);
    let upperLocal = this.r[10];
    upperLocal.set(work2), qmul2(lowerCarry, lower, upper), qnormalize(lowerCarry), qmul2(work, upper, gq.subarray(parentL * 4, parentL * 4 + 4)), qconj2(work, work), qmul2(work2, lowerCarry, gq.subarray(l * 4, l * 4 + 4)), qmul2(work2, work, work2), qnormalize(work2);
    let lowerLocal = this.r[11];
    lowerLocal.set(work2);
    let endLocal = this.r[12];
    request.hasRotation && (qmul2(endCarry, lowerCarry, gq.subarray(parentE * 4, parentE * 4 + 4)), qconj2(endCarry, endCarry), qmul2(endLocal, endCarry, request.rotation), qnormalize(endLocal)), write(u, upperLocal, w), write(l, lowerLocal, w), request.hasRotation && write(e, endLocal, w * request.rotationWeight);
    let reachError = 0;
    for (let c = 0; c < 3; c++) reachError += (request.target[c] - (gp[u * 3 + c] + effective * ehat[c])) ** 2;
    this.states.set(rig.limb, { flexion, residual: Math.sqrt(reachError) / this.gs[this.skin.meshNode] });
  }
};

// src/scene/ik.ts
var PoseIK = class {
  constructor(skin) {
    this.skin = skin;
    this.limbs = new LimbIK(skin), this.globals = skin.nodes.map(() => identity());
    let seen = /* @__PURE__ */ new Set(), visit = (i) => {
      if (seen.has(i)) return;
      let p = skin.nodes[i].parent;
      p >= 0 && visit(p), seen.add(i), this.order.push(i);
    };
    skin.nodes.forEach((_, i) => visit(i));
  }
  skin;
  limbs;
  constraints = /* @__PURE__ */ new Map();
  globals;
  local = identity();
  scratch = identity();
  inverse = identity();
  delta = new Float64Array(4);
  order = [];
  orientation = new Float64Array(4);
  parentRotation = new Float64Array(4);
  bindRotation = new Float64Array(4);
  relative = new Float64Array(4);
  ccdRevision = 0;
  /** Changes whenever any constraint, limb goal, foot placement or humanoid map changes. */
  get revision() {
    return this.ccdRevision + this.limbs.revision;
  }
  /** True while foot-placement smoothing is still converging, so a held clock must keep evaluating. */
  get animating() {
    return this.limbs.animating;
  }
  advance(dt) {
    this.limbs.advance(dt);
  }
  setHumanoid(map) {
    this.limbs.setHumanoid(map);
  }
  /** Sets or replaces the anatomical limb goal `id`; an ID is shared with `set`, and the newest definition wins. */
  setLimb(id, goal) {
    this.limbs.set(id, goal), this.constraints.delete(id) && this.ccdRevision++;
  }
  setFootPlacement(placement) {
    this.limbs.setFootPlacement(placement);
  }
  inspect() {
    return [...this.constraints].map(([id, { indices, options, limits }]) => ({
      id,
      chain: [...indices],
      target: { x: options.target[0], y: options.target[1], z: options.target[2] },
      weight: options.weight ?? 1,
      iterations: options.iterations ?? 12,
      tolerance: options.tolerance ?? 1e-3,
      rotationWeight: options.rotationWeight ?? 1,
      ...options.rotation === void 0 ? {} : { rotation: { x: options.rotation[0], y: options.rotation[1], z: options.rotation[2], w: options.rotation[3] } },
      limits: [...limits].map(([node, limit]) => ({ node, limit: { ...limit, axis: [...limit.axis] } }))
    }));
  }
  set(id, options) {
    let indices = options.chain.map(
      (name) => this.skin.nodes.findIndex((n) => n.name === name)
    );
    if (id === "" || indices.length < 2 || indices.some(
      (i, k) => i < 0 || k > 0 && this.skin.nodes[i].parent !== indices[k - 1]
    ))
      throw new RangeError(
        "IK needs a contiguous chain of at least two named nodes"
      );
    if (options.target.length !== 3 || options.target.some((x) => !Number.isFinite(x)) || !Number.isFinite(options.weight ?? 1) || (options.weight ?? 1) < 0 || (options.weight ?? 1) > 1 || !Number.isInteger(options.iterations ?? 12) || (options.iterations ?? 12) < 1 || (options.iterations ?? 12) > 64 || !Number.isFinite(options.tolerance ?? 1e-3) || (options.tolerance ?? 1e-3) <= 0 || !Number.isFinite(options.rotationWeight ?? 1) || (options.rotationWeight ?? 1) < 0 || (options.rotationWeight ?? 1) > 1)
      throw new RangeError(
        "Invalid IK target, weight, iterations or tolerance"
      );
    let limits = /* @__PURE__ */ new Map();
    for (let [name, limit] of Object.entries(options.limits ?? {})) {
      let node = this.skin.nodes.findIndex((node2) => node2.name === name), length = Math.hypot(...limit.axis);
      if (!indices.includes(node) || limit.axis.length !== 3 || !limit.axis.every(Number.isFinite) || !Number.isFinite(length) || length < 1e-8 || !Number.isFinite(limit.min) || !Number.isFinite(limit.max) || limit.min < -Math.PI || limit.max > Math.PI || limit.min > limit.max)
        throw new RangeError(`Invalid IK hinge limit: ${name}`);
      limits.set(node, { axis: limit.axis.map((value) => value / length), min: limit.min, max: limit.max });
    }
    let rotation;
    if (options.rotation !== void 0) {
      let length = Math.hypot(...options.rotation);
      if (options.rotation.length !== 4 || !options.rotation.every(Number.isFinite) || !Number.isFinite(length) || length < 1e-8)
        throw new RangeError("Invalid IK orientation quaternion");
      rotation = options.rotation.map((value) => value / length);
      for (let node = this.skin.meshNode; node >= 0; node = this.skin.nodes[node].parent)
        if (node === indices.at(-1)) throw new RangeError("IK orientation mesh frame cannot descend from the end effector");
    }
    this.limbs.remove(id), this.constraints.set(id, {
      indices,
      limits,
      options: {
        ...options,
        ...rotation === void 0 ? {} : { rotation },
        target: [...options.target],
        chain: [...options.chain]
      }
    }), this.ccdRevision++;
  }
  constrain(pose, node, limit) {
    let at2 = node * 10 + 3, bind = this.skin.nodes[node].rotation, length = Math.hypot(...bind);
    for (let c = 0; c < 4; c++) this.bindRotation[c] = bind[c] / length;
    for (let c = 0; c < 4; c++) this.relative[c] = this.bindRotation[c] * (c < 3 ? -1 : 1);
    multiplyQuat(this.relative, 0, this.relative, 0, pose, at2);
    let axis = limit.axis, projection = this.relative[0] * axis[0] + this.relative[1] * axis[1] + this.relative[2] * axis[2], angle = Math.hypot(projection, this.relative[3]) < 1e-10 ? 0 : 2 * Math.atan2(projection, this.relative[3]);
    angle > Math.PI && (angle -= 2 * Math.PI), angle < -Math.PI && (angle += 2 * Math.PI), angle = Math.max(limit.min, Math.min(limit.max, angle));
    let sine = Math.sin(angle / 2);
    this.relative.set([axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(angle / 2)]), multiplyQuat(pose, at2, this.bindRotation, 0, this.relative, 0);
  }
  worldRotation(pose, node, out) {
    out.set([0, 0, 0, 1]);
    for (let i = node; i >= 0; i = this.skin.nodes[i].parent) {
      let at2 = i * 10;
      if (!numericallyUniformScale(pose[at2 + 7], pose[at2 + 8], pose[at2 + 9]))
        throw new RangeError("IK orientation requires uniform ancestor scales");
      multiplyQuat(out, 0, pose, at2 + 3, out, 0);
    }
  }
  remove(id) {
    this.constraints.delete(id) && this.ccdRevision++, this.limbs.remove(id);
  }
  /** Removes every CCD constraint, limb goal and foot placement. The humanoid map is configuration and stays. */
  clear() {
    this.constraints.size > 0 && (this.constraints.clear(), this.ccdRevision++), this.limbs.clear();
  }
  matrices(pose) {
    for (let i of this.order) {
      let at2 = i * 10, p = pose;
      fromRotationTranslationScaleInto(
        this.local,
        this.scratch,
        { x: p[at2 + 3], y: p[at2 + 4], z: p[at2 + 5], w: p[at2 + 6] },
        { x: p[at2], y: p[at2 + 1], z: p[at2 + 2] },
        { x: p[at2 + 7], y: p[at2 + 8], z: p[at2 + 9] }
      );
      let parent = this.skin.nodes[i].parent;
      parent < 0 ? this.globals[i].set(this.local) : multiplyInto(this.globals[i], this.globals[parent], this.local);
    }
  }
  apply(pose) {
    this.limbs.apply(pose);
    for (let { indices, options, limits } of this.constraints.values()) {
      let weight = options.weight ?? 1;
      if (weight === 0) continue;
      for (let [node, limit] of limits) this.constrain(pose, node, limit);
      this.matrices(pose);
      let mesh = this.globals[this.skin.meshNode], t = options.target, end = this.globals[indices.at(-1)], tx = end[12] + (mesh[0] * t[0] + mesh[4] * t[1] + mesh[8] * t[2] + mesh[12] - end[12]) * weight, ty = end[13] + (mesh[1] * t[0] + mesh[5] * t[1] + mesh[9] * t[2] + mesh[13] - end[13]) * weight, tz = end[14] + (mesh[2] * t[0] + mesh[6] * t[1] + mesh[10] * t[2] + mesh[14] - end[14]) * weight;
      for (let iteration = 0; iteration < (options.iterations ?? 12) && !(Math.hypot(end[12] - tx, end[13] - ty, end[14] - tz) < (options.tolerance ?? 1e-3)); iteration++)
        for (let k = indices.length - 2; k >= 0; k--) {
          let i = indices[k], joint = this.globals[i], parent = this.skin.nodes[i].parent;
          parent < 0 ? this.inverse.set(identity()) : normalMatrixInto(this.inverse, 0, this.globals[parent]);
          let ax = end[12] - joint[12], ay = end[13] - joint[13], az = end[14] - joint[14], bx = tx - joint[12], by = ty - joint[13], bz = tz - joint[14], m = this.inverse, x = m[0] * ax + m[1] * ay + m[2] * az, y = m[4] * ax + m[5] * ay + m[6] * az, z = m[8] * ax + m[9] * ay + m[10] * az, u = m[0] * bx + m[1] * by + m[2] * bz, v = m[4] * bx + m[5] * by + m[6] * bz, s = m[8] * bx + m[9] * by + m[10] * bz, a = Math.hypot(x, y, z), b = Math.hypot(u, v, s);
          if (a < 1e-10 || b < 1e-10) continue;
          x /= a, y /= a, z /= a, u /= b, v /= b, s /= b;
          let qx = y * s - z * v, qy = z * u - x * s, qz = x * v - y * u, qw = 1 + Math.max(-1, Math.min(1, x * u + y * v + z * s));
          qw < 1e-8 && (Math.abs(x) < 0.9 ? (qx = 0, qy = z, qz = -y) : (qx = -z, qy = 0, qz = x), qw = 0);
          let length = Math.hypot(qx, qy, qz, qw);
          if (this.delta.set([qx / length, qy / length, qz / length, qw / length]), this.delta[3] < Math.SQRT1_2) {
            let axis = Math.hypot(
              this.delta[0],
              this.delta[1],
              this.delta[2]
            );
            for (let c = 0; c < 3; c++)
              this.delta[c] = this.delta[c] / axis * Math.SQRT1_2;
            this.delta[3] = Math.SQRT1_2;
          }
          multiplyQuat(pose, i * 10 + 3, this.delta, 0, pose, i * 10 + 3);
          let limit = limits.get(i);
          limit !== void 0 && this.constrain(pose, i, limit), this.matrices(pose);
        }
      if (options.rotation !== void 0) {
        let node = indices.at(-1);
        this.worldRotation(pose, this.skin.meshNode, this.orientation), multiplyQuat(this.orientation, 0, this.orientation, 0, options.rotation, 0), this.worldRotation(pose, this.skin.nodes[node].parent, this.parentRotation);
        for (let c = 0; c < 3; c++) this.parentRotation[c] = -this.parentRotation[c];
        multiplyQuat(this.orientation, 0, this.parentRotation, 0, this.orientation, 0), blendQuat(pose, node * 10 + 3, this.orientation, 0, weight * (options.rotationWeight ?? 1));
        let limit = limits.get(node);
        limit !== void 0 && this.constrain(pose, node, limit);
      }
    }
  }
};

// src/scene/blend-space.ts
var MAX_BLEND_SAMPLES2 = 32;
function blendWeights(points) {
  let n = points.length;
  if (n < 1 || n > MAX_BLEND_SAMPLES2 || points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1])))
    throw new RangeError(`A blend space needs 1 to ${MAX_BLEND_SAMPLES2} samples at finite points`);
  if (points.some((p, i) => points.some((q, j) => j < i && p[0] === q[0] && p[1] === q[1])))
    throw new RangeError("Blend samples must be at distinct points");
  let ox = points[0][0], oy = points[0][1], X = points.map((p) => p[0] - ox), Y = points.map((p) => p[1] - oy), L = Math.max(Math.max(...X) - Math.min(...X), Math.max(Math.max(...Y) - Math.min(...Y))) || 1, Z = X.map((x, i) => x * x + Y[i] * Y[i]), W = X.map((_, i) => {
    let h = Math.imul(i + 1, 2654435761);
    return h ^= h >>> 15, h = Math.imul(h, 2246822507), h ^= h >>> 13, (h >>> 0) / 2 ** 32;
  }), inside = (a, b, c, d, z) => {
    let ax = X[a] - X[d], ay = Y[a] - Y[d], bx = X[b] - X[d], by = Y[b] - Y[d], cx = X[c] - X[d], cy = Y[c] - Y[d], az = z[a] - z[d], bz = z[b] - z[d], cz = z[c] - z[d];
    return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }, triangles = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    let area = (X[j] - X[i]) * (Y[k] - Y[i]) - (X[k] - X[i]) * (Y[j] - Y[i]);
    if (Math.abs(area) <= 1e-12 * L * L) continue;
    let [b, c] = area > 0 ? [j, k] : [k, j], empty = !0;
    for (let d = 0; d < n && empty; d++) {
      if (d === i || d === j || d === k) continue;
      let lifted = inside(i, b, c, d, Z);
      empty = !(lifted > 1e-11 * L ** 4 || lifted >= -1e-11 * L ** 4 && inside(i, b, c, d, W) > 0);
    }
    empty && triangles.push([i, b, c]);
  }
  if (triangles.length === 0) {
    let order = X.map((_, i) => i).sort((a, b) => X[a] - X[b] || Y[a] - Y[b]), first = order[0], last = order[n - 1], length = Math.hypot(X[last] - X[first], Y[last] - Y[first]), dx = n > 1 ? (X[last] - X[first]) / length : 0, dy = n > 1 ? (Y[last] - Y[first]) / length : 0, along = (x, y) => (x - X[first]) * dx + (y - Y[first]) * dy, t = order.map((i) => along(X[i], Y[i]));
    if (t.some((v, i) => i > 0 && v - t[i - 1] <= 1e-12 * L))
      throw new RangeError("Blend samples must be at distinct points");
    return (x, y, out) => {
      out.fill(0), x -= ox, y -= oy;
      let s = Math.min(t[n - 1], Math.max(t[0], along(x, y))), k = 1;
      for (; k < n && t[k] < s; ) k++;
      if (k === n) out[order[0]] = 1;
      else {
        let w = (s - t[k - 1]) / (t[k] - t[k - 1]);
        out[order[k - 1]] = 1 - w, out[order[k]] = w;
      }
    };
  }
  let counts = /* @__PURE__ */ new Map();
  for (let [a, b, c] of triangles) for (let [p, q] of [[a, b], [b, c], [c, a]]) {
    let key = Math.min(p, q) * 64 + Math.max(p, q);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let areas = triangles.map(([a, b, c]) => (X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a])), hull = [...counts].filter(([, count]) => count === 1).map(([key]) => [Math.floor(key / 64), key % 64]);
  return (x, y, out) => {
    out.fill(0), x -= ox, y -= oy;
    let cross3 = (p, q) => (X[p] - x) * (Y[q] - y) - (Y[p] - y) * (X[q] - x), best = -1 / 0, at2 = 0, u = 0, v = 0, w = 0;
    if (triangles.forEach(([a, b, c], t) => {
      let p = cross3(b, c) / areas[t], q = cross3(c, a) / areas[t], r = cross3(a, b) / areas[t], least = Math.min(p, q, r);
      least > best && (best = least, at2 = t, u = p, v = q, w = r);
    }), best >= -1e-9) {
      let [a, b, c] = triangles[at2];
      u = Math.max(0, u), v = Math.max(0, v), w = Math.max(0, w);
      let total = u + v + w;
      out[a] = u / total, out[b] = v / total, out[c] = w / total;
      return;
    }
    let nearest = 1 / 0;
    for (let [a, b] of hull) {
      let ex = X[b] - X[a], ey = Y[b] - Y[a], t = Math.min(1, Math.max(0, ((x - X[a]) * ex + (y - Y[a]) * ey) / (ex * ex + ey * ey))), distance = Math.hypot(X[a] + ex * t - x, Y[a] + ey * t - y);
      distance < nearest && (nearest = distance, out.fill(0), out[a] = 1 - t, out[b] = t);
    }
  };
}
var BlendSpace = class {
  constructor(skin) {
    this.skin = skin;
    this.other = new Float64Array(skin.nodes.length * 10);
  }
  skin;
  samples = [];
  solver;
  key = "";
  px = 0;
  py = 0;
  speed = 1;
  phaseValue = 0;
  previous = 0;
  running = !1;
  ended = !1;
  looping = !0;
  wraps = 0;
  current = new Float64Array(MAX_BLEND_SAMPLES2);
  last = new Float64Array(MAX_BLEND_SAMPLES2);
  fresh = !1;
  lastValid = !1;
  other;
  value = new Float64Array(4);
  revision = 0;
  get active() {
    return this.samples.length > 0;
  }
  get phase() {
    return this.phaseValue;
  }
  get parameter() {
    return { x: this.px, y: this.py };
  }
  get playing() {
    return this.active && this.running;
  }
  get finished() {
    return this.active && this.ended;
  }
  /** Current weights, one per sample in the order given to `set`. Do not retain the array. */
  weights() {
    return !this.fresh && this.solver !== void 0 && (this.solver(this.px, this.py, this.current), this.fresh = !0), this.current;
  }
  rate(w) {
    let rate = 0;
    return this.samples.forEach((sample, i) => {
      rate += w[i] / sample.clip.duration;
    }), rate;
  }
  get duration() {
    return this.active ? 1 / this.rate(this.weights()) : 0;
  }
  inspect() {
    if (!this.active) return null;
    let w = this.weights();
    return {
      phase: this.phase,
      parameter: this.parameter,
      samples: this.samples.map((s, i) => ({ clip: s.clip.name, x: s.x, y: s.y, weight: w[i] }))
    };
  }
  pause() {
    return this.active ? (this.running = !1, !0) : !1;
  }
  resume() {
    return !this.active || this.ended ? !1 : (this.running = !0, !0);
  }
  play(looping = !0, speed = 1) {
    return !this.active || !Number.isFinite(speed) || speed < 0 ? !1 : (this.looping = looping, this.speed = speed, this.running = !0, this.ended = !1, this.seek(0), !0);
  }
  set(options) {
    if (options === void 0) {
      this.samples = [], this.solver = void 0, this.key = "", this.wraps = 0, this.lastValid = !1, this.revision++;
      return;
    }
    let samples = options.samples.map((sample) => {
      let clip = this.skin.clips.find((clip2) => clip2.name === sample.clip);
      if (clip === void 0 || clip.duration <= 0)
        throw new RangeError("Blend samples need existing nonzero-duration clips");
      return { x: sample.x, y: sample.y, clip };
    }), key = samples.map((s) => `${s.x},${s.y}`).join(";"), solver = key === this.key && this.solver !== void 0 ? this.solver : blendWeights(samples.map((s) => [s.x, s.y])), px = options.parameter?.x ?? samples[0].x, py = options.parameter?.y ?? samples[0].y, phase = options.phase ?? 0, speed = options.speed ?? 1;
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(speed) || speed < 0 || !Number.isFinite(phase) || phase < 0 || phase >= 1)
      throw new RangeError("Invalid blend parameter, speed or phase");
    this.samples = samples, this.solver = solver, this.key = key, this.px = px, this.py = py, this.fresh = !1, this.speed = speed, this.running = !0, this.ended = !1, this.looping = options.looping ?? !0, this.phaseValue = phase, this.previous = phase, this.wraps = 0, this.lastValid = !1, this.revision++;
  }
  setParameter(x, y = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError("Blend parameter must be finite");
    (x !== this.px || y !== this.py) && (this.px = x, this.py = y, this.fresh = !1, this.revision++);
  }
  seek(phase) {
    if (!Number.isFinite(phase) || phase < 0 || phase > 1)
      throw new RangeError("Blend phase must be in [0,1]");
    this.phaseValue = phase, this.previous = phase, this.wraps = 0, this.lastValid = !1, this.revision++, this.ended = !1;
  }
  advance(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Blend delta must be finite and nonnegative");
    if (this.previous = this.phaseValue, this.wraps = 0, !this.active || !this.running || dt === 0) {
      this.lastValid = !1;
      return;
    }
    let w = this.weights();
    this.last.set(w), this.lastValid = !0;
    let next = this.phaseValue + dt * this.speed * this.rate(w);
    if (!Number.isFinite(next) || next > Number.MAX_SAFE_INTEGER)
      throw new RangeError("Blend update exceeds the supported cycle range");
    !this.looping && next >= 1 ? (this.phaseValue = 1, this.running = !1, this.ended = !0) : (this.wraps = Math.floor(next), this.phaseValue = next - this.wraps), dt > 0 && this.speed > 0 && this.revision++;
  }
  /** Marker seconds in a contributing clip; crossings remain available between pose updates. */
  crossed(name, seconds) {
    if (!this.active || !this.lastValid || !Number.isFinite(seconds) || seconds < 0) return !1;
    let at2 = this.samples.findIndex((sample, i) => sample.clip.name === name && this.last[i] > 0);
    return at2 < 0 || seconds > this.samples[at2].clip.duration ? !1 : this.crossedPhase(seconds / this.samples[at2].clip.duration);
  }
  crossedPhase(marker) {
    return !this.lastValid || !Number.isFinite(marker) || marker < 0 || marker > 1 ? !1 : this.wraps > 1 || (this.wraps === 1 ? marker > this.previous || marker <= this.phaseValue : marker > this.previous && marker <= this.phaseValue);
  }
  sample(clip, out, bind) {
    out.set(bind);
    for (let channel of clip.channels) {
      sampleChannelInto(channel, this.phaseValue * clip.duration, this.value);
      let at2 = channel.node * 10 + (channel.path === "translation" ? 0 : channel.path === "rotation" ? 3 : 7);
      out.set(this.value.subarray(0, channel.path === "rotation" ? 4 : 3), at2);
    }
  }
  /** Weighted pose: clips in sample order, each blended in by its share of the weight so far. */
  apply(out, bind) {
    let w = this.weights(), total = 0;
    this.samples.forEach((sample, i) => {
      if (w[i] === 0) return;
      if (total === 0) {
        this.sample(sample.clip, out, bind), total = w[i];
        return;
      }
      this.sample(sample.clip, this.other, bind);
      let t = w[i] / (total + w[i]);
      total += w[i];
      for (let at2 = 0; at2 < out.length; at2 += 10) {
        for (let c of [0, 1, 2, 7, 8, 9]) out[at2 + c] = out[at2 + c] + (this.other[at2 + c] - out[at2 + c]) * t;
        blendQuat(out, at2 + 3, this.other, at2 + 3, t);
      }
    });
  }
  /** Accumulate displacement across every wrap, independently of pose evaluation cadence. */
  rootDelta(node, out) {
    let w = this.weights();
    this.samples.forEach(({ clip }, i) => {
      let influence = w[i], channel = influence === 0 ? void 0 : clip.channels.find((channel2) => channel2.node === node && channel2.path === "translation");
      if (channel !== void 0)
        for (let [time, factor] of [[this.previous * clip.duration, -1], [this.phaseValue * clip.duration, 1], [0, -this.wraps], [clip.duration, this.wraps]]) {
          sampleChannelInto(channel, time, this.value);
          for (let c = 0; c < 3; c++) out[c] = out[c] + this.value[c] * influence * factor;
        }
    });
  }
};

// src/scene/locomotion.ts
var LocomotionBlend = class {
  constructor(space) {
    this.space = space;
  }
  space;
  get active() {
    return this.space.active;
  }
  get phase() {
    return this.space.phase;
  }
  get parameter() {
    return this.space.parameter.x;
  }
  get playing() {
    return this.space.playing;
  }
  get finished() {
    return this.space.finished;
  }
  get duration() {
    return this.space.duration;
  }
  get revision() {
    return this.space.revision;
  }
  inspect() {
    let blend = this.space.inspect();
    return blend === null || blend.samples.some((sample) => sample.y !== 0) ? null : {
      phase: blend.phase,
      parameter: blend.parameter.x,
      samples: blend.samples.map((sample) => ({ clip: sample.clip, threshold: sample.x, weight: sample.weight }))
    };
  }
  pause() {
    return this.space.pause();
  }
  resume() {
    return this.space.resume();
  }
  play(looping = !0, speed = 1) {
    return this.space.play(looping, speed);
  }
  set(options) {
    if (options === void 0) {
      this.space.set(void 0);
      return;
    }
    let { samples } = options;
    if (samples.length < 2 || samples.some((sample, i) => i > 0 && sample.threshold <= samples[i - 1].threshold))
      throw new RangeError("Locomotion needs at least two samples with strictly increasing thresholds");
    this.space.set({
      ...options,
      samples: samples.map((sample) => ({ clip: sample.clip, x: sample.threshold, y: 0 })),
      parameter: { x: options.parameter ?? samples[0].threshold, y: 0 }
    });
  }
  setParameter(value) {
    this.space.setParameter(value, this.space.parameter.y);
  }
  seek(phase) {
    this.space.seek(phase);
  }
  crossed(name, seconds) {
    return this.space.crossed(name, seconds);
  }
  crossedPhase(marker) {
    return this.space.crossedPhase(marker);
  }
};

// src/scene/pose-schedule.ts
var PoseSchedule = class {
  bands = [];
  elapsed = 0;
  previous = -1;
  set(bands) {
    let copy = bands?.map((band) => ({ ...band })) ?? [];
    for (let i = 0; i < copy.length; i++) {
      let band = copy[i];
      if (!Number.isFinite(band.distance) || band.distance < 0 || !Number.isFinite(band.interval) || band.interval < 0 || (i === 0 ? band.distance !== 0 : band.distance <= copy[i - 1].distance))
        throw new RangeError("Animation update bands need increasing distances starting at zero and finite nonnegative intervals");
    }
    this.bands = copy, this.elapsed = 0, this.previous = -1;
  }
  due(dt, distance, force = !1) {
    if (!Number.isFinite(distance) || distance < 0)
      throw new RangeError("Animation distance must be finite and nonnegative");
    let selected = 0;
    for (let i = 1; i < this.bands.length && !(distance < this.bands[i].distance); i++)
      selected = i;
    let interval = this.bands[selected]?.interval ?? 0;
    this.elapsed += dt;
    let closer = this.previous >= 0 && selected < this.previous;
    return this.previous = selected, !force && !closer && this.elapsed + 1e-12 < interval ? !1 : (this.elapsed = interval > 0 ? this.elapsed % interval : 0, interval > 0 && interval - this.elapsed < 1e-12 && (this.elapsed = 0), !0);
  }
};

// src/scene/skeleton.ts
function slerp(out, at2, a, b, t) {
  let dot3 = 0;
  for (let i = 0; i < 4; i++) dot3 += a[at2 + i] * b[at2 + i];
  let sign = dot3 < 0 ? -1 : 1, angle = Math.acos(Math.min(1, Math.abs(dot3))), sin = Math.sin(angle), wa = sin > 1e-6 ? Math.sin((1 - t) * angle) / sin : 1 - t, wb = sin > 1e-6 ? Math.sin(t * angle) / sin : t;
  for (let i = 0; i < 4; i++) out[at2 + i] = a[at2 + i] * wa + b[at2 + i] * wb * sign;
  let norm = Math.hypot(out[at2], out[at2 + 1], out[at2 + 2], out[at2 + 3]);
  for (let i = 0; i < 4; i++) out[at2 + i] = out[at2 + i] / norm;
}
var SkeletonPlayer = class {
  constructor(skin, initial) {
    this.skin = skin;
    this.layers = new PoseLayers(skin), this.ik = new PoseIK(skin), this.blend = new BlendSpace(skin), this.locomotion = new LocomotionBlend(this.blend), this.bind = new Float64Array(skin.nodes.length * 10), skin.nodes.forEach((node, i) => {
      this.bind.set(node.translation, i * 10);
      let q = node.rotation, norm = Math.hypot(...q);
      this.bind.set(q.map((v) => v / norm), i * 10 + 3), this.bind.set(node.scale, i * 10 + 7);
    }), this.pose = this.bind.slice(), this.sample = this.bind.slice(), this.from = this.bind.slice(), this.animated = this.bind.slice(), this.animatedGlobals = skin.nodes.map(() => identity()), this.locals = skin.nodes.map(() => identity()), this.globals = skin.nodes.map(() => identity()), this.inverseBind = skin.inverseBind.map((m) => new Float32Array(m)), this.palette = new Float32Array(skin.joints.length * 16), this.paletteEntries = skin.joints.map((_, joint) => this.palette.subarray(joint * 16, joint * 16 + 16));
    let visited = /* @__PURE__ */ new Set(), visit = (i) => {
      if (visited.has(i)) return;
      let parent = skin.nodes[i].parent;
      parent >= 0 && visit(parent), visited.add(i), this.order.push(i);
    };
    skin.nodes.forEach((_, i) => visit(i)), (initial === void 0 || !this.transition(initial, 0, !0, 1)) && (this.clock.add({ slot: 0, duration: 0, channels: [] }), this.clock.pause(0), this.evaluate());
  }
  skin;
  layers;
  ik;
  /** The phase-synchronized 1D/2D blend that replaces the base clip while active (decision 0220). */
  blend;
  /** The 1D view of `blend`: thresholds are x with y = 0 (decision 0196). */
  locomotion;
  schedule = new PoseSchedule();
  evaluatedLocomotion = -1;
  /** Camera-distance bands; omit to evaluate on every update. Clocks and root motion are never throttled. */
  setUpdatePolicy(bands) {
    this.schedule.set(bands);
  }
  rootNode = -1;
  rootDelta = new Float64Array(3);
  rootSample = new Float64Array(4);
  /** Host ownership extracts base-clip translation; the displayed root stays at bind translation. */
  setRootMotion(node) {
    let index = node === void 0 ? -1 : this.skin.nodes.findIndex((n) => n.name === node);
    if (node !== void 0 && index < 0) throw new RangeError(`Unknown root-motion node: ${node}`);
    this.rootNode = index, this.rootDelta.fill(0), this.evaluatedTime = NaN;
  }
  consumeRootMotion() {
    let result = { x: this.rootDelta[0], y: this.rootDelta[1], z: this.rootDelta[2] };
    return this.rootDelta.fill(0), result;
  }
  /**
   * Like `consumeRootMotion`, but the displacement is turned from the root node's parent space into the skeletal mesh
   * local space of `jointPosition` (the linear part of the parent's displayed transform relative to the mesh node), so
   * it can be carried to the world by the entity's transform alone (decision 0223).
   */
  consumeRootMotionLocal() {
    let delta = this.consumeRootMotion();
    if (this.rootNode < 0) return delta;
    let parent = this.skin.nodes[this.rootNode].parent, m = this.product;
    return parent < 0 ? m.set(this.inverseMesh) : multiplyInto(m, this.inverseMesh, this.globals[parent]), { x: m[0] * delta.x + m[4] * delta.y + m[8] * delta.z, y: m[1] * delta.x + m[5] * delta.y + m[9] * delta.z, z: m[2] * delta.x + m[6] * delta.y + m[10] * delta.z };
  }
  /** Final local-pose adjustment, after layers and before world matrices/sockets. */
  override;
  evaluatedLayers = -1;
  evaluatedIK = -1;
  /** Supplies the canonical humanoid bones that limb goals and foot placement use (decision 0222); undefined removes them. */
  setHumanoid(map) {
    this.ik.setHumanoid(map);
  }
  setProceduralOverride(override) {
    this.override = override, this.evaluatedTime = NaN;
  }
  clock = new ClipPlayers();
  outgoing;
  held = !1;
  palette;
  pose;
  bind;
  /** The pose before the limb, foot and chain goals, and what `animatedJointPosition` derives from it (decision 0224). */
  animated;
  animatedGlobals;
  animatedLocal = identity();
  animatedInverse = identity();
  animatedStale = !0;
  /** Incoming sample during evaluation; unlayered displayed pose between evaluations. */
  sample;
  from;
  locals;
  globals;
  inverseBind;
  paletteEntries;
  order = [];
  scratch = identity();
  inverseMesh = identity();
  product = identity();
  value = new Float64Array(4);
  name = "";
  blendTime = 0;
  blendDuration = 0;
  revisionValue = 0;
  evaluatedTime = NaN;
  evaluatedBlend = NaN;
  evaluatedWeight = NaN;
  get revision() {
    return this.revisionValue;
  }
  /** Copies current evaluated diagnostics. Never advances clocks, consumes root motion or evaluates a pose. */
  inspect() {
    let progress = this.blendDuration === 0 ? 1 : Math.min(1, this.blendTime / this.blendDuration);
    return {
      mode: this.held ? "held" : this.blend.active ? "locomotion" : this.name === "" ? "bind" : "clip",
      clip: this.name || null,
      transition: { elapsed: this.blendTime, duration: this.blendDuration, progress, outgoingClip: this.outgoing?.name ?? null, fromSnapshot: progress < 1 && this.outgoing === void 0 },
      rootMotionNode: this.rootNode < 0 ? null : this.rootNode,
      proceduralOverride: this.override !== void 0,
      nodes: this.skin.nodes.map((node, index) => (multiplyInto(this.product, this.inverseMesh, this.globals[index]), {
        index,
        name: node.name,
        parent: node.parent,
        joint: this.skin.joints.includes(index),
        position: { x: Math.fround(this.product[12]), y: Math.fround(this.product[13]), z: Math.fround(this.product[14]) }
      })),
      layers: this.layers.inspect(),
      ik: this.ik.inspect(),
      ...this.ik.limbs.inspect(),
      blend: this.blend.inspect(),
      locomotion: this.locomotion.inspect()
    };
  }
  /**
   * Like `jointPosition`, for the pose the animation gives before the limb, foot and chain goals (decision 0224): the base clip or
   * blend, layers, the procedural override and root ownership. With no goal set it equals `jointPosition`; with goals it is the pose
   * the program would see without them, so a program can place a foot from where the animation puts it. Computed on demand from a copy
   * of the pose taken at each evaluation; it never evaluates.
   */
  animatedJointPosition(name) {
    let i = this.skin.nodes.findIndex((n) => n.name === name);
    return i < 0 ? { x: 0, y: 0, z: 0 } : (this.animatedStale && this.forwardAnimated(), multiplyInto(this.product, this.animatedInverse, this.animatedGlobals[i]), { x: Math.fround(this.product[12]), y: Math.fround(this.product[13]), z: Math.fround(this.product[14]) });
  }
  forwardAnimated() {
    let p = this.animated, local = this.animatedLocal, g = this.animatedGlobals;
    for (let i of this.order) {
      let a = i * 10;
      fromRotationTranslationScaleInto(local, this.scratch, { x: p[a + 3], y: p[a + 4], z: p[a + 5], w: p[a + 6] }, { x: p[a], y: p[a + 1], z: p[a + 2] }, { x: p[a + 7], y: p[a + 8], z: p[a + 9] });
      let parent = this.skin.nodes[i].parent;
      parent < 0 ? g[i].set(local) : multiplyInto(g[i], g[parent], local);
    }
    let mesh = g[this.skin.meshNode], inverse = this.animatedInverse;
    normalMatrixInto(this.scratch, 0, mesh);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) inverse[c * 4 + r] = this.scratch[r * 4 + c];
    for (let r = 0; r < 3; r++) inverse[12 + r] = -(inverse[r] * mesh[12] + inverse[4 + r] * mesh[13] + inverse[8 + r] * mesh[14]);
    this.animatedStale = !1;
  }
  jointPosition(name) {
    let i = this.skin.nodes.findIndex((n) => n.name === name);
    return i < 0 ? { x: 0, y: 0, z: 0 } : (multiplyInto(this.product, this.inverseMesh, this.globals[i]), { x: Math.fround(this.product[12]), y: Math.fround(this.product[13]), z: Math.fround(this.product[14]) });
  }
  jointRotation(name) {
    let i = this.skin.nodes.findIndex((n2) => n2.name === name);
    if (i < 0) return { x: 0, y: 0, z: 0, w: 1 };
    multiplyInto(this.product, this.inverseMesh, this.globals[i]);
    let m = this.product, sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]), a = m[0] / sx, b = m[4] / sy, c = m[8] / sz, d = m[1] / sx, e = m[5] / sy, f = m[9] / sz, g = m[2] / sx, h = m[6] / sy, j = m[10] / sz, x, y, z, w, trace = a + e + j;
    if (trace > 0) {
      let s = Math.sqrt(trace + 1) * 2;
      w = s / 4, x = (h - f) / s, y = (c - g) / s, z = (d - b) / s;
    } else if (a > e && a > j) {
      let s = Math.sqrt(1 + a - e - j) * 2;
      w = (h - f) / s, x = s / 4, y = (b + d) / s, z = (c + g) / s;
    } else if (e > j) {
      let s = Math.sqrt(1 + e - a - j) * 2;
      w = (c - g) / s, x = (b + d) / s, y = s / 4, z = (f + h) / s;
    } else {
      let s = Math.sqrt(1 + j - a - e) * 2;
      w = (d - b) / s, x = (c + g) / s, y = (f + h) / s, z = s / 4;
    }
    let n = Math.hypot(x, y, z), length = Math.hypot(n, w);
    return { x: Math.fround(x / length), y: Math.fround(y / length), z: Math.fround(z / length), w: Math.fround(w / length) };
  }
  transition(name, seconds, looping, speed) {
    let clip = this.skin.clips.find((c) => c.name === name);
    return clip === void 0 || !Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(speed) || speed < 0 ? !1 : (this.blend.active && (this.blend.set(void 0), this.name = ""), name === this.name || (this.outgoing = this.name !== "" && !this.held && this.blendTime >= this.blendDuration ? { name: this.name, clock: this.clock } : void 0, this.from.set(this.sample), this.held = !1, this.clock = new ClipPlayers(), this.name = name, this.evaluatedTime = NaN, this.blendTime = 0, this.blendDuration = seconds, this.clock.add({ slot: 0, duration: clip.duration, channels: [] }), this.clock.play(0, looping, speed), this.evaluate()), !0);
  }
  /** Snapshot only: the destination owns its pose and never follows source lifetime. */
  copyPose(source) {
    return this.skin.meshNode !== source.skin.meshNode || this.skin.nodes.length !== source.skin.nodes.length || this.skin.nodes.some((n, i) => {
      let other = source.skin.nodes[i];
      return n.name !== other.name || n.parent !== other.parent || n.translation.some((v, k) => v !== other.translation[k]) || n.rotation.some((v, k) => v !== other.rotation[k]) || n.scale.some((v, k) => v !== other.scale[k]);
    }) ? !1 : (this.blend.set(void 0), this.from.set(source.pose), this.pose.set(source.pose), this.held = !0, this.name = "", this.outgoing = void 0, this.blendDuration = 0, this.blendTime = 0, this.evaluatedTime = NaN, this.clock = new ClipPlayers(), this.clock.add({ slot: 0, duration: 0, channels: [] }), this.clock.pause(0), this.evaluate(), !0);
  }
  samplePose(name, time, out) {
    out.set(this.bind);
    let clip = this.skin.clips.find((c) => c.name === name);
    for (let channel of clip?.channels ?? []) {
      sampleChannelInto(channel, time, this.value);
      let offset = channel.node * 10 + (channel.path === "translation" ? 0 : channel.path === "rotation" ? 3 : 7);
      out.set(this.value.subarray(0, channel.path === "rotation" ? 4 : 3), offset);
    }
  }
  play(looping, speed) {
    if (this.blend.active) {
      let ok2 = this.blend.play(looping, speed);
      return ok2 && this.evaluate(), ok2;
    }
    let ok = this.clock.play(0, looping, speed);
    return ok && (this.from.set(this.sample), this.blendTime = 0, this.evaluate()), ok;
  }
  advance(dt, evaluate = !0, distance = 0) {
    if (!Number.isFinite(dt) || dt < 0) return;
    let previous = this.clock.time(0), outgoingTime = this.outgoing?.clock.time(0) ?? 0, oldBlend = this.blendTime;
    if (this.clock.advance(dt, () => {
    }), this.outgoing?.clock.advance(dt, () => {
    }), this.layers.advance(dt), this.ik.advance(dt), this.blend.advance(dt), this.blendTime = Math.min(this.blendDuration, this.blendTime + dt), this.rootNode >= 0 && this.blend.active) {
      this.rootSample.fill(0), this.blend.rootDelta(this.rootNode, this.rootSample);
      for (let c = 0; c < 3; c++) this.rootDelta[c] = this.rootDelta[c] + this.rootSample[c] * this.clock.weight(0);
    } else if (this.rootNode >= 0) {
      let integral = (t) => t * t * t - 0.5 * t * t * t * t, duration = this.blendDuration, blend = 1;
      if (duration > 0 && dt > 0 && oldBlend < duration) {
        let end = Math.min(duration, oldBlend + dt);
        blend = (duration * (integral(end / duration) - integral(oldBlend / duration)) + Math.max(0, oldBlend + dt - duration)) / dt;
      }
      this.extractRoot(this.name, this.clock, previous, blend * this.clock.weight(0)), this.outgoing !== void 0 && this.extractRoot(this.outgoing.name, this.outgoing.clock, outgoingTime, (1 - blend) * this.outgoing.clock.weight(0));
    }
    this.blendTime >= this.blendDuration && (this.outgoing = void 0), evaluate && this.schedule.due(dt, distance) && this.evaluate();
  }
  extractRoot(name, clock, previous, weight) {
    if (weight === 0 || this.held) return;
    let clip = this.skin.clips.find((c) => c.name === name), channel = clip?.channels.find((c) => c.node === this.rootNode && c.path === "translation");
    if (channel === void 0 || clip === void 0) return;
    sampleChannelInto(channel, previous, this.rootSample);
    for (let c = 0; c < 3; c++) this.rootDelta[c] = this.rootDelta[c] - this.rootSample[c] * weight;
    sampleChannelInto(channel, clock.time(0), this.rootSample);
    for (let c = 0; c < 3; c++) this.rootDelta[c] = this.rootDelta[c] + this.rootSample[c] * weight;
    let wraps = clock.wraps(0);
    if (wraps > 0) {
      sampleChannelInto(channel, 0, this.rootSample);
      for (let c = 0; c < 3; c++) this.rootDelta[c] = this.rootDelta[c] - this.rootSample[c] * weight * wraps;
      sampleChannelInto(channel, clip.duration, this.rootSample);
      for (let c = 0; c < 3; c++) this.rootDelta[c] = this.rootDelta[c] + this.rootSample[c] * weight * wraps;
    }
  }
  evaluate() {
    let time = this.clock.time(0), weight = this.clock.weight(0);
    if (this.override === void 0 && time === this.evaluatedTime && this.blendTime === this.evaluatedBlend && weight === this.evaluatedWeight && this.evaluatedLayers === this.layers.revision && this.evaluatedIK === this.ik.revision && !this.ik.animating && this.evaluatedLocomotion === this.blend.revision) return;
    if (this.evaluatedTime = time, this.evaluatedBlend = this.blendTime, this.evaluatedWeight = weight, this.evaluatedLayers = this.layers.revision, this.evaluatedIK = this.ik.revision, this.evaluatedLocomotion = this.blend.revision, this.held ? this.sample.set(this.from) : this.samplePose(this.name, time, this.sample), this.outgoing !== void 0) {
      this.samplePose(this.outgoing.name, this.outgoing.clock.time(0), this.from);
      let oldWeight = this.outgoing.clock.weight(0);
      for (let i = 0; i < this.skin.nodes.length; i++) {
        let at2 = i * 10;
        for (let c of [0, 1, 2, 7, 8, 9]) this.from[at2 + c] = this.bind[at2 + c] + (this.from[at2 + c] - this.bind[at2 + c]) * oldWeight;
        slerp(this.from, at2 + 3, this.bind, this.from, oldWeight);
      }
    }
    let t = this.blendDuration > 0 ? Math.min(1, this.blendTime / this.blendDuration) : 1, blend = t * t * (3 - 2 * t);
    for (let i = 0; i < this.skin.nodes.length; i++) {
      let at2 = i * 10;
      for (let c = 0; c < 10; c++) this.pose[at2 + c] = this.from[at2 + c] + (this.sample[at2 + c] - this.from[at2 + c]) * blend;
      slerp(this.pose, at2 + 3, this.from, this.sample, blend);
      for (let c of [0, 1, 2, 7, 8, 9]) this.pose[at2 + c] = this.bind[at2 + c] + (this.pose[at2 + c] - this.bind[at2 + c]) * weight;
      slerp(this.pose, at2 + 3, this.bind, this.pose, weight);
    }
    if (this.blend.active) {
      this.blend.apply(this.pose, this.bind);
      for (let at2 = 0; at2 < this.pose.length; at2 += 10) {
        for (let c of [0, 1, 2, 7, 8, 9]) this.pose[at2 + c] = this.bind[at2 + c] + (this.pose[at2 + c] - this.bind[at2 + c]) * weight;
        slerp(this.pose, at2 + 3, this.bind, this.pose, weight);
      }
    }
    if (this.sample.set(this.pose), this.layers.apply(this.pose, this.bind), this.override?.(this.pose), this.rootNode >= 0) for (let c = 0; c < 3; c++) this.pose[this.rootNode * 10 + c] = this.bind[this.rootNode * 10 + c];
    for (let i = 0; i < this.pose.length; i++)
      if (!Number.isFinite(this.pose[i]) || i % 10 >= 7 && this.pose[i] <= 0) throw new RangeError("Procedural pose contains an invalid transform");
    for (let at2 = 3; at2 < this.pose.length; at2 += 10) {
      let length = Math.hypot(this.pose[at2], this.pose[at2 + 1], this.pose[at2 + 2], this.pose[at2 + 3]);
      if (length < 1e-8) throw new RangeError("Procedural pose contains a zero quaternion");
      for (let c = 0; c < 4; c++) this.pose[at2 + c] = this.pose[at2 + c] / length;
    }
    this.animated.set(this.pose), this.animatedStale = !0, this.ik.apply(this.pose);
    for (let i of this.order) {
      let a = i * 10, p = this.pose;
      fromRotationTranslationScaleInto(
        this.locals[i],
        this.scratch,
        { x: p[a + 3], y: p[a + 4], z: p[a + 5], w: p[a + 6] },
        { x: p[a], y: p[a + 1], z: p[a + 2] },
        { x: p[a + 7], y: p[a + 8], z: p[a + 9] }
      );
      let parent = this.skin.nodes[i].parent;
      parent < 0 ? this.globals[i].set(this.locals[i]) : multiplyInto(this.globals[i], this.globals[parent], this.locals[i]);
    }
    let mesh = this.globals[this.skin.meshNode];
    normalMatrixInto(this.scratch, 0, mesh);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) this.inverseMesh[c * 4 + r] = this.scratch[r * 4 + c];
    for (let r = 0; r < 3; r++) this.inverseMesh[12 + r] = -(this.inverseMesh[r] * mesh[12] + this.inverseMesh[4 + r] * mesh[13] + this.inverseMesh[8 + r] * mesh[14]);
    for (let j = 0; j < this.skin.joints.length; j++)
      multiplyInto(this.product, this.globals[this.skin.joints[j]], this.inverseBind[j]), multiplyInto(this.paletteEntries[j], this.inverseMesh, this.product);
    this.revisionValue++;
  }
}, SkeletalPlayers = class extends AnimationPlayers {
  rigs = /* @__PURE__ */ new Map();
  groups = /* @__PURE__ */ new Map();
  skin(slot) {
    return this.rigs.get(slot);
  }
  /** Explicit pose cohorts: all members intentionally share clocks, layers, IK and a palette. */
  share(source, targets) {
    let player = this.rigs.get(source);
    if (player === void 0) throw new RangeError("Animation sharing needs a skinned source");
    for (let target of targets) {
      let other = this.rigs.get(target);
      if (other === void 0 || other !== player && other.skin !== player.skin && JSON.stringify(other.skin) !== JSON.stringify(player.skin))
        throw new RangeError("Animation sharing needs identical skeletal assets");
    }
    let changed = !1;
    for (let target of targets) this.rigs.get(target) !== player && (this.rigs.set(target, player), changed = !0);
    return changed;
  }
  detach(slot) {
    let source = this.rigs.get(slot);
    if (source === void 0) throw new RangeError("Animation detaching needs a skinned entity");
    let player = new SkeletonPlayer(source.skin);
    return player.copyPose(source), this.rigs.set(slot, player), player;
  }
  addSkin(slot, skin, clip) {
    this.rigs.set(slot, new SkeletonPlayer(skin, clip));
  }
  remove(slot) {
    super.remove(slot), this.rigs.delete(slot);
  }
  copyPose(target, source) {
    let a = this.rigs.get(target), b = this.rigs.get(source);
    return a !== void 0 && b !== void 0 && a.copyPose(b);
  }
  transition(slot, name, seconds, looping, speed) {
    return this.rigs.get(slot)?.transition(name, seconds, looping, speed) ?? !1;
  }
  play(slot, looping, speed) {
    let r = this.rigs.get(slot);
    return r === void 0 ? super.play(slot, looping, speed) : r.play(looping, speed);
  }
  clock(slot) {
    let r = this.rigs.get(slot);
    return r === void 0 ? [this.nodes, slot] : [r.clock, 0];
  }
  pause(slot) {
    let blend = this.rigs.get(slot)?.locomotion;
    if (blend?.active === !0) return blend.pause();
    let [c, s] = this.clock(slot);
    return c.pause(s);
  }
  resume(slot) {
    let blend = this.rigs.get(slot)?.locomotion;
    if (blend?.active === !0) return blend.resume();
    let [c, s] = this.clock(slot);
    return c.resume(s);
  }
  seek(slot, time) {
    let blend = this.rigs.get(slot)?.locomotion;
    if (blend?.active === !0)
      return !Number.isFinite(time) || time < 0 || time > blend.duration ? !1 : (blend.seek(time / blend.duration), !0);
    let [c, s] = this.clock(slot);
    return c.seek(s, time);
  }
  fade(slot, weight, duration) {
    let [c, s] = this.clock(slot);
    return c.fade(s, weight, duration);
  }
  time(slot) {
    let blend = this.rigs.get(slot)?.locomotion;
    if (blend?.active === !0) return blend.phase * blend.duration;
    let [c, s] = this.clock(slot);
    return c.time(s);
  }
  duration(slot) {
    let blend = this.rigs.get(slot)?.locomotion;
    if (blend?.active === !0) return blend.duration;
    let [c, s] = this.clock(slot);
    return c.duration(s);
  }
  weight(slot) {
    let [c, s] = this.clock(slot);
    return c.weight(s);
  }
  playing(slot) {
    let blend = this.rigs.get(slot)?.locomotion;
    if (blend?.active === !0) return blend.playing;
    let [c, s] = this.clock(slot);
    return c.playing(s);
  }
  finished(slot) {
    let blend = this.rigs.get(slot)?.locomotion;
    if (blend?.active === !0) return blend.finished;
    let [c, s] = this.clock(slot);
    return c.finished(s);
  }
  crossed(slot, marker) {
    let blend = this.rigs.get(slot)?.locomotion;
    if (blend?.active === !0) return blend.crossedPhase(marker / blend.duration);
    let [c, s] = this.clock(slot);
    return c.crossed(s, marker);
  }
  advance(dt, apply, distance) {
    super.advance(dt, apply), this.groups.clear();
    for (let [slot, player] of this.rigs) this.groups.set(player, Math.min(this.groups.get(player) ?? 1 / 0, distance?.(slot) ?? 0));
    for (let [player, nearest] of this.groups) player.advance(dt, !0, nearest);
    this.groups.clear();
  }
  pose(apply, time) {
    super.pose(apply, time);
    for (let r of this.rigs.values()) r.evaluate();
  }
  poseSlot(slot, apply) {
    super.poseSlot(slot, apply), this.rigs.get(slot)?.evaluate();
  }
};

// src/animation-module/entry.ts
function createAnimationBackend() {
  return {
    name: "mtek-animation",
    createPlayers: () => new SkeletalPlayers(),
    createCommands: (host) => new AnimationScript(host),
    retargetHumanoid
  };
}
var load = createAnimationBackend, entry_default = load;
export {
  createAnimationBackend,
  entry_default as default
};
