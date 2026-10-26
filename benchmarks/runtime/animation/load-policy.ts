import {waitForQuiet} from "../tools/host-load.ts";

type QuietWindow=Awaited<ReturnType<typeof waitForQuiet>>;
/** Wait before measuring; keep the existing limits and account for every wait. */
export async function waitForCleanWindow(
  notify:()=>void,
  sample:()=>Promise<QuietWindow>=()=>waitForQuiet(30,10000),
):Promise<QuietWindow>{
  let waitedForQuietMs=0;
  for(;;){
    const observation=await sample();waitedForQuietMs+=observation.waitedForQuietMs;
    if(!observation.noisy)return {...observation,waitedForQuietMs};
    notify();
  }
}
