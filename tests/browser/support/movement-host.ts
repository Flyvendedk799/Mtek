// Decision 0218: the host API of decision 0217 (`app.physics`), asked from the page about the running example.
import type { Vec3 } from "./movement-drive.ts";

export type RayResult = { entityId: string; distance: number; point: Vec3; normal: Vec3 } | null;

export interface HostApiResult {
  ids: Record<string, string>;
  hasPhysics: boolean;
  /** Straight down from above the floor, away from the character. */
  rayFloor: RayResult;
  /** Straight down from above the character. */
  rayPlayer: RayResult;
  /** The same ray with the character excluded. */
  rayExcluded: RayResult;
  /** Along +x at 0.3 m height, in the ledge's lane, towards the ledge's front face. */
  rayLedge: RayResult;
  /** A ray that hits nothing. */
  rayMiss: RayResult;
  castFloor: { entityId: string; fraction: number; point: Vec3; normal: Vec3 } | null;
  contacts: Array<{ entityId: string | null; point: Vec3; normal: Vec3; distance: number }>;
  /** The floor's groups set to 2/2: what a query with groups 1/1, 2/2 and none sees, and 1/1 again after restoring. */
  groups: { before: RayResult; withOne: RayResult; withTwo: RayResult; withNone: RayResult; afterRestore: RayResult };
  /** What the API threw for bad input: the call, the error's name and message. */
  errors: Array<{ call: string; name: string; message: string }>;
  diagnostics: Array<{ code: string; severity: string; message: string }>;
  disposed: Record<string, number>;
  stateAfter: string;
}

/**
 * The page side: mounts the example, lets the character settle at the start and asks the physics API. It runs in the
 * page, so it must not refer to anything outside its own body.
 */
export async function hostApi(args: { target: { width: number; height: number }; settleFrames: number; dt: number; idNames: readonly string[] }): Promise<HostApiResult> {
  interface P3 {
    x: number;
    y: number;
    z: number;
  }
  interface Physics {
    castRay(origin: P3, direction: P3, maxDistance: number, options?: object): { entityId: string; distance: number; point: P3; normal: P3 } | undefined;
    castShape(shape: object, pose: { position: P3 }, displacement: P3, options?: object): { entityId: string; fraction: number; point: P3; normal: P3 } | undefined;
    contacts(entityId: string): ReadonlyArray<{ entityId: string | null; point: P3; normal: P3; distance: number }>;
    setCollisionGroups(entityId: string, memberships: number, filter: number): void;
  }
  interface AppLike {
    state: string;
    physics: Physics | undefined;
    debug: { step(frames: number, dt: number): void; counters(): Record<string, number> };
    dispose(): void;
  }
  const w = window as unknown as { __mtekMount: (options: object) => Promise<AppLike> };
  const diagnostics: Array<{ code: string; severity: string; message: string }> = [];
  let context: { readTransforms(): Array<{ id: string; name: string }> } | undefined;
  const app = await w.__mtekMount({
    test: { manualClock: true, renderTarget: args.target },
    onDiagnostic: (d: { code: string; severity: string; message: string }) => diagnostics.push({ code: d.code, severity: d.severity, message: d.message }),
    extensions: [{ id: "movement-ids", apiVersion: 1, setup(c: typeof context) { context = c; } }],
  });
  app.debug.step(args.settleFrames, args.dt);
  const ids: Record<string, string> = {};
  for (const transform of context?.readTransforms() ?? []) if (args.idNames.includes(transform.name)) ids[transform.name] = transform.id;
  const physics = app.physics;
  const errors: Array<{ call: string; name: string; message: string }> = [];
  const ray = (origin: P3, direction: P3, max: number, options?: object): RayResult => {
    const hit = physics?.castRay(origin, direction, max, options);
    return hit === undefined ? null : { entityId: hit.entityId, distance: hit.distance, point: { ...hit.point }, normal: { ...hit.normal } };
  };
  const down = { x: 0, y: -1, z: 0 };
  const above = { x: -6, y: 5, z: 3 };
  const rayFloor = ray(above, down, 20);
  const rayPlayer = ray({ x: -6, y: 5, z: 0 }, down, 20);
  const rayExcluded = ray({ x: -6, y: 5, z: 0 }, down, 20, { exclude: ids["Player"] });
  const rayLedge = ray({ x: 0, y: 0.3, z: -3 }, { x: 1, y: 0, z: 0 }, 20);
  const rayMiss = ray({ x: -6, y: 5, z: 3 }, { x: 0, y: 1, z: 0 }, 20);
  const shape = physics?.castShape({ kind: "sphere", radius: 0.5 }, { position: above }, { x: 0, y: -10, z: 0 });
  const castFloor = shape === undefined ? null : { entityId: shape.entityId, fraction: shape.fraction, point: { ...shape.point }, normal: { ...shape.normal } };
  const playerId = ids["Player"] ?? "";
  const contacts = (physics?.contacts(playerId) ?? []).map((c) => ({ entityId: c.entityId, point: { ...c.point }, normal: { ...c.normal }, distance: c.distance }));

  const before = ray(above, down, 20);
  physics?.setCollisionGroups(ids["Ground"] ?? "", 2, 2);
  const withOne = ray(above, down, 20, { groups: { memberships: 1, filter: 1 } });
  const withTwo = ray(above, down, 20, { groups: { memberships: 2, filter: 2 } });
  const withNone = ray(above, down, 20);
  physics?.setCollisionGroups(ids["Ground"] ?? "", 0xffff, 0xffff);
  const afterRestore = ray(above, down, 20, { groups: { memberships: 1, filter: 1 } });

  const attempt = (call: string, run: () => void): void => {
    try {
      run();
    } catch (error) {
      const e = error as Error;
      errors.push({ call, name: e.name, message: e.message });
    }
  };
  attempt("castRay with a zero direction", () => physics?.castRay(above, { x: 0, y: 0, z: 0 }, 5));
  attempt("castRay excluding a number", () => physics?.castRay(above, down, 5, { exclude: 7 }));
  attempt("contacts of an unknown entity", () => physics?.contacts("scene:0:nothing"));
  attempt("setCollisionGroups out of range", () => physics?.setCollisionGroups(playerId, 70000, 1));

  const stateAfter = app.state;
  app.dispose();
  return {
    ids,
    hasPhysics: physics !== undefined,
    rayFloor,
    rayPlayer,
    rayExcluded,
    rayLedge,
    rayMiss,
    castFloor,
    contacts,
    groups: { before, withOne, withTwo, withNone, afterRestore },
    errors,
    diagnostics,
    disposed: { ...app.debug.counters() },
    stateAfter,
  };
}
