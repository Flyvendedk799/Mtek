import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  createAnimationController,
  retargetSkin,
  type MtekSkin,
  type AnimationController,
} from "../../packages/runtime-web/src/animation.js";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!,
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x111820);
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(6, 5, 9);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.7, 0);
controls.update();
scene.add(new THREE.HemisphereLight(0xc4e3ff, 0x394234, 2));
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(3, 6, 5);
scene.add(sun);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0x25333d, roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const names = [
  "mesh",
  "hips",
  "torso",
  "head",
  "leftShoulder",
  "leftElbow",
  "leftHand",
  "rightShoulder",
  "rightElbow",
  "rightHand",
  "leftHip",
  "leftKnee",
  "leftFoot",
  "rightHip",
  "rightKnee",
  "rightFoot",
];
const parents = [-1, -1, 1, 2, 2, 4, 5, 2, 7, 8, 1, 10, 11, 1, 13, 14];
const translations = [
  [0, 0, 0],
  [0, 1.6, 0],
  [0, 0.7, 0],
  [0, 0.7, 0],
  [-0.45, 0.4, 0],
  [-0.55, 0, 0],
  [-0.5, 0, 0],
  [0.45, 0.4, 0],
  [0.55, 0, 0],
  [0.5, 0, 0],
  [-0.25, 0, 0],
  [0, -0.75, 0],
  [0, -0.75, 0],
  [0.25, 0, 0],
  [0, -0.75, 0],
  [0, -0.75, 0],
];
function rig(scale: number): {
  skin: MtekSkin;
  mesh: THREE.SkinnedMesh;
  bones: Record<string, THREE.Bone>;
} {
  const nodes = names.map((name, i) => ({
    name,
    parent: parents[i]!,
    translation: translations[i]!.map((v,c) => {
      const arm=scale>1&&[5,6,8,9].includes(i),leg=scale>1&&[11,12,14,15].includes(i);
      return v*scale*(arm&&c===0?.9:leg&&c===1?1.15:1)+(i===1&&c===1&&scale>1?1.5*scale*.15:0);
    }),
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  }));
  const bones = nodes.map((n) => {
    const b = new THREE.Bone();
    b.name = n.name;
    b.position.fromArray(n.translation);
    return b;
  });
  bones.forEach((b, i) => {
    if (nodes[i]!.parent >= 0) bones[nodes[i]!.parent]!.add(b);
  });
  bones[1]!.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones.slice(1));
  skeleton.calculateInverses();
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [],
    skinIndices: number[] = [],
    skinWeights: number[] = [];
  bones.slice(1).forEach((bone, j) => {
    const child = bone.children[0],
      end =
        child instanceof THREE.Bone
          ? child.position.clone()
          : new THREE.Vector3(0, 0.18 * scale, 0);
    const width =
      (bone.name === "torso" ? 0.65 : bone.name === "head" ? 0.38 : 0.2) *
      scale;
    const geometry = new THREE.BoxGeometry(
      width,
      Math.max(0.15 * scale, end.length()),
      width,
    );
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      end.clone().normalize(),
    );
    geometry.applyMatrix4(
      new THREE.Matrix4().compose(
        end.clone().multiplyScalar(0.5),
        q,
        new THREE.Vector3(1, 1, 1),
      ),
    );
    geometry.applyMatrix4(bone.matrixWorld);
    const start = positions.length / 3;
    positions.push(...geometry.getAttribute("position").array);
    normals.push(...geometry.getAttribute("normal").array);
    for (const i of geometry.index!.array) indices.push(start + i);
    for (let v = 0; v < geometry.getAttribute("position").count; v++) {
      skinIndices.push(j, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }
    geometry.dispose();
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(skinIndices, 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(skinWeights, 4),
  );
  geometry.setIndex(indices);
  const mesh = new THREE.SkinnedMesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: scale === 1 ? 0x55d5b3 : 0x7c9fff,
      roughness: 0.55,
    }),
  );
  mesh.add(bones[1]!);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;
  const skin: MtekSkin = {
    meshNode: 0,
    nodes,
    joints: bones.slice(1).map((_, i) => i + 1),
    inverseBind: skeleton.boneInverses.map((m) => m.toArray()),
    indices: Array.from({ length: positions.length / 3 }, (_, v) =>
      skinIndices.slice(v * 4, v * 4 + 4),
    ),
    weights: Array.from({ length: positions.length / 3 }, (_, v) =>
      skinWeights.slice(v * 4, v * 4 + 4),
    ),
    clips: [],
  };
  return {
    skin,
    mesh,
    bones: Object.fromEntries(bones.map((b) => [b.name, b])),
  };
}
const rotation = (node: number, angles: number[], axis = "x") => ({
  node,
  path: "rotation" as const,
  interpolation: "linear" as const,
  times: [0, 0.5, 1, 1.5, 2],
  values: angles.flatMap((a) =>
    new THREE.Quaternion()
      .setFromAxisAngle(
        axis === "x" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1),
        a,
      )
      .toArray(),
  ),
});
const first = rig(1),
  second = rig(1.25);
const source: MtekSkin = {
  ...first.skin,
  clips: [
    {
      name: "walk",
      duration: 2,
      channels: [
        rotation(10, [0, 0.35, 0, -0.35, 0]),
        rotation(13, [0, -0.35, 0, 0.35, 0]),
        rotation(11, [0, 0.35, 0, 0, 0]),
        rotation(14, [0, 0, 0, 0.35, 0]),
      ],
    },
    {
      name: "run",
      duration: 1,
      channels: [
        rotation(10, [0, 0.7, 0, -0.7, 0]),
        rotation(13, [0, -0.7, 0, 0.7, 0]),
        rotation(11, [0, 0.9, 0, 0.15, 0]),
        rotation(14, [0, 0.15, 0, 0.9, 0]),
      ].map(channel => ({ ...channel, times: channel.times.map(time => time / 2) })),
    },
    {
      name: "action",
      duration: 2,
      channels: [
        rotation(4, [0, -0.8, -0.8, -0.8, 0], "z"),
        rotation(5, [0, -0.8, -0.8, -0.8, 0], "z"),
      ],
    },
  ],
};
const mapped = retargetSkin(
  source,
  second.skin,
  Object.fromEntries(names.map((n) => [n, n])),
  { translationScale: 1.25, rotationSpace: "world" },
);
const actors = [
  {
    ...first,
    scale: 1,
    controller: createAnimationController(source, {
      clip: "walk",
      bones: first.bones,
    }),
  },
  {
    ...second,
    scale: 1.25,
    controller: createAnimationController(mapped, {
      clip: "walk",
      bones: second.bones,
    }),
  },
];
for (const actor of actors) actor.controller.setLocomotion({
  samples: [{ clip: "walk", threshold: 0 }, { clip: "run", threshold: 1 }], parameter: 0.3,
});
const helpers: THREE.SkeletonHelper[] = [],
  props: THREE.Mesh[] = [];
actors.forEach((actor, i) => {
  actor.mesh.position.x = i === 0 ? -1.8 : 1.8;
  scene.add(actor.mesh);
  const helper = new THREE.SkeletonHelper(actor.mesh);
  helper.visible = false;
  helpers.push(helper);
  scene.add(helper);
  const prop = new THREE.Mesh(
    new THREE.BoxGeometry(
      0.6 * actor.scale,
      0.2 * actor.scale,
      0.25 * actor.scale,
    ),
    new THREE.MeshStandardMaterial({ color: 0xffbd66 }),
  );
  prop.position.set(
    actor.mesh.position.x,
    2.5 * actor.scale,
    0.8 * actor.scale,
  );
  props.push(prop);
  scene.add(prop);
  const step = new THREE.Mesh(
    new THREE.BoxGeometry(
      0.6 * actor.scale,
      0.15 * actor.scale,
      0.8 * actor.scale,
    ),
    new THREE.MeshStandardMaterial({ color: 0x425565 }),
  );
  step.position.set(
    actor.mesh.position.x - 0.25 * actor.scale,
    0.075 * actor.scale,
    0.1 * actor.scale,
  );
  scene.add(step);
});
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
function configure(controller: AnimationController, scale: number): void {
  controller.setLocomotionParameter(Number(input("speed").value));
  controller.setLayer("upper", {
    clip: "action",
    weight: Number(input("action").value),
    mask: { leftShoulder: 1, leftElbow: 1 },
  });
  for (const side of ["left", "right"]) {
    if (input("feet").checked)
      controller.setIK(side + "Foot", {
        chain: [side + "Hip", side + "Knee", side + "Foot"],
        target: [
          (side === "left" ? -0.25 : 0.25) * scale,
          (side === "left" ? 0.25 : 0.1) * scale,
          0.1 * scale,
        ],
        iterations: 24,
        rotation: [0,0,0,1],
        limits: { [side + "Knee"]: { axis: [1,0,0], min: 0, max: 2.4 } },
      });
    else controller.player.ik.remove(side + "Foot");
    if (input("grip").checked)
      controller.setIK(side + "Grip", {
        chain: [side + "Shoulder", side + "Elbow", side + "Hand"],
        target: [
          (side === "left" ? -0.3 : 0.3) * scale,
          2.5 * scale,
          0.8 * scale,
        ],
        iterations: 24,
        rotation: [0,0,0,1],
      });
    else controller.player.ik.remove(side + "Grip");
  }
}
for (const element of document.querySelectorAll("input"))
  element.addEventListener("input", () => {
    for (const a of actors) configure(a.controller, a.scale);
    actors[1]!.controller.setUpdatePolicy(input("throttle").checked
      ? [{distance:0,interval:0},{distance:9,interval:1/15},{distance:16,interval:1/8}] : undefined);
    helpers.forEach((h) => {
      h.visible = input("skeleton").checked;
    });
  });
for (const a of actors) configure(a.controller, a.scale);
let previous = performance.now();
const samples: number[] = [];
renderer.setAnimationLoop(() => {
  const now = performance.now(),
    dt = input("pause").checked ? 0 : Math.min((now - previous) / 1000, 0.1);
  previous = now;
  const start = performance.now();
  actors.forEach((a) => a.controller.update(dt,false,camera.position.distanceTo(a.mesh.position)));
  props.forEach((p) => {
    p.visible = input("grip").checked;
  });
  samples.push(performance.now() - start);
  if (samples.length > 120) samples.shift();
  const width = innerWidth,
    height = innerHeight;
  if (
    canvas.width !== Math.floor(width * renderer.getPixelRatio()) ||
    canvas.height !== Math.floor(height * renderer.getPixelRatio())
  ) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
  document.getElementById("stats")!.textContent =
    `Pose CPU p95: ${[...samples].sort((a, b) => a - b)[Math.max(0, Math.ceil(samples.length * 0.95) - 1)]!.toFixed(2)} ms · ${String(actors.length)} rigs`;
});
Object.assign(window,{__mtekAnimationDemo: {
  snapshot: () => actors.map(actor => ({ phase: actor.controller.player.locomotion.phase, parameter: actor.controller.player.locomotion.parameter,
    hand: actor.controller.player.jointPosition("leftHand"), handRotation: actor.controller.player.jointRotation("leftHand"), revision: actor.controller.player.revision })),
}});
addEventListener("pagehide", () => {
  renderer.setAnimationLoop(null);
  actors.forEach((a) => {a.controller.dispose();a.mesh.skeleton.dispose();});
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        m.dispose();
    }
  });
  controls.dispose();
  renderer.dispose();
});
