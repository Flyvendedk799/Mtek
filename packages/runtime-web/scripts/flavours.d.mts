import type { BuildOptions } from "esbuild";

export type Flavour = "release" | "dev" | "min";

export declare const FLAVOURS: Readonly<Record<Flavour, { readonly outfile: string; readonly dev: boolean; readonly minify?: boolean }>>;

export declare function bundleOptions(flavour: Flavour, extra?: BuildOptions): BuildOptions;
