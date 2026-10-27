import type { BuildOptions } from "esbuild";

export type Flavour = "release" | "dev" | "min" | "full" | "animation" | "animationMin";

export declare const FLAVOURS: Readonly<
  Record<Flavour, { readonly entry: string; readonly outfile: string; readonly dev: boolean; readonly minify?: boolean; readonly module?: boolean }>
>;

export declare function bundleOptions(flavour: Flavour, extra?: BuildOptions): BuildOptions;
