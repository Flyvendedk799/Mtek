// `@implementation` is an esbuild alias (tools/prepare.ts): the bundle of a workload and an implementation points it at
// that implementation's `create` function.
declare module "@implementation" {
  import type { Create } from "./types.ts";
  export const create: Create;
}
