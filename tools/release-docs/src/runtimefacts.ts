// What the web runtime (`packages/runtime-web`) implements, read from the runtime itself.
//
// * The constants of the ABI are imported from `src/abi/constants.ts` (a module with no imports).
// * The key codes are imported from `src/input/keys.ts` (the same).
// * The host input codecs are *probed*: `decodeHostInput` is called with every codec id the manifest
//   schema allows; a codec the runtime does not implement falls out of its `switch` and answers
//   `undefined` instead of a decoding result.
// * The event names and the body handle are read from the source text of the two modules that define
//   them, because both modules import half the runtime and cannot be loaded by a plain `node`.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readText } from "./spectext.ts";

export interface RuntimeFacts {
  manifestSchema: number;
  runtimeAbi: number;
  languageVersion: string;
  /** `RUNTIME_ABI` exported by the core entry (`src/core.ts`, re-exported by the package entry `src/index.ts`), read as text. */
  indexRuntimeAbi: number | null;
  /** `readonly abi: N` of `src/runtime.d.ts`, the declarations a program is typed against. */
  declaredAbi: string | undefined;
  keyCodes: string[];
  /** Codec ids the runtime decodes (answers a result for). */
  implementedCodecs: string[];
  inputEvents: string[];
  collisionEvents: string[];
  entityEvents: string[];
  /** Public members of the body handle, in the snake_case of the registry (`apply_impulse`, `linear_velocity`). */
  bodyHandleMembers: string[];
}

export function snakeCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function stringList(text: string, constant: string, file: string): string[] {
  const m = new RegExp(`export const ${constant} = \\[([^\\]]*)\\]`).exec(text);
  if (m === null) throw new Error(`${file}: no "export const ${constant} = [...]"`);
  return [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1] ?? "");
}

/** The public members of `class BodyHandleImpl` of the physics system, snake_case. */
export function bodyHandleMembers(systemTs: string): string[] {
  const start = systemTs.indexOf("class BodyHandleImpl");
  if (start < 0) throw new Error("packages/runtime-web/src/physics/system.ts: no class BodyHandleImpl");
  const rest = systemTs.slice(start);
  const end = rest.indexOf("\n}\n");
  const body = end < 0 ? rest : rest.slice(0, end);
  const members: string[] = [];
  for (const line of body.split("\n")) {
    const method = /^ {2}(?!private|constructor|readonly)([a-z][A-Za-z0-9]*)\(/.exec(line);
    if (method !== null) members.push(snakeCase(method[1] ?? ""));
    const getter = /^ {2}get ([a-z][A-Za-z0-9]*)\(/.exec(line);
    if (getter !== null) members.push(snakeCase(getter[1] ?? ""));
  }
  return members;
}

type Decode = (codec: string, value: unknown) => unknown;

/** The codec ids among `ids` for which `decode` answers a result. */
export function implementedCodecs(decode: Decode, ids: readonly string[]): string[] {
  return ids.filter((id) => {
    try {
      return decode(id, undefined) !== undefined;
    } catch {
      return false;
    }
  });
}

export async function readRuntimeFacts(root: string, codecIds: readonly string[]): Promise<RuntimeFacts> {
  const runtime = join(root, "packages", "runtime-web", "src");
  const load = async <T>(file: string): Promise<T> => (await import(pathToFileURL(join(runtime, file)).href)) as T;
  const constants = await load<{ SUPPORTED_MANIFEST_SCHEMA: number; SUPPORTED_RUNTIME_ABI: number; SUPPORTED_LANGUAGE_VERSION: string }>(
    "abi/constants.ts",
  );
  const keys = await load<{ MAPPED_KEY_CODES: readonly string[] }>("input/keys.ts");
  const codecs = await load<{ decodeHostInput: Decode }>("host/codecs.ts");
  const indexText = readText(root, "packages/runtime-web/src/core.ts");
  const abi = /export const RUNTIME_ABI = (\d+);/.exec(indexText)?.[1];
  const dynamic = readText(root, "packages/runtime-web/src/scene/dynamic.ts");
  return {
    manifestSchema: constants.SUPPORTED_MANIFEST_SCHEMA,
    runtimeAbi: constants.SUPPORTED_RUNTIME_ABI,
    languageVersion: constants.SUPPORTED_LANGUAGE_VERSION,
    indexRuntimeAbi: abi === undefined ? null : Number(abi),
    declaredAbi: /readonly abi: (\d+);/.exec(readText(root, "packages/runtime-web/src/runtime.d.ts"))?.[1],
    keyCodes: [...keys.MAPPED_KEY_CODES],
    implementedCodecs: implementedCodecs(codecs.decodeHostInput, codecIds),
    inputEvents: stringList(dynamic, "INPUT_EVENTS", "packages/runtime-web/src/scene/dynamic.ts"),
    collisionEvents: stringList(dynamic, "COLLISION_EVENTS", "packages/runtime-web/src/scene/dynamic.ts"),
    entityEvents: stringList(dynamic, "ENTITY_EVENTS", "packages/runtime-web/src/scene/dynamic.ts"),
    bodyHandleMembers: bodyHandleMembers(readText(root, "packages/runtime-web/src/physics/system.ts")),
  };
}
