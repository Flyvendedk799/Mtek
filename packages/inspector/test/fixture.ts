import {createAnimationController, type AnimationPlayer, type ExtensionContext, type MtekSkin, type SceneTransform, type TransformUpdate} from "@mtek/runtime-web";
import {vi} from "vitest";
import {InspectorController} from "../src/index.js";

const matrix = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export const skin: MtekSkin = {
  meshNode: 0,
  nodes: [
    {name: "Root", parent: -1, translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1]},
    {name: "Hand", parent: 0, translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1]},
  ],
  joints: [0,1], inverseBind: [matrix,matrix], indices: [[0,1,0,0]], weights: [[1,0,0,0]],
  clips: [
    {name: "Idle", duration: 1, channels: [{node: 1, path: "translation", interpolation: "linear", times: [0,1], values: [0,0,0,2,0,0]}]},
    {name: "Run", duration: 2, channels: [{node: 1, path: "translation", interpolation: "linear", times: [0,2], values: [0,0,0,4,0,0]}]},
  ],
};
export const entity = (id = "scene:1:Actor"): SceneTransform => ({id, name: "Actor", position: {x:0,y:0,z:0}, rotation: {x:0,y:0,z:0,w:1}, scale: {x:1,y:1,z:1}, visible: true});
export function fixture(options: ConstructorParameters<typeof InspectorController>[0] = {}) {
  let entities: readonly SceneTransform[] = [entity()];
  const players = new Map<string, AnimationPlayer>(), services = new Map<string, unknown>();
  const read = vi.fn(() => entities.map(row => structuredClone(row)));
  const write = vi.fn((updates: readonly TransformUpdate[]) => {
    for (const update of updates) if (!entities.some(row => row.id === update.id)) throw new RangeError("stale ID");
    entities = entities.map(row => {
      const update = updates.find(update => update.id === row.id); if (update === undefined) return row;
      const q = update.rotation, length = q === undefined ? 1 : Math.hypot(q.x,q.y,q.z,q.w);
      return {...row, ...update, rotation: q === undefined ? row.rotation : {x:q.x/length,y:q.y/length,z:q.z/length,w:q.w/length}};
    });
  });
  const detach = vi.fn((id: string) => {const player = createAnimationController(skin,{clip:"Idle"}).player; players.set(id, player); return player;});
  const context: ExtensionContext = {
    apiVersion: 1, readTransforms: read, writeTransforms: write,
    animation(id) {if (!entities.some(row => row.id === id)) throw new RangeError("stale ID"); return players.get(id);},
    shareAnimation(source, targets) {for (const id of targets) players.set(id, players.get(source)!);},
    detachAnimation: detach,
    service<T>(name: string) {return services.get(name) as T | undefined;},
  };
  const inspector = new InspectorController(options);
  const step = (dt = 0): void => {inspector.extension.beforeFrame?.(context,dt); for (const player of new Set(players.values())) player.advance(dt); inspector.extension.afterFrame?.(context,dt);};
  return {inspector, context, read, write, detach, players, services, step, mount: () => inspector.extension.setup(context), setEntities: (next: readonly SceneTransform[]) => {entities = next;}};
}
