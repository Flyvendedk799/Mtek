# 0206: Omit comments from shipped runtime declarations

Status: accepted, 2026-10-26.

The maintained `packages/runtime-web/src/runtime.d.ts` remains annotated and
self-contained. It is still the npm SDK's types entry. Runtime builds use the
TypeScript printer with `removeComments` to write the compiled-app declaration
in `dist/runtime.d.ts`. They do not remove types, names, overloads or exports.
There is no extra runtime module or dependency in the output.

Every Mtek application carries these declarations. Removing repeated prose from
that artifact makes room for the position attachment feature within existing
folder/ZIP limits while retaining SDK documentation at its original source. The
compiler embeds and packages the distributed declaration as before; prebuilt
provenance records its exact bytes. No package budget, API or ABI version changes.

The declaration test compares the complete TypeScript syntax trees, including
modifiers, operators, identifiers and literal values, and independently compiles
the distributed file with strict DOM-only definitions. Existing host snippets and
mutual implementation-type checks remain. This replaces the earlier byte-copy
assertion with an API-preservation contract. Comment removal is a distribution
size change, not a runtime execution performance claim.
