import {hardwareLaunchArgs,softwareLaunchArgs} from "../../tests/browser/support/launch-args.ts";

// Both native presentation and offscreen readback use the declared sRGB output
// profile. Do not fit a transform to an engine or alter the OS monitor profile.
export const materialLaunchArgs=backend=>[...(backend==="hardware"?hardwareLaunchArgs():softwareLaunchArgs()),"--force-color-profile=srgb"];
