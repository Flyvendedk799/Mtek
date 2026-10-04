/**
 * Resolving the references of the manifest's scene structure (`spec/runtime-abi.md` section 5.2) once,
 * at mount: entity parents, meshes, material instances, materials, their layouts and shaders.
 *
 * The schema validates shapes, not cross references. A reference that does not resolve is a broken
 * manifest (`E8006`, `manifest-invalid`). A structure this runtime build cannot render yet (asset meshes,
 * texture and sampler params) is an incompatible program (`E8003`, decision 0031).
 */
import type {
  MtekCamera,
  MtekLayoutRecord,
  MtekManifest,
  MtekMaterialParam,
  MtekShader,
  MtekVertexAttribute,
} from "../abi/manifest-types.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import type { MeshDescriptor } from "../mesh/cache.js";

/** A material as the renderer needs it: its parameter block layout (or none), its shader and params. */
export interface ResolvedMaterial {
  readonly id: string;
  /** Position in `manifest.materials`. */
  readonly index: number;
  /** `null` when the material has no value params (group 1 is then an empty layout). */
  readonly layout: MtekLayoutRecord | null;
  readonly shader: MtekShader;
  readonly params: readonly MtekMaterialParam[];
}

export interface ResolvedInstance {
  /** Index into `scene.materialInstances`. */
  readonly index: number;
  readonly material: ResolvedMaterial;
  readonly entity: number;
}

/** A primitive mesh of the manifest's `meshes` table. */
export interface ResolvedMesh {
  readonly id: string;
  readonly descriptor: MeshDescriptor;
}

export interface ResolvedEntity {
  /** Static index: stable instance order (depth-first pre-order). */
  readonly index: number;
  readonly name: string;
  readonly symbol: string;
  /** Always lower than `index` (parents come first). */
  readonly parent: number | null;
  readonly mesh: ResolvedMesh | null;
  readonly instance: ResolvedInstance | null;
}

export interface SceneStructure {
  readonly frameLayout: MtekLayoutRecord;
  readonly objectLayout: MtekLayoutRecord;
  readonly camera: MtekCamera;
  readonly entities: readonly ResolvedEntity[];
  /** In manifest order. */
  readonly materials: readonly ResolvedMaterial[];
  /** Indexed by material instance index. */
  readonly instances: readonly ResolvedInstance[];
  /** In manifest order. */
  readonly meshes: readonly ResolvedMesh[];
}

export type StructureResult =
  | { readonly ok: true; readonly structure: SceneStructure }
  | { readonly ok: false; readonly diagnostics: readonly MtekDiagnostic[] };

export const FRAME_LAYOUT_ID = "builtin:frame";
export const OBJECT_LAYOUT_ID = "builtin:object";

/** Members of the built-in blocks the renderer writes (through the generated field writers). */
export const FRAME_MEMBERS = ["view_proj", "camera_position", "light_count", "ambient"] as const;
export const OBJECT_MEMBERS = ["model", "normal_matrix"] as const;

/** The vertex attributes of `spec/materials.md` section 3.3, in vertex-buffer slot order. */
export const VERTEX_ATTRIBUTE_ORDER: readonly MtekVertexAttribute[] = ["position", "normal", "uv"];

function broken(field: string, message: string): MtekDiagnostic {
  return makeRuntimeDiagnostic("E8006", { phase: "runtime:mount", message: `Invalid manifest: ${message}`, notes: [`field: ${field}`] });
}

function unsupported(field: string, message: string): MtekDiagnostic {
  return makeRuntimeDiagnostic("E8003", {
    phase: "runtime:mount",
    message: `Incompatible program: ${message}`,
    notes: [`field: ${field}`, "this runtime build renders primitive meshes and value params only (M1)"],
  });
}

/** True when `attributes` is a subsequence of position, normal, uv (each at most once, in that order). */
function inSlotOrder(attributes: readonly MtekVertexAttribute[]): boolean {
  let next = 0;
  for (const attribute of attributes) {
    const at = VERTEX_ATTRIBUTE_ORDER.indexOf(attribute, next);
    if (at < 0) return false;
    next = at + 1;
  }
  return attributes[0] === "position";
}

/** Resolves every reference of the scene structure, or returns every problem found. */
export function resolveStructure(manifest: MtekManifest): StructureResult {
  const diagnostics: MtekDiagnostic[] = [];
  const { scene } = manifest;

  if (manifest.entryScene !== scene.name) {
    diagnostics.push(broken("entryScene", `the entry scene '${manifest.entryScene}' is not the manifest's scene '${scene.name}'.`));
  }

  const layouts = new Map(manifest.layouts.map((layout) => [layout.id, layout]));
  const frameLayout = layouts.get(FRAME_LAYOUT_ID);
  const objectLayout = layouts.get(OBJECT_LAYOUT_ID);
  if (frameLayout === undefined) diagnostics.push(broken("layouts", `the built-in layout '${FRAME_LAYOUT_ID}' is missing.`));
  if (objectLayout === undefined) diagnostics.push(broken("layouts", `the built-in layout '${OBJECT_LAYOUT_ID}' is missing.`));
  for (const [layout, members] of [
    [frameLayout, FRAME_MEMBERS],
    [objectLayout, OBJECT_MEMBERS],
  ] as const) {
    if (layout === undefined) continue;
    for (const member of members) {
      if (!layout.root.members.some((candidate) => candidate.name === member)) {
        diagnostics.push(broken("layouts", `the built-in layout '${layout.id}' lacks the member '${member}'.`));
      }
    }
  }

  const active = scene.cameras.filter((camera) => camera.active);
  const camera = active[0];
  if (active.length !== 1 || camera === undefined) {
    diagnostics.push(broken("scene.cameras", `a scene needs exactly one active camera, found ${String(active.length)}.`));
  }

  const shaders = new Map(manifest.shaders.map((shader) => [shader.hash, shader]));
  const materials: ResolvedMaterial[] = [];
  manifest.materials.forEach((material, index) => {
    const field = `materials[${String(index)}]`;
    const shader = shaders.get(material.shader);
    if (shader === undefined) {
      diagnostics.push(broken(`${field}.shader`, `material '${material.id}' names the shader ${material.shader}, which the shaders table lacks.`));
      return;
    }
    if (!inSlotOrder(shader.vertexAttributes)) {
      diagnostics.push(
        broken(`shaders.vertexAttributes`, `the shader of '${material.id}' lists vertex attributes [${shader.vertexAttributes.join(", ")}], not position[, normal][, uv].`),
      );
      return;
    }
    let layout: MtekLayoutRecord | null = null;
    if (material.layout !== null) {
      const found = layouts.get(material.layout);
      if (found === undefined) {
        diagnostics.push(broken(`${field}.layout`, `material '${material.id}' names the layout '${material.layout}', which the layouts table lacks.`));
        return;
      }
      layout = found;
      const missing = material.params.find((param) => !found.root.members.some((member) => member.name === param.name));
      if (missing !== undefined) {
        diagnostics.push(broken(`${field}.params`, `material '${material.id}' has the param '${missing.name}', which its layout '${found.id}' lacks.`));
        return;
      }
    }
    if (material.resources.length > 0) {
      diagnostics.push(unsupported(`${field}.resources`, `material '${material.id}' has texture or sampler params.`));
      return;
    }
    materials.push({ id: material.id, index, layout, shader, params: material.params });
  });
  const materialById = new Map(materials.map((material) => [material.id, material]));

  const meshes: ResolvedMesh[] = [];
  manifest.meshes.forEach((mesh, index) => {
    if (mesh.kind === "asset") {
      diagnostics.push(unsupported(`meshes[${String(index)}]`, `mesh '${mesh.id}' comes from an asset.`));
      return;
    }
    meshes.push({ id: mesh.id, descriptor: mesh });
  });
  const meshById = new Map(meshes.map((mesh) => [mesh.id, mesh]));

  const instances: ResolvedInstance[] = [];
  scene.materialInstances.forEach((instance, index) => {
    const field = `scene.materialInstances[${String(index)}]`;
    if (instance.index !== index) {
      diagnostics.push(broken(`${field}.index`, `material instance ${String(index)} carries index ${String(instance.index)}.`));
      return;
    }
    const material = materialById.get(instance.material);
    if (material === undefined) {
      if (!manifest.materials.some((candidate) => candidate.id === instance.material)) {
        diagnostics.push(broken(`${field}.material`, `material instance ${String(index)} names the unknown material '${instance.material}'.`));
      }
      return;
    }
    instances[index] = { index, material, entity: instance.entity };
  });

  const entities: ResolvedEntity[] = [];
  scene.entities.forEach((entity, index) => {
    const field = `scene.entities[${String(index)}]`;
    if (entity.index !== index) {
      diagnostics.push(broken(`${field}.index`, `entity ${String(index)} ('${entity.name}') carries index ${String(entity.index)}.`));
      return;
    }
    if (entity.parent !== null && entity.parent >= index) {
      diagnostics.push(
        broken(`${field}.parent`, `entity '${entity.name}' has parent ${String(entity.parent)}; parents precede their children (depth-first pre-order).`),
      );
      return;
    }
    let mesh: ResolvedMesh | null = null;
    if (entity.mesh !== null) {
      const found = meshById.get(entity.mesh);
      if (found === undefined) {
        if (!manifest.meshes.some((candidate) => candidate.id === entity.mesh)) {
          diagnostics.push(broken(`${field}.mesh`, `entity '${entity.name}' names the unknown mesh '${entity.mesh}'.`));
        }
        return;
      }
      mesh = found;
    }
    let instance: ResolvedInstance | null = null;
    if (entity.material !== null) {
      const found = instances[entity.material.instance];
      // An instance that exists but did not resolve was reported already.
      if (found === undefined && scene.materialInstances[entity.material.instance] !== undefined) return;
      if (found?.index !== entity.material.instance || found.entity !== index || found.material.id !== entity.material.id) {
        diagnostics.push(
          broken(
            `${field}.material`,
            `entity '${entity.name}' names material instance ${String(entity.material.instance)} of '${entity.material.id}', which does not belong to it.`,
          ),
        );
        return;
      }
      instance = found;
    }
    if ((mesh === null) !== (instance === null)) {
      diagnostics.push(broken(field, `entity '${entity.name}' has a mesh without a material or a material without a mesh.`));
      return;
    }
    entities.push({ index, name: entity.name, symbol: entity.symbol, parent: entity.parent, mesh, instance });
  });

  if (diagnostics.length > 0 || frameLayout === undefined || objectLayout === undefined || camera === undefined) {
    return { ok: false, diagnostics };
  }
  return { ok: true, structure: { frameLayout, objectLayout, camera, entities, materials, instances, meshes } };
}
