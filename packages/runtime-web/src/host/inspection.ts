import type { Vec3, Quat } from "../math/types.js";
import type { ColliderDesc, PhysicsContact } from "../physics/types.js";

export interface SceneRenderBounds {
  readonly source: "authored" | "compute" | "animated" | "mesh" | "unbounded";
  /** Null when the shader is unbounded or no current animated enclosure was computed. */
  readonly sphere: { readonly center: Vec3; readonly radius: number } | null;
  readonly culled: boolean;
}
export interface SceneSpatialEntity {
  readonly id: string;
  readonly parentId: string | null;
  /** Last propagated column-major matrix, including ancestors and node animation. */
  readonly worldMatrix: readonly number[];
  readonly bounds?: SceneRenderBounds;
}
export interface ScenePhysicsBody {
  readonly entityId: string;
  readonly kind: "static" | "kinematic" | "dynamic";
  readonly active: boolean;
  /** Actual physics shape: mesh/entity scale is deliberately not applied a second time. */
  readonly collider: ColliderDesc;
  readonly position: Vec3;
  readonly rotation: Quat;
  /** Undefined when the adapter does not expose contacts. */
  readonly contacts?: readonly { readonly otherId: string | null; readonly point: Vec3; readonly normal: Vec3; readonly distance: number }[];
}
export interface SceneInspection {
  readonly frame: number | null;
  readonly renderable: boolean;
  readonly viewport: { readonly width: number; readonly height: number };
  /** WebGPU clip coordinates, with z in [0,w], from the last rendered frame. */
  readonly viewProjection: readonly number[];
  readonly entities: readonly SceneSpatialEntity[];
  readonly bodies: readonly ScenePhysicsBody[];
}

/** Internal slot identities are replaced with opaque generation-bearing IDs at the host boundary. */
export interface BodyInspection extends Omit<ScenePhysicsBody, "entityId" | "contacts"> {
  readonly slot: number;
  readonly generation: number;
  readonly contacts?: readonly PhysicsContact[];
}
export interface RenderInspection extends Omit<SceneInspection, "entities" | "bodies"> {
  readonly bounds: readonly { readonly slot: number; readonly value: SceneRenderBounds }[];
}
