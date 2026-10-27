import {createAnimationController, type ExtensionContext} from "@mtek/runtime-web";
import {describe, expect, it, vi} from "vitest";
import {INSPECTOR_METRICS_SERVICE, InspectorController} from "../src/index.js";
import {entity, fixture, skin} from "./fixture.js";
import type {SceneInspection} from "@mtek/runtime-web";

describe("public inspector extension", () => {
  it("samples spatial data only for observers and keeps panel polling independent", () => {
    const f = fixture({interval:10}), matrix = [1,0,0,0,0,1,0,0,0,0,1,0,1,2,3,1];
    let spatial: SceneInspection = {frame:1,renderable:true,viewport:{width:100,height:100},viewProjection:matrix,entities:[{id:entity().id,parentId:null,worldMatrix:matrix}],bodies:[]};
    const inspect = vi.fn(() => spatial); f.context.inspectScene = inspect;
    const detach = f.mount(); f.inspector.select(entity().id); expect(inspect).not.toHaveBeenCalled();
    const observer = vi.fn(), remove = f.inspector.subscribeSpatial(observer), reads = f.read.mock.calls.length;
    expect(inspect).toHaveBeenCalledTimes(1); matrix[12] = 99;
    expect(f.inspector.spatialSnapshot().scene!.entities[0]!.worldMatrix[12]).toBe(1);
    expect(() => Object.assign(f.inspector.spatialSnapshot().scene!.entities[0]!.worldMatrix,{12:8})).toThrow();
    f.step(.1); expect(inspect).toHaveBeenCalledTimes(2); expect(f.read).toHaveBeenCalledTimes(reads);
    spatial = {...spatial,entities:[{id:"scene:2:Actor",parentId:null,worldMatrix:matrix}]}; f.setEntities([entity("scene:2:Actor")]);
    f.step(.1); expect(f.inspector.spatialSnapshot().selectedId).toBeNull();
    remove(); f.step(.1); expect(inspect).toHaveBeenCalledTimes(3);
    detach?.(); expect(f.inspector.spatialSnapshot().status).toBe("detached");
  });
  it("isolates unavailable/failing spatial providers and cannot resurrect a disposed controller", () => {
    const onError = vi.fn(), f = fixture({onError}); f.mount();
    const remove = f.inspector.subscribeSpatial(() => {}); expect(f.inspector.spatialSnapshot().scene).toBeNull();
    f.context.inspectScene = () => {throw new Error("adapter contact read failed");};
    f.step(); expect(f.inspector.spatialSnapshot().error).toMatch(/contact read/); expect(f.inspector.snapshot().status).toBe("ready"); expect(onError).toHaveBeenCalled();
    f.context.inspectScene = () => {f.inspector.dispose(); return undefined;};
    f.step(); expect(f.inspector.spatialSnapshot().status).toBe("disposed"); remove();
  });
  it("isolates snapshots and applies copied batches only before the next frame", () => {
    const f = fixture(); f.mount(); f.setEntities([entity(),entity("scene:1:Other")]); f.inspector.refresh();
    const updates = [{id:entity().id, position:{x:3,y:2,z:1}},{id:"scene:1:Other", scale:{x:2,y:2,z:2}}];
    f.inspector.edit(updates); updates[0]!.position!.x = 99;
    expect(f.write).not.toHaveBeenCalled(); expect(f.inspector.snapshot().pending).toBe(1);
    f.step(); expect(f.context.readTransforms()[0]!.position.x).toBe(3); expect(f.context.readTransforms()[1]!.scale.x).toBe(2);
    expect(() => {(f.inspector.snapshot().entities[0]!.position as {x:number}).x = 5;}).toThrow();
  });
  it("copies and freezes authored local bounds in inspection snapshots", () => {
    const f = fixture(), bounds = {center:{x:-10,y:1,z:0},radius:.87};
    f.mount(); f.setEntities([{...entity(),bounds}]); f.inspector.refresh(); bounds.center.x = 99;
    expect(f.inspector.snapshot().entities[0]!.bounds).toEqual({center:{x:-10,y:1,z:0},radius:.87});
    expect(() => {Object.assign(f.inspector.snapshot().entities[0]!.bounds!.center,{x:2});}).toThrow();
  });
  it("undoes only edited fields, keeps normalized rotations and bounds history", () => {
    const f = fixture({historyLimit:2}); f.mount();
    f.inspector.edit([{id:entity().id, position:{x:1,y:0,z:0},rotation:{x:0,y:0,z:0,w:2}}]); f.step();
    f.inspector.edit([{id:entity().id, position:{x:2,y:0,z:0}}]); f.step();
    f.inspector.edit([{id:entity().id, position:{x:3,y:0,z:0}}]); f.step();
    f.setEntities([{...f.context.readTransforms()[0]!,scale:{x:4,y:4,z:4}}]);
    f.inspector.undo(); f.step(); expect(f.context.readTransforms()[0]!.position.x).toBe(2); expect(f.context.readTransforms()[0]!.scale.x).toBe(4);
    f.inspector.undo(); f.step(); expect(f.inspector.snapshot().canUndo).toBe(false); expect(f.context.readTransforms()[0]!.rotation.w).toBe(1);
    f.inspector.redo(); f.step(); expect(f.context.readTransforms()[0]!.position.x).toBe(2);
  });
  it("rejects malformed edits and prevents partial writes when an ID becomes stale", () => {
    const f = fixture(); f.mount(); f.inspector.select(entity().id);
    for (const value of [0,-1,NaN,Infinity]) expect(() => f.inspector.edit([{id:entity().id,scale:{x:value,y:1,z:1}}])).toThrow();
    expect(() => f.inspector.edit([{id:entity().id},{id:entity().id}])).toThrow();
    f.inspector.edit([{id:entity().id,position:{x:7,y:0,z:0}},{id:"missing",position:{x:8,y:0,z:0}}]); f.step();
    expect(f.write).not.toHaveBeenCalled(); expect(f.inspector.snapshot().error).toMatch(/stale/); expect(f.inspector.snapshot().status).toBe("ready");
    f.inspector.edit([{id:entity().id,position:{x:1,y:0,z:0}}]); f.step();
    f.setEntities([entity("scene:2:Actor")]); f.inspector.refresh();
    expect(f.inspector.snapshot().selectedId).toBeNull(); expect(f.inspector.snapshot().canUndo).toBe(false);
  });
  it("captures animation command targets when queued and controls actual public players", () => {
    const f = fixture(); f.setEntities([entity(),entity("scene:1:Other")]); const player = createAnimationController(skin,{clip:"Idle"}).player;
    f.players.set(entity().id,player); f.players.set("scene:1:Other",createAnimationController(skin,{clip:"Idle"}).player); f.mount(); f.inspector.select(entity().id);
    f.inspector.pauseAnimation(); f.inspector.select("scene:1:Other"); f.step();
    expect(player.clock.playing(0)).toBe(false); expect(f.players.get("scene:1:Other")!.clock.playing(0)).toBe(true);
    f.inspector.select(entity().id); f.inspector.selectClip("Run",0); f.step(); f.inspector.seek(1); f.step();
    expect(f.inspector.snapshot().animation?.time).toBe(1); expect(f.inspector.snapshot().animation?.duration).toBe(2);
    expect(f.inspector.snapshot().animation?.joints[1]!.position.x).toBeCloseTo(2);
    f.inspector.selectClip("missing"); f.step(); expect(f.inspector.snapshot().error).toMatch(/Unknown clip/);
  });
  it("inspects and scrubs locomotion without disabling the blend and detaches explicitly", () => {
    const f = fixture(), controller = createAnimationController(skin); controller.setLocomotion({samples:[{clip:"Idle",threshold:0},{clip:"Run",threshold:1}],parameter:0.5});
    f.players.set(entity().id,controller.player); f.mount(); f.inspector.select(entity().id);
    const duration = controller.player.locomotion.duration; f.inspector.seek(duration/2); f.inspector.pauseAnimation(); f.step();
    expect(controller.player.locomotion.active).toBe(true); expect(controller.player.locomotion.phase).toBeCloseTo(.5); expect(controller.player.locomotion.playing).toBe(false);
    f.inspector.resumeAnimation(); f.step(); expect(controller.player.locomotion.playing).toBe(true);
    f.inspector.detachAnimation(); f.step(); expect(f.detach).toHaveBeenCalledWith(entity().id);
  });
  it("throttles idle observation, handles services and isolates observer failures", () => {
    const onError = vi.fn(), f = fixture({interval:1,onError}); f.mount(); f.inspector.subscribe(() => {throw new Error("observer failed");});
    f.services.set(INSPECTOR_METRICS_SERVICE,{read:()=>({liveBuffers:3,cpuUpdateMs:0.25})});
    f.read.mockClear(); for (let i=0;i<9;i++) f.step(.1); expect(f.read).not.toHaveBeenCalled();
    f.step(.2); expect(f.inspector.snapshot().metrics).toEqual({liveBuffers:3,cpuUpdateMs:.25}); expect(onError).toHaveBeenCalled();
    f.services.set(INSPECTOR_METRICS_SERVICE,{read:()=>({liveBuffers:NaN})}); f.inspector.refresh(); expect(f.inspector.snapshot().metrics).toBeNull();
    f.services.set(INSPECTOR_METRICS_SERVICE,{read:()=>({})}); f.inspector.refresh(); expect(f.inspector.snapshot().metrics).toBeNull();
  });
  it("cleans up on rollback/unmount, supports remount and rejects unsupported contexts", () => {
    const f = fixture(), cleanup = f.mount(); expect(() => f.mount()).toThrow(/already mounted/);
    f.inspector.edit([{id:entity().id,position:{x:5,y:0,z:0}}]); if (typeof cleanup === "function") {cleanup();cleanup();}
    expect(f.inspector.snapshot().status).toBe("detached"); expect(f.inspector.snapshot().pending).toBe(0); expect(() => f.inspector.refresh()).toThrow(/detached/);
    f.mount(); expect(f.inspector.snapshot().status).toBe("ready"); f.inspector.dispose(); f.inspector.dispose(); f.step(); expect(() => f.mount()).toThrow(/disposed/);
    const inspector = new InspectorController(); expect(() => inspector.extension.setup({...f.context,apiVersion:2} as unknown as ExtensionContext)).toThrow(/API 1/);
  });
  it("stops applying a drained command queue when an observer disposes the inspector", () => {
    const f = fixture(); f.mount();
    f.inspector.edit([{id:entity().id,position:{x:1,y:0,z:0}}]); f.inspector.edit([{id:entity().id,position:{x:2,y:0,z:0}}]);
    f.inspector.subscribe(() => {if (f.context.readTransforms()[0]!.position.x === 1) f.inspector.dispose();});
    f.step(); expect(f.inspector.snapshot().status).toBe("disposed"); expect(f.write).toHaveBeenCalledTimes(1); expect(f.context.readTransforms()[0]!.position.x).toBe(1);
  });
});
