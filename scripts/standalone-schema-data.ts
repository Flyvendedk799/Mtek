/** Ajv retains whole schema objects for reads such as schemaN.properties.x.enum.
 * Keep exactly the statically read subtrees. Unknown/dynamic/bare uses keep the
 * complete original object; validation code and error expressions are untouched. */
import ts from "typescript";

export function compactStandaloneSchemaData(code: string): string {
  const source = ts.createSourceFile("validator.js", code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const constants = new Map<string, { declaration: ts.VariableDeclaration; value: unknown; paths: string[][]; complete: boolean }>();
  function find(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^schema\d+$/.test(node.name.text) && node.initializer !== undefined) {
      try { constants.set(node.name.text, { declaration: node, value: JSON.parse(node.initializer.getText(source)), paths: [], complete: false }); }
      catch { /* Non-JSON schema constants remain unchanged. */ }
    }
    ts.forEachChild(node, find);
  }
  find(source);
  function reads(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      const constant = constants.get(node.text);
      if (constant !== undefined && node !== constant.declaration.name) {
        let expression: ts.Node = node;
        const path: string[] = [];
        while (true) {
          const parent: ts.Node = expression.parent;
          if (ts.isPropertyAccessExpression(parent) && parent.expression === expression) {
            path.push(parent.name.text); expression = parent;
          } else if (ts.isElementAccessExpression(parent) && parent.expression === expression) {
            const key = parent.argumentExpression;
            if (!ts.isStringLiteral(key) && !ts.isNumericLiteral(key)) { constant.complete = true; break; }
            path.push(key.text); expression = parent;
          } else break;
        }
        if (path.length === 0) constant.complete = true;
        else constant.paths.push(path);
      }
    }
    ts.forEachChild(node, reads);
  }
  reads(source);
  function project(value: unknown, paths: readonly string[][]): unknown {
    // Arrays and primitive leaves are data. Retain them whole, including enum
    // order/identity and object-valued const/enum entries.
    if (paths.some((path) => path.length === 0) || typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const object = value as Record<string, unknown>;
    const groups = new Map<string, string[][]>();
    for (const [key, ...tail] of paths) {
      if (key === undefined || !Object.hasOwn(object, key)) throw new Error("unknown schema data path");
      const group = groups.get(key) ?? []; group.push(tail); groups.set(key, group);
    }
    return Object.fromEntries([...groups].map(([key, group]) => [key, project(object[key], group)]));
  }
  const edits: { start: number; end: number; text: string }[] = [];
  for (const constant of constants.values()) {
    if (constant.complete || constant.paths.length === 0) continue;
    try {
      const initializer = constant.declaration.initializer!;
      edits.push({ start: initializer.getStart(source), end: initializer.end, text: JSON.stringify(project(constant.value, constant.paths)) });
    } catch { /* An unfamiliar generated access keeps the full constant. */ }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  return code;
}
