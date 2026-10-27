import { describe, expect, it } from "vitest";
import ts from "typescript";
import { compactDeclarations } from "../scripts/declarations.mjs";

describe("shipped declaration compaction", () => {
  it("preserves template contents, token boundaries and declaration ASI", () => {
    const source = [
      'export interface A { readonly label: "two words"; value: { x: number } }',
      'export type B<T extends string> = `prefix ${T} suffix\n  keep indentation`;',
      'export type C = { [K in keyof A]?: A[K] };',
      'export declare class D { get value(): A; set value(v: A); method<T>(x: T): T; }',
      'export declare function f(a: -1, b: "escaped\\" quote"): void;',
    ].join("\n");
    const compact = compactDeclarations(source);
    expect(compact).toContain('"two words"');
    expect(compact).toContain('suffix\n  keep indentation');
    const parse = (text: string): ts.SourceFile => ts.createSourceFile("types.d.ts", text, ts.ScriptTarget.ES2022, true);
    const printer = ts.createPrinter({ removeComments: true });
    expect(printer.printFile(parse(compact))).toBe(printer.printFile(parse(source)));
    expect(compactDeclarations(compact)).toBe(compact);
  });
  it("refuses invalid declarations instead of shipping a damaged surface", () => {
    expect(() => compactDeclarations("export interface Broken {")).toThrow(/Invalid/);
  });
});
