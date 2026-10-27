import {createHash} from "node:crypto";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {build} from "esbuild";
import {parseGlb,encodeGlb,addDemoClips,proportionVariant,writeRetargetedClips,footProfile} from "./glb.mjs";
const here=import.meta.dirname,repo=resolve(here,"../.."),digest=bytes=>createHash("sha256").update(bytes).digest("hex");
export async function prepareComposition(){
  const provenance=JSON.parse(await readFile(join(repo,"benchmarks/runtime/animation/assets/provenance.json"),"utf8")),expected=provenance.models.find(m=>m.model==="CesiumMan").files["CesiumMan.glb"],original=await readFile(join(repo,"benchmarks/runtime/animation/assets/CesiumMan/CesiumMan.glb"));
  if(original.length!==expected.bytes||digest(original)!==expected.sha256)throw new Error("Pinned CesiumMan changed");
  const source=parseGlb(original);addDemoClips(source);const target=proportionVariant(source);
  const sourceBytes=encodeGlb(source),targetSeed=encodeGlb(target.glb),seedModels=join(here,"seed/models"),models=join(here,"scene/models");
  await mkdir(seedModels,{recursive:true});await mkdir(models,{recursive:true});await mkdir(join(here,".out"),{recursive:true});
  await writeFile(join(seedModels,"Source.glb"),sourceBytes);await writeFile(join(seedModels,"LongLegs.glb"),targetSeed);
  const cli=join(repo,"target/debug",process.platform==="win32"?"mtek.exe":"mtek");
  execFileSync(cli,["build","--mode","test","--out",join(here,".out/seed"),join(here,"seed")],{cwd:repo,stdio:"inherit",windowsHide:true});
  const seed=JSON.parse(await readFile(join(here,".out/seed/program.manifest.json"),"utf8")),skins=seed.meshes.filter(m=>m.kind==="asset").map(m=>m.skin),sourceSkin=skins.find(s=>s.nodes.some(n=>n.name==="Skeleton_torso_joint_1"&&Math.abs(n.translation[2]-.6789999)<.001)),targetSkin=skins.find(s=>s!==sourceSkin);
  if(!sourceSkin||!targetSkin)throw new Error("Cannot identify compiled source/target bind frames");
  const {retargetSkin}=await import(new URL("../../packages/runtime-web/dist/runtime.js",import.meta.url));
  // This derivative changes lengths, not bind axes. Preserve original animated scales,
  // including bounded float32 exporter noise, and explicitly validate the named mapping.
  for(const sourceNode of sourceSkin.nodes){const targetNode=targetSkin.nodes.find(n=>n.name===sourceNode.name);if(!targetNode||sourceNode.rotation.some((v,i)=>Math.abs(v-targetNode.rotation[i])>1e-7))throw new Error("Proportion derivative changed bind axes");}
  const mapping=Object.fromEntries(sourceSkin.nodes.map(n=>[n.name,n.name])),retargeted=retargetSkin(sourceSkin,targetSkin,mapping,{rotationSpace:"world",translationScale:1,nodeTranslationScales:target.multipliers});
  writeRetargetedClips(target.glb,retargeted);const targetBytes=encodeGlb(target.glb);
  await writeFile(join(models,"Source.glb"),sourceBytes);await writeFile(join(models,"LongLegs.glb"),targetBytes);
  execFileSync(cli,["build","--mode","test","--out",join(here,".out/scene"),join(here,"scene")],{cwd:repo,stdio:"inherit",windowsHide:true});
  const footProfiles={Original:footProfile(source),Longer:footProfile(target.glb)};
  await writeFile(join(here,".out/scene/foot-profiles.json"),JSON.stringify(footProfiles,null,2)+"\n");
  const record={format:"mtek-character-composition-assets/1",original:{commit:provenance.commit,...expected},source:{sha256:digest(sourceBytes),bytes:sourceBytes.length,clips:sourceSkin.clips.map(c=>c.name)},target:{sha256:digest(targetBytes),bytes:targetBytes.length,legs:1.2,arms:.9,rootLift:.108,maximumBindDisplacement:target.maximumDisplacement},retarget:{api:1,rotationSpace:"world",bindAxes:"validated unchanged",mapping,nodeTranslationScales:target.multipliers,scaleRoundOff:"Original animated scale keys retained; bounded float32 input guard under decision 0209."}};
  record.footProfiles=footProfiles;
  execFileSync(process.execPath,["scripts/build.mjs"],{cwd:join(repo,"packages/inspector"),stdio:"inherit",windowsHide:true});
  await build({entryPoints:[join(here,"main.ts")],outfile:join(here,"composition.js"),bundle:true,format:"esm",platform:"browser",target:"es2022"});
  await writeFile(join(here,".out/derivation.json"),JSON.stringify(record,null,2)+"\n");return record;
}
if(process.argv[1]&&resolve(process.argv[1])===join(here,"prepare.mjs"))await prepareComposition();
