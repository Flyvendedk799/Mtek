import ts from "typescript";

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const parse = text => ts.createSourceFile("runtime.d.ts", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

/** Strip declaration trivia without merging lexical tokens or changing the parsed declarations. */
export function compactDeclarations(source) {
  const original = parse(source), text = printer.printFile(original), file = parse(text);
  if (original.parseDiagnostics.length || file.parseDiagnostics.length) throw new Error("Invalid runtime declarations");
  const templates = new Map();
  const visit = node => {
    if (ts.isTemplateLiteralTypeNode(node)) { templates.set(node.getStart(file), node.end); return; }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const scanner = ts.createScanner(ts.ScriptTarget.ES2022, true, ts.LanguageVariant.Standard, text);
  const pair = ts.createScanner(ts.ScriptTarget.ES2022, true);
  let output = "", previous, opaque = false;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const end = templates.get(scanner.getTokenPos());
    const token = end === undefined ? scanner.getTokenText() : text.slice(scanner.getTokenPos(), end);
    let space = opaque || end !== undefined;
    if (previous !== undefined && !space) {
      pair.setText(previous.text + token);
      space = pair.scan() !== previous.kind || pair.getTokenText() !== previous.text || pair.scan() !== kind || pair.getTokenText() !== token || pair.scan() !== ts.SyntaxKind.EndOfFileToken;
    }
    output += (output !== "" && space ? " " : "") + token;
    previous = { kind, text: token }; opaque = end !== undefined;
    if (end !== undefined) scanner.setTextPos(end);
  }
  const compact = parse(output);
  // Reprinting compares the complete syntax tree, including literal contents and ASI boundaries.
  if (compact.parseDiagnostics.length || printer.printFile(compact) !== text) throw new Error("Compacting runtime declarations changed their syntax");
  return output + "\n";
}
