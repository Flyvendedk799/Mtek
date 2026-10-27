/**
 * Resolving the references of the manifest's scene structure (`spec/runtime-abi.md` section 5.2) once,
 * at mount: entity parents, meshes, material instances, materials, their layouts and shaders.
 *
 * The schema validates shapes, not cross references. A reference that does not resolve is a broken
 * manifest (`E8006`, `manifest-invalid`): also an asset mesh or texture that names a file the `assets` table
 * lacks, a primitive whose regions do not fit the file, and an asset mesh that lacks an attribute its
 * material reads (decisions 0058 and 0060).
 */
import type {
  MtekBinding,
  MtekBody,
  MtekBuiltinResourceName,
  MtekCamera,
  MtekCollider,
  MtekImageAsset,
  MtekInstanceParam,
  MtekLayoutRecord,
  MtekManifest,
  MtekClip,
  MtekMaterialParam,
  MtekMaterialResource,
  MtekParticles,
  MtekShader,
  MtekSkin,
  MtekStateEntry,
  MtekVertexAttribute,
} from "../abi/manifest-types.js";
import { skinProblem } from "./skeleton.js";
import { makeRuntimeDiagnostic, type MtekDiagnostic } from "../diagnostics/types.js";
import { regionProblem } from "../mesh/asset.js";
import type { MeshSource } from "../mesh/cache.js";

/** A material as the renderer needs it: its parameter block layout (or none), its shader and params. */
export interface ResolvedMaterial {
  readonly id: string;
  /** Position in `manifest.materials`. */
  readonly index: number;
  /** `null` when the material has no value params (group 1 is then an empty layout). */
  readonly layout: MtekLayoutRecord | null;
  readonly shader: MtekShader;
  readonly params: readonly MtekMaterialParam[];
  /** The texture and sampler bindings of group 1, in param declaration order (bindings 1, 2, ...). */
  readonly resources: readonly MtekMaterialResource[];
}

/** A built-in texture or sampler of a material instance: what group 1 binds at `binding` (decision 0054). */
export interface ResolvedBuiltinResource {
  readonly name: string;
  readonly kind: "texture" | "sampler";
  readonly binding: number;
  readonly value: MtekBuiltinResourceName;
}

/** A texture of a material instance that comes from an image file of the `assets` table (decision 0060). */
export interface ResolvedAssetResource {
  readonly name: string;
  readonly kind: "texture";
  readonly binding: number;
  /** The image's url. */
  readonly value: string;
  readonly asset: MtekImageAsset;
}

export type ResolvedInstanceResource = ResolvedBuiltinResource | ResolvedAssetResource;

export interface ResolvedInstance {
  /** Index into `scene.materialInstances`. */
  readonly index: number;
  readonly material: ResolvedMaterial;
  readonly entity: number;
  /**
   * Every param is class `initial` or `resource` (the manifest's `shareable`): nothing writes the instance after
   * `init`, so it may share its parameter slot with a byte-identical instance (`spec/gpu-layout.md` section 8.2).
   */
  readonly shareable: boolean;
  /** In the order of `material.resources`. */
  readonly resources: readonly ResolvedInstanceResource[];
}

/** A mesh of the manifest's `meshes` table: a primitive shape or one primitive of a packaged file. */
export interface ResolvedMesh {
  readonly id: string;
  readonly descriptor: MeshSource;
}

export interface ResolvedEntity {
  /**
   * Static index: stable instance order (depth-first pre-order). For a spawned entity (decision 0064) the slot of
   * the entity table, which is at least the number of static entities and is reused after a destroy.
   */
  readonly index: number;
  readonly name: string;
  readonly symbol: string;
  /** Always lower than `index` (parents come first); `null` for a spawned entity, a root. */
  readonly parent: number | null;
  readonly mesh: ResolvedMesh | null;
  readonly instance: ResolvedInstance | null;
  /** Present when the entity declares `particles` (decision 0155). */
  readonly particles?: MtekParticles;
  /** Present when the entity declares `clip` (decision 0156). */
  readonly clip?: MtekClip;
  /** Present when the entity declares `clips_from` (decision 0223): the skeleton whose clips it plays. */
  readonly clipsFrom?: MtekSkin;
}

/** The material instance of a prefab, before an instance exists: every instance starts with these classes. */
export interface ResolvedPrefabMaterial {
  readonly material: ResolvedMaterial;
  readonly params: readonly MtekInstanceParam[];
  readonly shareable: boolean;
  /** In the order of `material.resources`. */
  readonly resources: readonly ResolvedInstanceResource[];
}

/** A prefab of `manifest.prefabs`, resolved (decision 0064). */
export interface ResolvedPrefab {
  /** The key of the program module's `prefabs` table. */
  readonly symbol: string;
  readonly name: string;
  /** Position in `manifest.prefabs`. */
  readonly index: number;
  readonly params: readonly { readonly name: string; readonly type: string }[];
  readonly mesh: ResolvedMesh | null;
  readonly material: ResolvedPrefabMaterial | null;
  /** The physics body and collider every instance gets when it is created (`null` together, decision 0065). */
  readonly body: MtekBody | null;
  readonly collider: MtekCollider | null;
  readonly state: readonly MtekStateEntry[];
  readonly update: boolean;
  readonly fixedUpdate: boolean;
  /** In binding-id order; entity 0 is the instance and material instance 0 its material. */
  readonly bindings: readonly MtekBinding[];
  readonly span: number;
  /** The tag every instance carries (decision 0150). */
  readonly tag?: string;
  /** The emitter every instance starts with (decision 0155). */
  readonly particles?: MtekParticles;
  /** The clip every instance plays (decision 0156). */
  readonly clip?: MtekClip;
  /** The skeleton whose clips every instance plays (decision 0223). */
  readonly clipsFrom?: MtekSkin;
}

/** A light of `scene.lights`: which entity carries it and what it was constructed with. */
export interface ResolvedLight {
  /** Position in `scene.lights`, which is the order of `MtekFrame.lights`. */
  readonly index: number;
  /** Static entity index. */
  readonly entity: number;
  readonly kind: "directional" | "point";
  /** 0 = unlimited; always 0 for a directional light. */
  readonly range: number;
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
  /** In `scene.lights` order; at most {@link SceneStructure.lightCapacity}. */
  readonly lights: readonly ResolvedLight[];
  /** The length of `MtekFrame.lights`, read from the frame layout. */
  readonly lightCapacity: number;
  /** The prefabs the program spawns, in manifest order (decision 0064). */
  readonly prefabs: readonly ResolvedPrefab[];
}

export type StructureResult =
  | { readonly ok: true; readonly structure: SceneStructure }
  | { readonly ok: false; readonly diagnostics: readonly MtekDiagnostic[] };

export const FRAME_LAYOUT_ID = "builtin:frame";
export const OBJECT_LAYOUT_ID = "builtin:object";

/** Members of the built-in blocks the renderer writes (through the generated field writers). */
export const FRAME_MEMBERS = ["view_proj", "camera_position", "light_count", "ambient", "lights"] as const;
export const OBJECT_MEMBERS = ["model", "normal_matrix"] as const;

/** The vertex attributes of `spec/materials.md` section 3.3, in vertex-buffer slot order. */
export const VERTEX_ATTRIBUTE_ORDER: readonly MtekVertexAttribute[] = ["position", "normal", "uv", "tangent"];

function broken(field: string, message: string): MtekDiagnostic {
  return makeRuntimeDiagnostic("E8006", { phase: "runtime:mount", message: `Invalid manifest: ${message}`, notes: [`field: ${field}`] });
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
  const outputNames = new Set<string>();
  for (const [index, output] of (manifest.scene.hostOutputs ?? []).entries()) {
    const field = `scene.hostOutputs[${String(index)}]`;
    if (outputNames.has(output.name)) diagnostics.push(broken(`${field}.name`, `host output '${output.name}' is listed twice.`));
    outputNames.add(output.name);
    const state = manifest.scene.state.find((entry) => entry.name === output.source.name);
    if (state === undefined || state.type !== output.type) {
      diagnostics.push(broken(`${field}.source`, `host output '${output.name}' must name scene state of type '${output.type}'.`));
    }
  }
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
      // The block holds the value params: a texture or sampler is a binding of its own.
      const missing = material.params.find(
        (param) => !material.resources.some((resource) => resource.name === param.name) && !found.root.members.some((member) => member.name === param.name),
      );
      if (missing !== undefined) {
        diagnostics.push(broken(`${field}.params`, `material '${material.id}' has the param '${missing.name}', which its layout '${found.id}' lacks.`));
        return;
      }
    }
    const badResource = material.resources.find(
      (resource, position) =>
        resource.binding !== position + 1 ||
        material.params.find((param) => param.name === resource.name)?.type !== resource.kind,
    );
    if (badResource !== undefined) {
      diagnostics.push(
        broken(
          `${field}.resources`,
          `material '${material.id}' lists the ${badResource.kind} '${badResource.name}' at binding ${String(badResource.binding)}, which is not a ${badResource.kind} param bound in declaration order from binding 1.`,
        ),
      );
      return;
    }
    materials.push({ id: material.id, index, layout, shader, params: material.params, resources: material.resources });
  });
  const materialById = new Map(materials.map((material) => [material.id, material]));

  const assetsByUrl = new Map(manifest.assets.map((asset) => [asset.url, asset]));

  /** The texture and sampler bindings of one material instance (or prefab material), or undefined (reported). */
  function resolveResources(
    field: string,
    owner: string,
    material: ResolvedMaterial,
    params: readonly MtekInstanceParam[],
  ): ResolvedInstanceResource[] | undefined {
    const resources: ResolvedInstanceResource[] = [];
    for (const resource of material.resources) {
      const param = params.find((candidate) => candidate.name === resource.name);
      if (param?.class !== "resource") {
        diagnostics.push(broken(field, `${owner} gives the ${resource.kind} param '${resource.name}' no resource value.`));
        return undefined;
      }
      if (param.value.kind === "asset") {
        const image = assetsByUrl.get(param.value.asset);
        if (resource.kind !== "texture" || image?.kind !== "image") {
          diagnostics.push(
            broken(field, `the ${resource.kind} param '${resource.name}' of ${owner} names '${param.value.asset}', which is not an image of the assets table.`),
          );
          return undefined;
        }
        resources.push({ name: resource.name, kind: "texture", binding: resource.binding, value: image.url, asset: image });
        continue;
      }
      if (!param.value.name.startsWith(`${resource.kind}.`)) {
        diagnostics.push(broken(field, `the ${resource.kind} param '${resource.name}' of ${owner} holds '${param.value.name}'.`));
        return undefined;
      }
      resources.push({ name: resource.name, kind: resource.kind, binding: resource.binding, value: param.value.name });
    }
    return resources;
  }

  const meshes: ResolvedMesh[] = [];
  manifest.meshes.forEach((mesh, index) => {
    if (mesh.kind === "asset") {
      const field = `meshes[${String(index)}]`;
      const file = assetsByUrl.get(mesh.asset);
      if (file?.kind !== "mesh-data") {
        diagnostics.push(broken(`${field}.asset`, `mesh '${mesh.id}' names '${mesh.asset}', which the assets table lacks or which is not mesh data.`));
        return;
      }
      const layout = file.primitives[mesh.primitive];
      if (layout === undefined) {
        diagnostics.push(broken(`${field}.primitive`, `mesh '${mesh.id}' names primitive ${String(mesh.primitive)} of '${mesh.asset}', which has ${String(file.primitives.length)}.`));
        return;
      }
      const problem = regionProblem(layout, file.bytes);
      if (problem !== undefined) {
        diagnostics.push(broken(`${field}`, `mesh '${mesh.id}' (primitive ${String(mesh.primitive)} of '${mesh.asset}') cannot be read: ${problem}.`));
        return;
      }
      if (mesh.skin !== undefined) {
        const problem = skinProblem(mesh.skin, layout.vertexCount);
        if (problem !== undefined) { diagnostics.push(broken(field, problem)); return; }
      }
      meshes.push({ id: mesh.id, descriptor: { kind: "asset", asset: mesh.asset, primitive: mesh.primitive, layout, ...(mesh.skin === undefined ? {} : { skin: mesh.skin }) } });
      return;
    }
    meshes.push({ id: mesh.id, descriptor: mesh });
  });
  const meshById = new Map(meshes.map((mesh) => [mesh.id, mesh]));
  // The skeletons that `clips_from` entities take their clips from (decision 0223).
  const clipSources: (MtekSkin | undefined)[] = [];
  (manifest.clipSources ?? []).forEach((skin, index) => {
    const problem = skinProblem(skin, skin.indices.length);
    if (problem !== undefined) diagnostics.push(broken(`clipSources[${String(index)}]`, problem));
    else clipSources[index] = skin;
  });
  const clipSource = (field: string, owner: string, index: number | undefined): MtekSkin | null | undefined => {
    if (index === undefined) return null;
    const source = clipSources[index];
    if (source === undefined && (manifest.clipSources ?? [])[index] === undefined) {
      diagnostics.push(broken(`${field}.clipsFrom`, `${owner} takes clips from clipSources[${String(index)}], which the manifest lacks.`));
    }
    return source;
  };

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
    const resources = resolveResources(`${field}.params`, `material instance ${String(index)}`, material, instance.params);
    if (resources === undefined) return;
    instances[index] = { index, material, entity: instance.entity, shareable: instance.shareable, resources };
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
    // The compiler proved that an asset mesh has every attribute its material reads (E7010); the runtime does not trust that blindly.
    const source = mesh?.descriptor;
    if (source?.kind === "asset" && instance !== null) {
      const missing = instance.material.shader.vertexAttributes.find((attribute) => attribute !== "tangent" && !source.layout.attributes.includes(attribute));
      if (missing !== undefined) {
        diagnostics.push(
          broken(
            field,
            `entity '${entity.name}' draws the mesh '${mesh?.id ?? ""}' with material '${instance.material.id}', which reads '${missing}'; primitive ${String(source.primitive)} of '${source.asset}' has [${source.layout.attributes.join(", ")}].`,
          ),
        );
        return;
      }
    }
    const clipsFrom = clipSource(field, `entity '${entity.name}'`, entity.clipsFrom);
    if (clipsFrom === undefined) return;
    entities.push({
      index,
      name: entity.name,
      symbol: entity.symbol,
      parent: entity.parent,
      mesh,
      instance,
      ...(entity.particles === undefined ? {} : { particles: entity.particles }),
      ...(entity.clip === undefined ? {} : { clip: entity.clip }),
      ...(clipsFrom === null ? {} : { clipsFrom }),
    });
  });

  const lightsNode = frameLayout?.root.members.find((member) => member.name === "lights")?.node;
  const lightCapacity = lightsNode?.kind === "array" ? lightsNode.length : 0;
  if (frameLayout !== undefined && lightsNode?.kind !== "array") {
    diagnostics.push(broken("layouts", `the member 'lights' of the built-in layout '${FRAME_LAYOUT_ID}' is not an array.`));
  }
  const lights: ResolvedLight[] = [];
  if (scene.lights.length > lightCapacity) {
    diagnostics.push(
      broken("scene.lights", `the scene declares ${String(scene.lights.length)} lights, but the frame block holds ${String(lightCapacity)}.`),
    );
  } else {
    scene.lights.forEach((light, index) => {
      const field = `scene.lights[${String(index)}]`;
      if (light.index !== index) {
        diagnostics.push(broken(`${field}.index`, `light ${String(index)} carries index ${String(light.index)}.`));
        return;
      }
      const carrier = scene.entities[light.entity];
      if (carrier?.light !== index) {
        diagnostics.push(broken(`${field}.entity`, `light ${String(index)} names entity ${String(light.entity)}, which does not carry it.`));
        return;
      }
      lights.push({ index, entity: light.entity, kind: light.kind, range: light.kind === "point" ? light.range : 0 });
    });
    scene.entities.forEach((entity, index) => {
      if (entity.light !== null && scene.lights[entity.light]?.entity !== index) {
        diagnostics.push(
          broken(`scene.entities[${String(index)}].light`, `entity '${entity.name}' names light ${String(entity.light)}, which another entity carries.`),
        );
      }
    });
  }

  const prefabs: ResolvedPrefab[] = [];
  const prefabSymbols = new Set<string>();
  (manifest.prefabs ?? []).forEach((prefab, index) => {
    const field = `prefabs[${String(index)}]`;
    if (prefabSymbols.has(prefab.symbol)) {
      diagnostics.push(broken(`${field}.symbol`, `the prefab '${prefab.symbol}' is listed twice.`));
      return;
    }
    prefabSymbols.add(prefab.symbol);
    let mesh: ResolvedMesh | null = null;
    if (prefab.mesh !== null) {
      const found = meshById.get(prefab.mesh);
      if (found === undefined) {
        if (!manifest.meshes.some((candidate) => candidate.id === prefab.mesh)) {
          diagnostics.push(broken(`${field}.mesh`, `prefab '${prefab.name}' names the unknown mesh '${prefab.mesh}'.`));
        }
        return;
      }
      mesh = found;
    }
    let material: ResolvedPrefabMaterial | null = null;
    if (prefab.material !== null) {
      const resolved = materialById.get(prefab.material.id);
      if (resolved === undefined) {
        if (!manifest.materials.some((candidate) => candidate.id === prefab.material?.id)) {
          diagnostics.push(broken(`${field}.material`, `prefab '${prefab.name}' names the unknown material '${prefab.material.id}'.`));
        }
        return;
      }
      const declared = new Set(resolved.params.map((param) => param.name));
      const given = prefab.material.params.map((param) => param.name);
      if (given.length !== declared.size || given.some((name) => !declared.has(name))) {
        diagnostics.push(
          broken(`${field}.material.params`, `prefab '${prefab.name}' lists the material params [${given.join(", ")}], not those of '${resolved.id}'.`),
        );
        return;
      }
      const resources = resolveResources(`${field}.material.params`, `prefab '${prefab.name}'`, resolved, prefab.material.params);
      if (resources === undefined) return;
      material = { material: resolved, params: prefab.material.params, shareable: prefab.material.shareable, resources };
    }
    if ((mesh === null) !== (material === null)) {
      diagnostics.push(broken(field, `prefab '${prefab.name}' has a mesh without a material or a material without a mesh.`));
      return;
    }
    const source = mesh?.descriptor;
    if (source?.kind === "asset" && material !== null) {
      const missing = material.material.shader.vertexAttributes.find((attribute) => attribute !== "tangent" && !source.layout.attributes.includes(attribute));
      if (missing !== undefined) {
        diagnostics.push(
          broken(field, `prefab '${prefab.name}' draws the mesh '${mesh?.id ?? ""}' with material '${material.material.id}', which reads '${missing}'; primitive ${String(source.primitive)} of '${source.asset}' has [${source.layout.attributes.join(", ")}].`),
        );
        return;
      }
    }
    // Entity 0 of a prefab's bindings is the instance and material instance 0 its material; a prefab has no camera or light.
    for (const [position, binding] of prefab.bindings.entries()) {
      const at = `${field}.bindings[${String(position)}]`;
      const target = binding.target;
      const problem =
        binding.id !== position
          ? `carries id ${String(binding.id)}`
          : (target.kind === "transform" || target.kind === "visible" || target.kind === "bounds") && target.entity !== 0
            ? `targets entity ${String(target.entity)}, but a prefab binds only its instance (entity 0)`
            : target.kind === "param" && (target.instance !== 0 || material === null)
              ? "targets a material instance the prefab does not have"
              : target.kind === "camera" || target.kind === "light"
                ? `targets a ${target.kind}, which a prefab cannot bind`
                : undefined;
      if (problem !== undefined) diagnostics.push(broken(at, `binding ${String(position)} of prefab '${prefab.name}' ${problem}.`));
    }
    for (const param of prefab.material?.params ?? []) {
      if (param.class === "bound" && prefab.bindings[param.binding] === undefined) {
        diagnostics.push(broken(`${field}.material.params`, `the param '${param.name}' of prefab '${prefab.name}' names the missing binding ${String(param.binding)}.`));
      }
    }
    const clipsFrom = clipSource(field, `prefab '${prefab.name}'`, prefab.clipsFrom);
    if (clipsFrom === undefined) return;
    prefabs.push({
      symbol: prefab.symbol,
      name: prefab.name,
      index,
      params: prefab.params,
      mesh,
      material,
      body: prefab.body,
      collider: prefab.collider,
      state: prefab.state,
      update: prefab.update,
      fixedUpdate: prefab.fixedUpdate,
      bindings: prefab.bindings,
      span: prefab.span,
      ...(prefab.tag === undefined ? {} : { tag: prefab.tag }),
      ...(prefab.particles === undefined ? {} : { particles: prefab.particles }),
      ...(prefab.clip === undefined ? {} : { clip: prefab.clip }),
      ...(clipsFrom === null ? {} : { clipsFrom }),
    });
  });

  if (diagnostics.length > 0 || frameLayout === undefined || objectLayout === undefined || camera === undefined) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    structure: { frameLayout, objectLayout, camera, entities, materials, instances, meshes, lights, lightCapacity, prefabs },
  };
}
