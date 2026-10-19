// The documentation the baseline's model is given (`benchmarks/baselines/docs/reference.md`, decision 0108) must be
// version-correct: every API it names exists in the installed packages (three 0.186.1), and every function and type of the
// support module it lists is exported by the module. A name in the document that the packages do not have, or a document that
// forgot a name of the support module, fails here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as support from "../src/index.ts";
import * as web from "three/webgpu";
import * as tsl from "three/tsl";
import { describe, expect, it } from "vitest";

const docs = readFileSync(join(import.meta.dirname, "..", "..", "docs", "reference.md"), "utf8");

/** Names the document uses from `three/webgpu`. */
const WEBGPU_NAMES = [
  "Scene", "Group", "Object3D", "Mesh", "BoxGeometry", "SphereGeometry", "PlaneGeometry", "CylinderGeometry", "ConeGeometry",
  "CircleGeometry", "TorusGeometry", "MeshBasicMaterial", "MeshStandardMaterial", "MeshBasicNodeMaterial", "MeshStandardNodeMaterial",
  "AmbientLight", "DirectionalLight", "PointLight", "SpotLight", "HemisphereLight", "PerspectiveCamera", "OrthographicCamera", "Vector3",
  "Color", "Euler", "Quaternion", "MathUtils", "Texture", "FrontSide", "BackSide", "DoubleSide",
];
/** Names the document uses from `three/tsl`. */
const TSL_NAMES = [
  "uniform", "vec2", "vec3", "vec4", "float", "color", "mix", "clamp", "smoothstep", "step", "sin", "cos", "abs", "pow", "fract", "min", "max",
  "length", "normalize", "dot", "saturate", "positionLocal", "positionWorld", "normalLocal", "normalWorld", "uv", "texture", "time", "select", "If", "Fn",
];
/** Methods of Object3D, Vector3, Color and MathUtils the document names. */
const OBJECT3D_METHODS = ["add", "remove", "getObjectByName", "traverse", "lookAt", "rotateX", "rotateY", "rotateZ"];
const VECTOR3_METHODS = ["set", "add", "sub", "multiplyScalar", "length", "normalize", "lerp", "clone"];
const COLOR_METHODS = ["set", "copy", "setRGB", "setStyle"];
const MATH_UTILS = ["degToRad", "clamp", "lerp", "mapLinear"];
/** Methods of a TSL node the document names. */
const NODE_METHODS = ["add", "sub", "mul", "div", "oneMinus", "negate"];
/** What the support module exports as values, and the types the document lists. */
const SUPPORT_FUNCTIONS = ["srgb", "unlit", "boxMesh", "sphereMesh", "lookAtCamera", "orthographicCamera", "startTask", "loadTexture", "configureTexture"];
const SUPPORT_TYPES = ["Vec3", "TaskHost", "TaskApp"];

describe("the baseline documentation names only what exists", () => {
  it("is for the revision it says", () => {
    expect(docs).toContain("three.js r186");
    expect(web.REVISION).toBe("186");
  });

  it.each(WEBGPU_NAMES)("three/webgpu exports %s and the document names it", (name) => {
    expect(name in web).toBe(true);
    expect(docs).toContain(name);
  });

  it.each(TSL_NAMES)("three/tsl exports %s and the document names it", (name) => {
    expect(name in tsl).toBe(true);
    expect(docs).toContain(name);
  });

  it("names real methods of objects, vectors, colours, math and nodes", () => {
    for (const method of OBJECT3D_METHODS) expect(typeof (web.Object3D.prototype as unknown as Record<string, unknown>)[method], `Object3D.${method}`).toBe("function");
    for (const method of VECTOR3_METHODS) expect(typeof (web.Vector3.prototype as unknown as Record<string, unknown>)[method], `Vector3.${method}`).toBe("function");
    for (const method of COLOR_METHODS) expect(typeof (web.Color.prototype as unknown as Record<string, unknown>)[method], `Color.${method}`).toBe("function");
    for (const name of MATH_UTILS) expect(typeof (web.MathUtils as unknown as Record<string, unknown>)[name], `MathUtils.${name}`).toBe("function");
    const node = tsl.uniform(0) as unknown as Record<string, unknown>;
    for (const method of NODE_METHODS) expect(typeof node[method], `node.${method}`).toBe("function");
    expect("value" in node).toBe(true);
  });

  it.each(SUPPORT_FUNCTIONS)("the support module exports %s and the document lists it", (name) => {
    expect(typeof (support as unknown as Record<string, unknown>)[name]).toBe("function");
    expect(docs).toContain(name);
  });

  it.each(SUPPORT_TYPES)("the document lists the support type %s", (name) => {
    expect(docs).toContain(name);
  });

  it("lists every value export of the support module", () => {
    const exported = Object.keys(support).filter((key) => typeof (support as unknown as Record<string, unknown>)[key] === "function");
    for (const name of exported) expect(SUPPORT_FUNCTIONS, `${name} is exported by the support module but not covered by this test`).toContain(name);
  });

  it("states the frame constants it relies on", () => {
    expect(support.MAX_FRAME_DELTA).toBe(0.1);
    expect(docs).toContain("clamped to 0.1");
    expect(support.MAX_CATCH_UP_STEPS).toBe(4);
    expect(docs).toContain("0 to 4 per frame");
  });

  it("keeps the documentation about the size of a compiler context", () => {
    // `mtek context` is 7 to 15 kB for the benchmark tasks; the baseline gets a document of the same order, never more than the 24 000-byte context budget.
    const bytes = Buffer.byteLength(docs, "utf8");
    expect(bytes).toBeGreaterThan(6_000);
    expect(bytes).toBeLessThan(24_000);
  });
});
