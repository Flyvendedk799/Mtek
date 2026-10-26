import { describe, expect, it } from "vitest";
import { animatedSkin } from "../test-support/animated-skin.js";
import { AnimationPlayers } from "./skeleton.js";

describe("explicit crowd pose cohorts", () => {
  it("advances shared clocks once and schedules using the closest member", () => {
    const players = new AnimationPlayers(), skin = animatedSkin();
    for (let i = 0; i < 50; i++) players.addSkin(i,skin,"walk");
    expect(players.share(0,Array.from({length:49},(_,i)=>i+1))).toBe(true);
    const rig = players.skin(0)!;
    rig.setUpdatePolicy([{distance:0,interval:0},{distance:10,interval:0.5}]);
    players.advance(0.1,()=>undefined,slot=>slot===49?1:100);
    expect(rig.clock.time(0)).toBeCloseTo(0.1);
    expect(rig.jointPosition("root").x).toBeCloseTo(0.2);
    expect(players.share(0,[1,2])).toBe(false);
    players.remove(0); players.advance(0.1,()=>undefined);
    expect(players.skin(49)!.clock.time(0)).toBeCloseTo(0.2);
  });
  it("validates whole batches before sharing and detaches an independent held pose", () => {
    const players = new AnimationPlayers(), skin = animatedSkin();
    players.addSkin(0,skin,"walk"); players.addSkin(1,skin,"walk");
    players.advance(0.3,()=>undefined);
    const original = players.skin(1)!;
    expect(()=>players.share(0,[1,99])).toThrow(/identical/);
    expect(players.skin(1)).toBe(original);
    players.share(0,[1]);
    const shared = players.skin(1)!;
    const independent = players.detach(1);
    expect(independent.pose).toEqual(shared.pose);
    players.advance(0.2,()=>undefined);
    expect(independent.jointPosition("root").x).toBeCloseTo(0.6);
    expect(shared.jointPosition("root").x).toBeCloseTo(1);
    independent.transition("action",0.5,true,1);
    expect(players.skin(0)).not.toBe(independent);
  });
});
