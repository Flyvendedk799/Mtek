// A strict parser for the subset of TOML 1.0 that benchmark files use (task.toml and the
// mtek-tests/*.test.toml fixtures). Dependency-free on purpose: the validator must run from a bare
// Node install (decision 0018).
//
// Supported: comments, bare and quoted keys, `[table]` headers (one level or dotted), basic and
// multi-line basic strings with the usual escapes, single-line literal strings, decimal integers and
// floats, booleans, arrays (multi-line, trailing comma allowed) and single-line inline tables.
// Everything else (dates, hexadecimal, `[[arrays of tables]]`, dotted keys, multi-line literal
// strings, `inf`/`nan`, digit separators) is a parse error that names the line, so a fixture can
// never be half-understood.

/**
 * @typedef {string | number | boolean | TomlArray | TomlTable} TomlValue
 * @typedef {TomlValue[]} TomlArray
 * @typedef {{ [key: string]: TomlValue }} TomlTable
 */

export class TomlError extends Error {
  /**
   * @param {string} message
   * @param {number} line 1-based line of the problem
   */
  constructor(message, line) {
    super(`line ${String(line)}: ${message}`);
    this.name = "TomlError";
    this.line = line;
  }
}

/** @param {string} ch one character or "" @returns {string} */
function show(ch) {
  if (ch === "") return "the end of input";
  if (ch === "\n") return "a line break";
  if (ch === "\r") return "a carriage return";
  return `'${ch}'`;
}

const BARE_KEY = /^[A-Za-z0-9_-]+/;
const NUMBER = /^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/;
const SIMPLE_ESCAPES = /** @type {Record<string, string>} */ ({
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
});

/** @returns {TomlTable} a table without a prototype, so keys such as `__proto__` are plain data */
function newTable() {
  /** @type {TomlTable} */
  const table = {};
  Object.setPrototypeOf(table, null);
  return table;
}

class Parser {
  /** @param {string} source */
  constructor(source) {
    // CRLF is read as LF; a lone CR is rejected below.
    this.text = source.replace(/\r\n/g, "\n");
    this.pos = 0;
    this.line = 1;
  }

  /** @param {string} message @returns {TomlError} */
  fail(message) {
    return new TomlError(message, this.line);
  }

  /** @returns {string} the current character, or "" at the end of input */
  peek() {
    return this.text.charAt(this.pos);
  }

  /** @param {string} prefix */
  startsWith(prefix) {
    return this.text.startsWith(prefix, this.pos);
  }

  /** Consumes one character, tracking line numbers. @returns {string} */
  next() {
    const ch = this.text.charAt(this.pos);
    this.pos += 1;
    if (ch === "\n") this.line += 1;
    if (ch === "\r") throw this.fail("a carriage return outside a CRLF line ending");
    return ch;
  }

  skipSpaces() {
    while (this.peek() === " " || this.peek() === "\t") this.next();
  }

  skipComment() {
    if (this.peek() !== "#") return;
    while (this.peek() !== "\n" && this.peek() !== "") this.next();
  }

  /** Skips spaces, comments and newlines (between statements and inside arrays). */
  skipBlank() {
    for (;;) {
      this.skipSpaces();
      this.skipComment();
      if (this.peek() === "\n") this.next();
      else return;
    }
  }

  /** After a statement: only spaces and a comment may remain on the line. */
  endOfLine() {
    this.skipSpaces();
    this.skipComment();
    if (this.peek() === "\n") this.next();
    else if (this.peek() !== "") throw this.fail(`unexpected ${show(this.peek())} after a value`);
  }

  /** @returns {TomlTable} */
  parseDocument() {
    const root = newTable();
    /** @type {TomlTable} */
    let current = root;
    /** @type {Set<TomlTable>} */
    const closed = new Set();
    for (;;) {
      this.skipBlank();
      if (this.peek() === "") return root;
      if (this.startsWith("[[")) throw this.fail("arrays of tables ([[...]]) are not supported");
      if (this.peek() === "[") {
        current = this.parseTableHeader(root, closed);
        this.endOfLine();
        continue;
      }
      const key = this.parseKey();
      this.skipSpaces();
      if (this.peek() === ".") throw this.fail("dotted keys are not supported");
      if (this.peek() !== "=") throw this.fail(`expected '=' after key '${key}'`);
      this.next();
      this.skipSpaces();
      if (key in current) throw this.fail(`duplicate key '${key}'`);
      current[key] = this.parseValue();
      this.endOfLine();
    }
  }

  /**
   * @param {TomlTable} root
   * @param {Set<TomlTable>} closed tables that were already defined by a header
   * @returns {TomlTable}
   */
  parseTableHeader(root, closed) {
    this.next(); // [
    this.skipSpaces();
    /** @type {string[]} */
    const path = [this.parseKey()];
    this.skipSpaces();
    while (this.peek() === ".") {
      this.next();
      this.skipSpaces();
      path.push(this.parseKey());
      this.skipSpaces();
    }
    if (this.peek() !== "]") throw this.fail("expected ']' to close the table header");
    this.next();
    let table = root;
    for (const [index, segment] of path.entries()) {
      const existing = table[segment];
      if (existing === undefined) {
        const created = newTable();
        table[segment] = created;
        table = created;
      } else if (typeof existing === "object" && !Array.isArray(existing)) {
        table = existing;
      } else {
        throw this.fail(`'${segment}' is already defined as a value, not a table`);
      }
      if (index === path.length - 1) {
        if (closed.has(table)) throw this.fail(`table [${path.join(".")}] is defined twice`);
        closed.add(table);
      }
    }
    return table;
  }

  /** @returns {string} */
  parseKey() {
    if (this.peek() === '"') return this.parseBasicString();
    if (this.peek() === "'") return this.parseLiteralString();
    const match = BARE_KEY.exec(this.text.slice(this.pos, this.pos + 256));
    if (match === null) throw this.fail(`expected a key, found ${show(this.peek())}`);
    this.pos += match[0].length;
    return match[0];
  }

  /** @returns {TomlValue} */
  parseValue() {
    const ch = this.peek();
    if (ch === '"') return this.startsWith('"""') ? this.parseMultilineString() : this.parseBasicString();
    if (ch === "'") {
      if (this.startsWith("'''")) throw this.fail("multi-line literal strings are not supported");
      return this.parseLiteralString();
    }
    if (ch === "[") return this.parseArray();
    if (ch === "{") return this.parseInlineTable();
    if (this.startsWith("true") && !/[A-Za-z0-9_-]/.test(this.text.charAt(this.pos + 4))) {
      this.pos += 4;
      return true;
    }
    if (this.startsWith("false") && !/[A-Za-z0-9_-]/.test(this.text.charAt(this.pos + 5))) {
      this.pos += 5;
      return false;
    }
    const match = NUMBER.exec(this.text.slice(this.pos, this.pos + 64));
    if (match !== null) {
      const after = this.text.charAt(this.pos + match[0].length);
      if (/[A-Za-z0-9_:.-]/.test(after)) {
        throw this.fail(`unsupported number or date syntax near '${match[0]}${after}'`);
      }
      this.pos += match[0].length;
      return Number(match[0]);
    }
    throw this.fail(`expected a value, found ${show(ch)}`);
  }

  /** @returns {string} */
  parseBasicString() {
    this.next(); // opening quote
    let out = "";
    for (;;) {
      const ch = this.peek();
      if (ch === "" || ch === "\n") throw this.fail("unterminated string");
      if (ch === '"') {
        this.next();
        return out;
      }
      if (ch === "\\") out += this.parseEscape();
      else out += this.plainChar();
    }
  }

  /** @returns {string} */
  parseLiteralString() {
    this.next(); // opening quote
    let out = "";
    for (;;) {
      const ch = this.peek();
      if (ch === "" || ch === "\n") throw this.fail("unterminated string");
      if (ch === "'") {
        this.next();
        return out;
      }
      out += this.plainChar();
    }
  }

  /** Reads one non-escape character of a string; control characters are not allowed. @returns {string} */
  plainChar() {
    const ch = this.next();
    const code = ch.charCodeAt(0);
    if ((code < 0x20 && ch !== "\t" && ch !== "\n") || code === 0x7f) {
      throw this.fail(`control character U+${code.toString(16).padStart(4, "0")} in a string`);
    }
    return ch;
  }

  /** @returns {string} */
  parseMultilineString() {
    this.pos += 3;
    if (this.peek() === "\n") this.next(); // a newline right after the opening quotes is dropped
    let out = "";
    for (;;) {
      if (this.peek() === "") throw this.fail("unterminated multi-line string");
      if (this.startsWith('"""')) {
        // Up to two further quotes directly before the closing delimiter belong to the string.
        let extra = 0;
        while (extra < 2 && this.text.charAt(this.pos + 3 + extra) === '"') extra += 1;
        out += '"'.repeat(extra);
        this.pos += 3 + extra;
        return out;
      }
      if (this.peek() === "\\") {
        const save = this.pos;
        this.next();
        // "line ending backslash": the backslash, the newline and all following whitespace vanish
        let probe = this.pos;
        while (this.text.charAt(probe) === " " || this.text.charAt(probe) === "\t") probe += 1;
        if (this.text.charAt(probe) === "\n") {
          while (/[ \t\n]/.test(this.peek())) this.next();
          continue;
        }
        this.pos = save;
        out += this.parseEscape();
      } else {
        out += this.plainChar();
      }
    }
  }

  /** Reads `\x` at the current position. @returns {string} */
  parseEscape() {
    this.next(); // backslash
    const ch = this.next();
    const simple = SIMPLE_ESCAPES[ch];
    if (simple !== undefined) return simple;
    if (ch === "u" || ch === "U") {
      const length = ch === "u" ? 4 : 8;
      const digits = this.text.slice(this.pos, this.pos + length);
      if (!new RegExp(`^[0-9A-Fa-f]{${String(length)}}$`).test(digits)) {
        throw this.fail(`invalid \\${ch} escape`);
      }
      const code = Number.parseInt(digits, 16);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        throw this.fail(`\\${ch}${digits} is not a Unicode scalar value`);
      }
      this.pos += length;
      return String.fromCodePoint(code);
    }
    throw this.fail(`unknown escape '\\${ch}'`);
  }

  /** @returns {TomlValue[]} */
  parseArray() {
    this.next(); // [
    /** @type {TomlValue[]} */
    const items = [];
    for (;;) {
      this.skipBlank();
      if (this.peek() === "]") {
        this.next();
        return items;
      }
      items.push(this.parseValue());
      this.skipBlank();
      if (this.peek() === ",") this.next();
      else if (this.peek() !== "]") throw this.fail("expected ',' or ']' in an array");
    }
  }

  /** @returns {TomlTable} */
  parseInlineTable() {
    this.next(); // {
    const table = newTable();
    this.skipSpaces();
    if (this.peek() === "}") {
      this.next();
      return table;
    }
    for (;;) {
      this.skipSpaces();
      if (this.peek() === "\n") throw this.fail("inline tables must be on a single line");
      const key = this.parseKey();
      this.skipSpaces();
      if (this.peek() !== "=") throw this.fail(`expected '=' after key '${key}'`);
      this.next();
      this.skipSpaces();
      if (key in table) throw this.fail(`duplicate key '${key}'`);
      table[key] = this.parseValue();
      this.skipSpaces();
      if (this.peek() === ",") {
        this.next();
        continue;
      }
      if (this.peek() === "}") {
        this.next();
        return table;
      }
      throw this.fail("expected ',' or '}' in an inline table (inline tables are single-line)");
    }
  }
}

/**
 * @param {string} source TOML text
 * @returns {TomlTable}
 * @throws {TomlError} on any syntax this parser does not accept
 */
export function parseToml(source) {
  return new Parser(source).parseDocument();
}

/**
 * @param {TomlValue | undefined} value
 * @returns {value is TomlTable}
 */
export function isTable(value) {
  return typeof value === "object" && !Array.isArray(value);
}
