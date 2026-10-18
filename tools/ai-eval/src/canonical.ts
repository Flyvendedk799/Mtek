// Canonical JSON and hashing. Records and prompt hashes must be a pure function of their content, so
// keys are sorted by their UTF-16 code units, nothing is indented and numbers must be finite.
import { createHash } from "node:crypto";

/** A JSON value; `undefined` members of objects are left out, as `JSON.stringify` does. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

export function canonicalJson(value: Json | undefined): string {
  if (value === undefined) throw new Error("canonicalJson: undefined is not a JSON value");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`canonicalJson: ${String(value)} is not a JSON number`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

/** The lowercase hex SHA-256 of the UTF-8 bytes of `text`. */
export function sha256Hex(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}
