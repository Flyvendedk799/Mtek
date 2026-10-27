import ts from "typescript";

/** Pool immutable diagnostic values only. Do not touch code, property names, directives or schema data. */
export function poolStandaloneDiagnosticStrings(code: string): string {
  const source = ts.createSourceFile("validator.js", code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const strings = new Map<string, ts.StringLiteral[]>(), names = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) names.add(node.text);
    if (ts.isStringLiteral(node) && ts.isPropertyAssignment(node.parent) && node.parent.initializer === node
      && (ts.isIdentifier(node.parent.name) || ts.isStringLiteral(node.parent.name))
      && ["message", "schemaPath", "keyword"].includes(node.parent.name.text)) {
      const uses = strings.get(node.text) ?? []; uses.push(node); strings.set(node.text, uses);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const edits: { start: number; end: number; text: string }[] = [], declarations: string[] = [];
  let next = 0;
  for (const [value, uses] of strings) {
    // Conservative estimate using a four-byte minified identifier, including its declaration.
    if (uses.length < 3 || (JSON.stringify(value).length - 4) * uses.length < JSON.stringify(value).length + 20) continue;
    let name: string;
    do { name = `_mtekDiagnosticString${next++}`; } while (names.has(name));
    names.add(name); declarations.push(`${name}=${JSON.stringify(value)}`);
    for (const node of uses) edits.push({ start: node.getStart(source), end: node.end, text: name });
  }
  if (declarations.length === 0) return code;
  let insertion = 0;
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    insertion = statement.end;
  }
  edits.push({ start: insertion, end: insertion, text: `\nconst ${declarations.join(",")};\n` });
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  return code;
}
