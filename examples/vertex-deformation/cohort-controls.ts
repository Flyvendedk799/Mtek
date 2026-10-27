import type {ExtensionContext,SceneTransform} from "@mtek/runtime-web";
export const cohortActors=(context:ExtensionContext):readonly SceneTransform[]=>context.readTransforms().filter(e=>/^(Fox|Man)(Actor|Reference)$/.test(e.name));
/** Explicit shared-pose groups; independent actors are sampled at the same per-group phases. */
export function sampleCohorts(context:ExtensionContext,groups:number,share:boolean):readonly SceneTransform[]{
  const actors=cohortActors(context);
  if(!Number.isInteger(groups)||groups<1||groups>actors.length)throw new RangeError("Invalid pose group count");
  for(let group=0;group<groups;group++){
    const members=actors.filter((_,i)=>i%groups===group);
    for(const entity of members){
      const player=context.animation(entity.id)!;
      const clip=player.skin.clips.find(clip=>clip.name==="Walk")??player.skin.clips[0]!;
      if(!player.transition(clip.name,0,true,1))throw new Error("Clip unavailable");
      player.clock.seek(0,clip.duration*(.17+group*.13));player.clock.pause(0);player.evaluate();
    }
    if(share)context.shareAnimation(members[0]!.id,members.slice(1).map(e=>e.id));
  }
  return actors;
}
