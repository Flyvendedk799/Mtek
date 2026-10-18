import { describe, expect, it } from "vitest";
import {
  CHAIR_LEAN,
  CHAIR_YAW,
  CONFIGURATOR_CAMERA,
  DEFAULT_INPUTS,
  MISS,
  NODE_WORLD,
  ODD_CELL,
  REPEAT_COLUMNS,
  REPEAT_ROWS,
  STRIPE_BANDS,
  UNSTABLE,
  Tracer,
  compareImage,
  configuratorScene,
  expectedImage,
  hexBytes,
  hexLinear,
  loadChair,
  parseGlb,
  pixelsOf,
  primitiveTriangles,
  repeatedInstances,
  repeatedScene,
  repeatedSource,
  stripeBand,
  type GltfNode,
  type Vec3,
} from "./configurator-scene.ts";
import { multiply, projectionMatrix, quatEuler, rotation, scaling, transformPoint, translation, viewMatrix, type Mat4 } from "./m1-reference.ts";

const glb = loadChair();

/** The world matrix of every node of the file, by name: parents applied first (glTF node hierarchy, `T · R · S`). */
function worldOfNodes(): Map<string, Mat4> {
  const nodes = glb.json.nodes;
  const out = new Map<string, Mat4>();
  const visit = (index: number, parent: Mat4): void => {
    const node: GltfNode | undefined = nodes[index];
    if (node === undefined) throw new Error("bad node index");
    const t = (node.translation ?? [0, 0, 0]) as unknown as Vec3;
    const r = (node.rotation ?? [0, 0, 0, 1]) as unknown as readonly [number, number, number, number];
    const s = (node.scale ?? [1, 1, 1]) as unknown as Vec3;
    const world = multiply(parent, multiply(translation(t), multiply(rotation(r), scaling(s))));
    if (node.name !== undefined) out.set(node.name, world);
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of glb.json.scenes[0]?.nodes ?? []) visit(root, translation([0, 0, 0]));
  return out;
}

describe("the GLB the example ships", () => {
  it("has the meshes, primitives and materials the example names", () => {
    expect(glb.json.meshes.map((m) => [m.name, m.primitives.length])).toEqual([
      ["Floor", 1],
      ["Seat", 1],
      ["Back", 1],
      ["Leg", 1],
      ["Crest", 1],
      ["Rails", 2],
    ]);
    expect(glb.json.materials.map((m) => m.name)).toEqual(["Stone", "Fabric", "Oak", "Steel"]);
    expect(glb.json.nodes.map((n) => n.name)).toEqual(["Floor", "Chair", "Seat", "Back", "LegFL", "LegFR", "LegBL", "LegBR", "Rails", "Crest"]);
  });

  it("has the hand-written world matrices of the oracle for every node (to 1e-6)", () => {
    const fromFile = worldOfNodes();
    for (const [name, expected] of Object.entries(NODE_WORLD)) {
      const actual = fromFile.get(name);
      expect(actual, name).toBeDefined();
      actual?.forEach((value, i) => expect(value, `${name}[${String(i)}]`).toBeCloseTo(expected[i] ?? NaN, 6));
    }
    // And the yaw and lean are the numbers of the generator's table.
    const chair = glb.json.nodes.find((n) => n.name === "Chair");
    expect(chair?.rotation?.[1]).toBeCloseTo(Math.sin(CHAIR_YAW / 2), 7);
    expect(glb.json.nodes.find((n) => n.name === "Back")?.rotation?.[0]).toBeCloseTo(Math.sin(CHAIR_LEAN / 2), 7);
  });

  it("has flat-shaded meshes of the dimensions of the table in make-glb.mjs", () => {
    const extent = (mesh: string, primitive: number): { min: number[]; max: number[] } => {
      const points = primitiveTriangles(glb, mesh, primitive).flatMap((t) => t.p);
      return { min: [0, 1, 2].map((a) => Math.min(...points.map((p) => p[a] ?? 0))), max: [0, 1, 2].map((a) => Math.max(...points.map((p) => p[a] ?? 0))) };
    };
    const near = (actual: number[], expected: number[]): void => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i] ?? NaN, 6));
    near(extent("Floor", 0).min, [-1.6, 0, -1.6]);
    near(extent("Floor", 0).max, [1.6, 0, 1.6]);
    near(extent("Seat", 0).max, [0.25, 0.03, 0.25]);
    near(extent("Back", 0).max, [0.25, 0.2, 0.02]);
    near(extent("Leg", 0).max, [0.04, 0.21, 0.04]);
    near(extent("Crest", 0).max, [0.25, 0.04, 0.03]);
    near(extent("Rails", 0).min, [-0.2, -0.025, 0.175]);
    near(extent("Rails", 1).max, [0.2, 0.025, -0.175]);
    expect(primitiveTriangles(glb, "Floor", 0)).toHaveLength(2);
    expect(primitiveTriangles(glb, "Leg", 0)).toHaveLength(12);
    // The leg's sides lean outwards going up (0.025 at the bottom, 0.04 at the top, over 0.42), so the outward normal of the
    // +X side, the first face, is (1, -0.015 / 0.42, 0) normalised: it tilts down.
    const side = primitiveTriangles(glb, "Leg", 0)[0];
    const edge1 = [0, 1, 2].map((a) => (side?.p[1][a] ?? 0) - (side?.p[0][a] ?? 0));
    const edge2 = [0, 1, 2].map((a) => (side?.p[2][a] ?? 0) - (side?.p[0][a] ?? 0));
    const normal = [edge1[1]! * edge2[2]! - edge1[2]! * edge2[1]!, edge1[2]! * edge2[0]! - edge1[0]! * edge2[2]!, edge1[0]! * edge2[1]! - edge1[1]! * edge2[0]!];
    const length = Math.hypot(...normal);
    const slope = 0.015 / 0.42;
    near(
      normal.map((c) => c / length),
      [1 / Math.hypot(1, slope), -slope / Math.hypot(1, slope), 0],
    );
  });

  it("is rejected when it is not a binary glTF", () => {
    expect(() => parseGlb(Buffer.from("not a glb file at all"))).toThrow(/binary glTF/);
  });
});

describe("the ray tracer", () => {
  const scene = configuratorScene();
  const tracer = new Tracer(scene, glb);
  const WIDTH = 320;
  const HEIGHT = 240;

  it("sends the ray through the middle of the target at the camera target and the rays through the corners to the field of view", () => {
    const middle = tracer.rayAt(WIDTH, HEIGHT, WIDTH / 2, HEIGHT / 2);
    const toTarget = [0, -0.7, -2.6].map((c) => c / Math.hypot(0.7, 2.6));
    middle.direction.forEach((c, i) => expect(c).toBeCloseTo(toTarget[i] ?? NaN, 12));
    // The top edge of the target subtends fov / 2 above the axis.
    const top = tracer.rayAt(WIDTH, HEIGHT, WIDTH / 2, 0);
    const cosAngle = top.direction[0] * middle.direction[0] + top.direction[1] * middle.direction[1] + top.direction[2] * middle.direction[2];
    expect(Math.acos(cosAngle)).toBeCloseTo(CONFIGURATOR_CAMERA.fovY / 2, 10);
    // The right edge subtends atan(tan(fov / 2) * aspect).
    const right = tracer.rayAt(WIDTH, HEIGHT, WIDTH, HEIGHT / 2);
    const cosRight = right.direction[0] * middle.direction[0] + right.direction[1] * middle.direction[1] + right.direction[2] * middle.direction[2];
    expect(Math.acos(cosRight)).toBeCloseTo(Math.atan(Math.tan(CONFIGURATOR_CAMERA.fovY / 2) * (WIDTH / HEIGHT)), 10);
  });

  it("agrees with the view and projection matrices of spec/runtime-abi.md section 8.3: a hit projects back to its pixel", () => {
    const camera = { position: CONFIGURATOR_CAMERA.position, target: CONFIGURATOR_CAMERA.target, projection: { kind: "perspective" as const, fovY: CONFIGURATOR_CAMERA.fovY, near: 0.1, far: 30 } };
    const viewProjection = multiply(projectionMatrix(camera.projection, WIDTH / HEIGHT), viewMatrix(camera));
    let hits = 0;
    for (let y = 3; y < HEIGHT; y += 17) {
      for (let x = 5; x < WIDTH; x += 19) {
        const hit = tracer.cast(tracer.rayAt(WIDTH, HEIGHT, x + 0.5, y + 0.5));
        if (hit === undefined) continue;
        hits += 1;
        const ndc = transformPoint(viewProjection, hit.position);
        expect(((ndc[0] + 1) / 2) * WIDTH).toBeCloseTo(x + 0.5, 6);
        expect(((1 - ndc[1]) / 2) * HEIGHT).toBeCloseTo(y + 0.5, 6);
      }
    }
    expect(hits).toBeGreaterThan(25);
  });

  it("hits the top of the seat where the centre ray meets the plane y = 0.48, derived by hand", () => {
    // The ray from (0, 1.15, 2.6) along (0, -0.7, -2.6) reaches y = 0.48 after s = 0.67 / 0.7 of that vector: z = 2.6 (1 - s).
    const s = 0.67 / 0.7;
    const hit = tracer.cast(tracer.rayAt(WIDTH, HEIGHT, WIDTH / 2, HEIGHT / 2));
    expect(hit).toBeDefined();
    expect(scene.placements[hit?.entity ?? -1]?.name).toBe("Seat");
    hit?.position.forEach((c, i) => expect(c).toBeCloseTo([0, 0.48, 2.6 * (1 - s)][i] ?? NaN, 6));
    hit?.normal.forEach((c, i) => expect(c).toBeCloseTo([0, 1, 0][i] ?? NaN, 12));
    // Its uv: local x' = x cos + ... the seat top is face +Y with u = +X and v = -Z: the point's local coordinates are
    // (x cos(yaw) - z sin(yaw), z cos(yaw) + x sin(yaw)) / 0.5 inside [-1, 1].
    const z = 2.6 * (1 - s);
    const localX = -z * Math.sin(CHAIR_YAW);
    const localZ = z * Math.cos(CHAIR_YAW);
    expect(hit?.uv[0]).toBeCloseTo((localX / 0.25 + 1) / 2, 7);
    expect(hit?.uv[1]).toBeCloseTo((1 - -localZ / 0.25) / 2, 7);
  });

  it("culls back faces and finds a closer surface in front of a farther one", () => {
    // Looking down from above the chair the nearest front face is the seat top, not the floor under it. A ray that starts
    // inside the seat leaves through faces that point away from it: they are back faces and are culled, as the renderer does.
    const down = tracer.cast({ origin: [0, 3, 0], direction: [0, -1, 0] });
    expect(scene.placements[down?.entity ?? -1]?.name).toBe("Seat");
    expect(down?.distance).toBeCloseTo(3 - 0.48, 6);
    expect(tracer.cast({ origin: [0, 0.45, 0], direction: [0, 1, 0] })).toBeUndefined();
    // From below the seat the same upward ray meets the underside from outside, a front face.
    const below = tracer.cast({ origin: [0, 0.2, 0], direction: [0, 1, 0] });
    expect(scene.placements[below?.entity ?? -1]?.name).toBe("Seat");
    expect(below?.distance).toBeCloseTo(0.42 - 0.2, 6);
  });

  it("gives the stripe band of the uv: the first half of each band is band 0", () => {
    expect(stripeBand(0.01, STRIPE_BANDS)).toBe(0);
    expect(stripeBand(0.08, STRIPE_BANDS)).toBe(0);
    expect(stripeBand(0.09, STRIPE_BANDS)).toBe(1);
    expect(stripeBand(0.16, STRIPE_BANDS)).toBe(1);
    expect(stripeBand(1 / 6 + 0.01, STRIPE_BANDS)).toBe(0);
    expect(stripeBand(0.5, STRIPE_BANDS)).toBe(0);
    expect(stripeBand(0.99, STRIPE_BANDS)).toBe(1);
  });
});

describe("the expected image of the example", () => {
  const image = expectedImage(configuratorScene(), 320, 240, { glb });

  it("shows every entity with a substantial number of stable pixels, the background and nothing the footprint rule cannot decide twice", () => {
    for (const name of ["Floor", "Seat", "Back", "LegFL", "LegFR", "LegBL", "LegBR", "RailFront", "RailBack"]) {
      expect(pixelsOf(image, name).length, name).toBeGreaterThan(40);
    }
    const clear = [...image.entity].filter((e) => e === MISS).length;
    const unstable = [...image.entity].filter((e) => e === UNSTABLE).length;
    expect(clear).toBeGreaterThan(5000);
    expect(unstable).toBeLessThan(0.1 * image.width * image.height);
    // The background pixels carry the clear colour.
    const first = [...image.entity].indexOf(MISS);
    expect([...image.rgb.slice(first * 3, first * 3 + 3)]).toEqual([...hexBytes("#1b1f27")]);
  });

  it("shows both stripe colours on the back", () => {
    const back = pixelsOf(image, "Back").map((i) => [image.rgb[i * 3], image.rgb[i * 3 + 1], image.rgb[i * 3 + 2]].join(","));
    const distinct = new Set(back);
    expect(distinct.size).toBeGreaterThan(8);
    const bright = back.filter((c) => Number(c.split(",")[0]) > 100).length;
    const dark = back.filter((c) => Number(c.split(",")[0]) <= 100).length;
    expect(bright).toBeGreaterThan(200);
    expect(dark).toBeGreaterThan(200);
  });

  it("changes only the seat's pixels when the seat's inputs change", () => {
    const inputs = { ...DEFAULT_INPUTS, seat: { baseColor: hexLinear("#2e7d32"), metallic: 1, roughness: 0.2 } };
    const changed = expectedImage(configuratorScene(inputs), 320, 240, { glb });
    const seat = new Set(pixelsOf(image, "Seat"));
    let differ = 0;
    for (let i = 0; i < image.width * image.height; i += 1) {
      const same = [0, 1, 2].every((c) => image.rgb[i * 3 + c] === changed.rgb[i * 3 + c]) && image.entity[i] === changed.entity[i];
      if (!same) {
        differ += 1;
        expect(seat.has(i), `pixel ${String(i)} changed outside the seat`).toBe(true);
      }
    }
    expect(differ).toBeGreaterThan(200);
  });

  it("compares a frame with a tolerance and names the worst pixel", () => {
    const frame = new Uint8Array(image.width * image.height * 4);
    for (let i = 0; i < image.width * image.height; i += 1) {
      for (let c = 0; c < 3; c += 1) frame[i * 4 + c] = image.rgb[i * 3 + c] ?? 0;
      frame[i * 4 + 3] = 255;
    }
    const exact = compareImage(image, frame, 3);
    expect(exact.maxError).toBe(0);
    expect(exact.outside).toBe(0);
    expect(exact.compared).toBeGreaterThan(30000);
    const seatPixel = pixelsOf(image, "Seat")[10] ?? 0;
    frame[seatPixel * 4] = (frame[seatPixel * 4] ?? 0) + 5;
    const off = compareImage(image, frame, 3);
    expect(off.maxError).toBe(5);
    expect(off.outside).toBe(1);
    expect(off.worst).toContain("Seat");
  });
});

describe("the repeated-object scene", () => {
  const instances = repeatedInstances();

  it("has 80 copies in four groups of compatible draws and one odd seat", () => {
    expect(instances).toHaveLength(REPEAT_COLUMNS * REPEAT_ROWS);
    const count = (kind: string): number => instances.filter((i) => i.kind === kind).length;
    expect(count("Odd")).toBe(1);
    expect(count("Leg") + count("Seat") + count("Rail") + count("Crest") + count("Odd")).toBe(80);
    for (const kind of ["Leg", "Seat", "Rail", "Crest"]) expect(count(kind), kind).toBeGreaterThan(15);
    expect(instances.find((i) => i.kind === "Odd")?.name).toBe(`I${String(ODD_CELL.row * REPEAT_COLUMNS + ODD_CELL.column).padStart(2, "0")}`);
    // Every copy has a non-uniform scale and a rotation of its own.
    for (const instance of instances) {
      expect(new Set(instance.scale).size, instance.name).toBeGreaterThan(1);
      expect(Math.abs(instance.pitch) + Math.abs(instance.yaw), instance.name).toBeGreaterThan(0);
    }
    expect(new Set(instances.map((i) => `${String(i.pitch)}/${String(i.yaw)}/${i.scale.join(",")}`)).size).toBeGreaterThan(20);
  });

  it("is written as a Mtek scene with one entity per copy", () => {
    const source = repeatedSource();
    expect(source.match(/^ {4}entity I\d\d \{/gm)).toHaveLength(80);
    expect(source).toContain("scene Repeated {");
    expect(source).toContain('mesh: CHAIR.primitive("Rails", 0)');
    expect(source).toContain('material: CHAIR.material("Oak")');
    expect(source).toContain("roughness: 0.2;");
  });

  it("is sensitive to the normal matrix: normals transformed by the model matrix change hundreds of pixels by more than the tolerance", () => {
    const scene = repeatedScene();
    const right = expectedImage(scene, 480, 360, { glb });
    const wrong = expectedImage(scene, 480, 360, { glb, wrongNormals: true });
    const beyond: Record<string, number> = {};
    let largest = 0;
    for (let i = 0; i < right.width * right.height; i += 1) {
      const entity = right.entity[i] ?? UNSTABLE;
      if (entity < 0) continue;
      const error = Math.max(...[0, 1, 2].map((c) => Math.abs((right.rgb[i * 3 + c] ?? 0) - (wrong.rgb[i * 3 + c] ?? 0))));
      largest = Math.max(largest, error);
      if (error > 3) {
        const mesh = scene.placements[entity]?.mesh ?? "?";
        beyond[mesh] = (beyond[mesh] ?? 0) + 1;
      }
    }
    // Measured: 975 pixels of the crests (668 of them by more than 6), 94 of the legs, up to 32 of 255. Boxes cannot show it.
    expect(beyond["Crest"] ?? 0, "crest pixels beyond the 3/255 tolerance").toBeGreaterThan(500);
    expect(beyond["Leg"] ?? 0, "leg pixels beyond the 3/255 tolerance").toBeGreaterThan(30);
    expect(beyond["Seat"] ?? 0).toBe(0);
    expect(largest).toBeGreaterThan(20);
  });

  it("composes each copy's matrix as T R S with quat.euler(pitch, yaw, 0)", () => {
    const [first] = repeatedScene().placements;
    const instance = instances[0];
    expect(first).toBeDefined();
    expect(instance).toBeDefined();
    if (first === undefined || instance === undefined) return;
    const expected = multiply(translation(instance.position), multiply(rotation(quatEuler(instance.pitch, instance.yaw, 0)), scaling(instance.scale)));
    first.world.forEach((v, i) => expect(v).toBeCloseTo(expected[i] ?? NaN, 12));
  });
});
