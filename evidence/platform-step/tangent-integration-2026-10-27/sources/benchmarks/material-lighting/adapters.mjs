// Separate lazy chunks keep the unused renderer out of each measured page.
export const createMtek=(...args)=>import("./mtek.mjs").then(module=>module.createMtek(...args));
export const createThree=(...args)=>import("./three.mjs").then(module=>module.createThree(...args));
