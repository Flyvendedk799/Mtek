import type { BuildOptions } from "esbuild";

export type Flavour = "release" | "dev";

export declare const FLAVOURS: Readonly<Record<Flavour, { readonly outfile: string; readonly dev: boolean }>>;

export declare function bundleOptions(flavour: Flavour, extra?: BuildOptions): BuildOptions;
