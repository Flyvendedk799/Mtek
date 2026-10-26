import type {Engine} from "./layout.ts";
import type {Configuration,AnimationApp} from "./types.ts";
import {createMtek} from "./mtek-adapter.ts";
import {createThree} from "./three-adapter.ts";
export type {Configuration,AnimationApp} from "./types.ts";
export function create(engine:Engine,configuration:Configuration):Promise<AnimationApp>{return engine==="mtek"?createMtek(configuration):createThree(configuration);}
