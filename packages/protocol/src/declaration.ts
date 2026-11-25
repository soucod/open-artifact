/**
 * The inline declaration of a frame type, read without running it: a type's `index.html` carries a block that starts
 * with the line comment `// artifact.json` and declares, with `var`, `let` or `const`, the names `key`, `capabilities`
 * and `monitoring` as literal data:
 *
 * ```js
 * // artifact.json
 * var key = "notes";
 * var capabilities = { db: {}, downloads: {} };
 * var monitoring = {};
 * // the page's own code follows
 * ```
 *
 * The block runs from the marker to the next line that starts with a `// ` comment (or 64 KB): a full-line `// `
 * comment inside it ends it early, so comments within the block are `/* … *\/` or follow code on the same line.
 *
 * Only literals are read: strings (every escape), template literals without `${}`, numbers (with a sign), `true`,
 * `false`, `null`, `undefined`, `NaN`, `Infinity`, arrays without holes and objects with plain keys (trailing commas
 * allowed). Anything else (a call, a reference to another name, `${}`, a spread, a computed key, a method, a regular
 * expression, a BigInt) is refused with its line and column. Values come out as JSON would carry them.
 *
 * Platform neutral: no Node or DOM APIs.
 */

/** The marker comment that opens the block. */
export const DECLARATION_MARKER = '// artifact.json';

/** Whether `html` carries an inline declaration at all (the marker on a line of its own). */
export const DECLARATION_LINE = /(^|\n)[ \t]*\/\/ artifact\.json[ \t]*\r?\n/;

/** How far the block reaches when no line comment ends it. */
export const DECLARATION_MAX_CHARS = 64 * 1024;

/** The names the block declares that Open Artifact reads. */
export const DECLARATION_NAMES: readonly string[] = Object.freeze(['key', 'capabilities', 'monitoring']);

/** A capability's declared config: `true`, or an object of options. */
export type CapabilityDecl = boolean | Record<string, unknown>;

/** Where the block sits in the page. */
export interface DeclarationSource {
  /** The block's text, after the marker. */
  source: string;
  /** Offset of `source` in the page. */
  offset: number;
  /** Whether a line comment ends it (else it runs to the end of the page or 64 KB). */
  terminated: boolean;
}

/**
 * The block after the first `// artifact.json` in `html`, or null when there is none. Frame-host reads the same text.
 */
export function declarationSource(html: string): DeclarationSource | null {
  const at = html.indexOf(DECLARATION_MARKER);
  if (at < 0) return null;
  const from = at + DECLARATION_MARKER.length;
  const next = /\n[ \t]*\/\/ /g;
  next.lastIndex = from;
  const stop = next.exec(html);
  const end = stop ? stop.index : Math.min(html.length, from + DECLARATION_MAX_CHARS);
  return { source: html.slice(from, end), offset: from, terminated: !!stop && stop.index - from <= DECLARATION_MAX_CHARS };
}

/** A block that is not literal data: where, and why. */
export class DeclarationError extends Error {
  /** 1-based, in the text that was parsed (the page, for `readStaticDeclaration`). */
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'DeclarationError';
    this.line = line;
    this.column = column;
  }
}

/** One declared name and its value. */
export interface DeclaredBinding {
  name: string;
  kind: 'var' | 'let' | 'const';
  /** The value as JSON carries it; `undefined` when declared without one. */
  value: unknown;
  /** Whether the statement gives a value (`var x;` again keeps the earlier one). */
  initialized: boolean;
}

/**
 * Every `var|let|const name = literal` statement of `source`, in order, or a `DeclarationError`. A `var` may be
 * declared again (the last one wins, as in a script); `let` and `const` may not. `base` is the text before `source`,
 * for line and column numbers.
 */
export function parseLiteralDeclarations(source: string, base = ''): DeclaredBinding[] {
  return new Parser(source, base).program();
}

/** A page's declaration, read statically. */
export interface StaticDeclaration {
  /** The type key, when the block names one as a string. */
  key: string | null;
  /** cap → declared config (the block's `capabilities` object, or `{}`). */
  capabilities: Record<string, CapabilityDecl>;
  monitoring: Record<string, unknown>;
  /** Every name the block declares, in order (others than `key`, `capabilities`, `monitoring` are not read). */
  names: string[];
  /**
   * The names declared with `let` or `const`. Frame-host evaluates the block today and reads only `var` names (a
   * `let` or `const` is not a property of its context), so `types check` flags these.
   */
  lexical: string[];
  /** Whether a line comment ends the block. */
  terminated: boolean;
}

/**
 * The declaration in a page, read without running it: null when the page carries no marker, else the declaration or
 * a `DeclarationError` (thrown).
 */
export function readStaticDeclaration(html: string): StaticDeclaration | null {
  const found = declarationSource(html);
  if (!found) return null;
  let bindings: DeclaredBinding[];
  try {
    bindings = parseLiteralDeclarations(found.source, html.slice(0, found.offset));
  } catch (error) {
    if (error instanceof DeclarationError && !found.terminated) {
      throw new DeclarationError(
        `${error.message.replace(/ \(line \d+, column \d+\)$/, '')}; the block has no end: put a line comment (\`// …\`) on its own line after it`,
        error.line,
        error.column,
      );
    }
    throw error;
  }
  const values = new Map<string, unknown>();
  for (const b of bindings) if (b.initialized || !values.has(b.name)) values.set(b.name, b.value);
  const key = values.get('key');
  const capabilities = values.get('capabilities');
  const monitoring = values.get('monitoring');
  return {
    key: typeof key === 'string' ? key : null,
    capabilities: isObject(capabilities) ? (capabilities as Record<string, CapabilityDecl>) : {},
    monitoring: isObject(monitoring) ? monitoring : {},
    names: [...new Set(bindings.map((b) => b.name))],
    lexical: bindings.filter((b) => b.kind !== 'var').map((b) => b.name),
    terminated: found.terminated,
  };
}

/**
 * The text of a declaration block, from the marker to a closing line comment: the form `types new` and `types from`
 * write. String values never break out of a `<script>` (`<` is written `<`).
 */
export function renderDeclaration(decl: { key: string; capabilities?: Record<string, unknown>; monitoring?: Record<string, unknown> }, indent = ''): string {
  const literal = (v: unknown): string =>
    (JSON.stringify(v ?? {}, null, 2) ?? '{}')
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
      .split('\n')
      .join(`\n${indent}`);
  return [
    `${indent}${DECLARATION_MARKER}`,
    `${indent}var key = ${literal(decl.key)};`,
    `${indent}var capabilities = ${literal(decl.capabilities ?? {})};`,
    `${indent}var monitoring = ${literal(decl.monitoring ?? {})};`,
    `${indent}// end of artifact.json`,
  ].join('\n');
}

// ---- the parser -----------------------------------------------------------------------------------------------------

const ID_START = /[$_\p{ID_Start}]/u;
const ID_PART = /[$_‌‍\p{ID_Continue}]/u;
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;
const WHITESPACE = /[\t\v\f  ﻿\p{Zs}]/u;
/** Names that are plain values in an empty context. */
const VALUE_NAMES: Record<string, unknown> = { undefined: undefined, NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY };
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'let', 'static', 'yield', 'await',
]);

class Parser {
  private i = 0;
  private keyMode = false;
  private readonly src: string;
  private readonly baseLine: number;
  private readonly baseColumn: number;

  constructor(src: string, base: string) {
    this.src = src;
    const lines = base.split(/\r\n|[\n\r\u2028\u2029]/);
    this.baseLine = lines.length - 1;
    this.baseColumn = lines[lines.length - 1]!.length;
  }

  program(): DeclaredBinding[] {
    const out: DeclaredBinding[] = [];
    const lexical = new Set<string>();
    const vars = new Set<string>();
    for (;;) {
      this.skip();
      if (this.i >= this.src.length) return out;
      if (this.src[this.i] === ';') {
        this.i++;
        continue;
      }
      const at = this.i;
      const word = this.word();
      if (word !== 'var' && word !== 'let' && word !== 'const') {
        this.i = at;
        this.fail(word ? `Only var, let and const declarations of literal data belong here, not \`${word}\`` : `Unexpected ${this.describe()}`);
      }
      for (;;) {
        this.skip();
        const nameAt = this.i;
        const name = this.word();
        if (!name || RESERVED.has(name)) {
          this.i = nameAt;
          this.fail(`A name to declare is expected, not ${name ? `\`${name}\`` : this.describe()}`);
        }
        if (lexical.has(name) || (word !== 'var' && vars.has(name))) {
          this.i = nameAt;
          this.fail(`\`${name}\` is declared twice`);
        }
        (word === 'var' ? vars : lexical).add(name);
        this.skip();
        let value: unknown;
        let initialized = false;
        if (this.src[this.i] === '=' && this.src[this.i + 1] !== '=') {
          this.i++;
          value = this.value();
          initialized = true;
        } else if (word === 'const') {
          this.fail(`const ${name} needs a value`);
        }
        out.push({ name, kind: word, value: jsonValue(value), initialized });
        const sawNewline = this.skip();
        const c = this.src[this.i];
        if (c === ',') {
          this.i++;
          continue;
        }
        if (c === ';') {
          this.i++;
          break;
        }
        if (c === undefined || sawNewline) break;
        this.fail(`Unexpected ${this.describe()} after the value of ${name}`);
      }
    }
  }

  /** Skips whitespace and comments; whether a line ended on the way. */
  private skip(): boolean {
    let newline = false;
    const s = this.src;
    while (this.i < s.length) {
      const c = s[this.i]!;
      if (LINE_TERMINATOR.test(c)) {
        newline = true;
        this.i++;
      } else if (WHITESPACE.test(c)) {
        this.i++;
      } else if (c === '/' && s[this.i + 1] === '/') {
        while (this.i < s.length && !LINE_TERMINATOR.test(s[this.i]!)) this.i++;
      } else if (c === '/' && s[this.i + 1] === '*') {
        const end = s.indexOf('*/', this.i + 2);
        if (end < 0) this.fail('A comment is not closed');
        if (LINE_TERMINATOR.test(s.slice(this.i, end))) newline = true;
        this.i = end + 2;
      } else break;
    }
    return newline;
  }

  private word(): string {
    const s = this.src;
    const start = this.i;
    const first = s.codePointAt(this.i);
    if (first === undefined || !ID_START.test(String.fromCodePoint(first))) return '';
    this.i += first > 0xffff ? 2 : 1;
    for (;;) {
      const cp = s.codePointAt(this.i);
      if (cp === undefined || !ID_PART.test(String.fromCodePoint(cp))) break;
      this.i += cp > 0xffff ? 2 : 1;
    }
    if (s[this.i] === '\\') this.fail('Escapes in names are not read here');
    return s.slice(start, this.i);
  }

  private value(): unknown {
    this.skip();
    const s = this.src;
    const c = s[this.i];
    if (c === undefined) this.fail('A value is expected');
    if (c === '"' || c === "'") return this.string(c);
    if (c === '`') return this.template();
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '+' || c === '-') {
      this.i++;
      this.skip();
      const n = this.src[this.i];
      let v: number;
      if (n !== undefined && (/[0-9.]/.test(n))) v = this.number();
      else {
        const at = this.i;
        const w = this.word();
        if (w !== 'Infinity' && w !== 'NaN') {
          this.i = at;
          this.fail('A sign goes only before a number');
        }
        v = VALUE_NAMES[w] as number;
      }
      return c === '-' ? -v : v;
    }
    if (/[0-9.]/.test(c)) return this.number();
    const at = this.i;
    const w = this.word();
    if (w === 'true') return this.notFollowed(true);
    if (w === 'false') return this.notFollowed(false);
    if (w === 'null') return this.notFollowed(null);
    if (w in VALUE_NAMES) return this.notFollowed(VALUE_NAMES[w]);
    this.i = at;
    if (w) this.fail(`\`${w}\` is a reference to something else; only literal data is read here`);
    if (c === '/') this.fail('A regular expression is not literal data');
    if (c === '(') this.fail('Parentheses are not read here: write the literal itself');
    return this.fail(`Unexpected ${this.describe()}`);
  }

  /** A value that must not be called, indexed or combined with an operator. */
  private notFollowed<T>(v: T): T {
    if (!this.keyMode) this.peekEnd();
    return v;
  }

  /** After a value: only `,`, `;`, `}`, `]`, a newline or the end. */
  private peekEnd(): void {
    const save = this.i;
    const newline = this.skip();
    const c = this.src[this.i];
    this.i = save;
    if (c === undefined || c === ',' || c === ';' || c === '}' || c === ']' || c === ':') return;
    if (newline && !/[([.`+\-*/%=<>&|^?!]/.test(c)) return;
    this.skip();
    if (c === '(') this.fail('A call is not literal data');
    if (c === '.' || c === '[' || c === '?') this.fail('Member access is not literal data');
    if (c === '`') this.fail('A tagged template is not literal data');
    this.fail(`An expression (\`${c}\`) is not literal data`);
  }

  private string(quote: string): string {
    const s = this.src;
    this.i++;
    let out = '';
    for (;;) {
      if (this.i >= s.length) this.fail('A string is not closed');
      const c = s[this.i]!;
      if (c === quote) {
        this.i++;
        return this.notFollowed(out);
      }
      if (c === '\n' || c === '\r') this.fail('A string runs past the end of its line');
      if (c === '\\') {
        out += this.escape(false);
        continue;
      }
      out += c;
      this.i++;
    }
  }

  private template(): string {
    const s = this.src;
    this.i++;
    let out = '';
    for (;;) {
      if (this.i >= s.length) this.fail('A template literal is not closed');
      const c = s[this.i]!;
      if (c === '`') {
        this.i++;
        return this.notFollowed(out);
      }
      if (c === '$' && s[this.i + 1] === '{') this.fail('A template with ${…} is not literal data');
      if (c === '\\') {
        out += this.escape(true);
        continue;
      }
      if (c === '\r') {
        out += '\n';
        this.i += s[this.i + 1] === '\n' ? 2 : 1;
        continue;
      }
      out += c;
      this.i++;
    }
  }

  /** One escape sequence at `\`, as a string or template literal reads it. */
  private escape(template: boolean): string {
    const s = this.src;
    this.i++;
    const c = s[this.i];
    if (c === undefined) this.fail('An escape is not finished');
    this.i++;
    switch (c) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case '\r':
        if (s[this.i] === '\n') this.i++;
        return '';
      case '\n':
      case '\u2028':
      case '\u2029':
        return '';
      case 'x': {
        const hex = s.slice(this.i, this.i + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) this.fail('\\x needs two hex digits');
        this.i += 2;
        return String.fromCharCode(Number.parseInt(hex, 16));
      }
      case 'u': {
        if (s[this.i] === '{') {
          const end = s.indexOf('}', this.i);
          const hex = end < 0 ? '' : s.slice(this.i + 1, end);
          if (!/^[0-9a-fA-F]{1,6}$/.test(hex) || Number.parseInt(hex, 16) > 0x10ffff) this.fail('\\u{…} needs a code point');
          this.i = end + 1;
          return String.fromCodePoint(Number.parseInt(hex, 16));
        }
        const hex = s.slice(this.i, this.i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('\\u needs four hex digits');
        this.i += 4;
        return String.fromCharCode(Number.parseInt(hex, 16));
      }
      default:
        if (/[0-7]/.test(c)) {
          if (c === '0' && !/[0-9]/.test(s[this.i] ?? '')) return '\0';
          if (template) {
            this.i--;
            this.fail('An octal escape is not allowed in a template literal');
          }
          // A legacy octal escape (scripts are not strict): up to three digits, at most \377.
          let digits = c;
          const max = c <= '3' ? 3 : 2;
          while (digits.length < max && /[0-7]/.test(s[this.i] ?? '')) digits += s[this.i++];
          return String.fromCharCode(Number.parseInt(digits, 8));
        }
        if (template && (c === '8' || c === '9')) {
          this.i--;
          this.fail(`\\${c} is not allowed in a template literal`);
        }
        return c;
    }
  }

  private number(): number {
    const s = this.src;
    const start = this.i;
    const rest = s.slice(this.i);
    let m: RegExpMatchArray | null;
    let v: number;
    if ((m = rest.match(/^0[xX]([0-9a-fA-F](?:_?[0-9a-fA-F])*)/))) v = Number.parseInt(m[1]!.replace(/_/g, ''), 16);
    else if ((m = rest.match(/^0[oO]([0-7](?:_?[0-7])*)/))) v = Number.parseInt(m[1]!.replace(/_/g, ''), 8);
    else if ((m = rest.match(/^0[bB]([01](?:_?[01])*)/))) v = Number.parseInt(m[1]!.replace(/_/g, ''), 2);
    else if ((m = rest.match(/^0[0-7]+(?![0-9.eE_])/))) v = Number.parseInt(m[0].slice(1), 8);
    else if ((m = rest.match(/^0[0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?/)) && /[89]/.test(m[0])) v = Number(m[0]);
    else if ((m = rest.match(/^(?:(?:0|[1-9](?:_?[0-9])*)(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?/))) {
      v = Number(m[0].replace(/_/g, ''));
    } else return this.fail('A number is malformed');
    this.i += m[0].length;
    const after = s[this.i];
    if (after === 'n') this.fail('A BigInt is not literal data that JSON carries');
    if (after !== undefined && (/[0-9_]/.test(after) || ID_START.test(after))) {
      this.i = start;
      this.fail('A number is malformed');
    }
    return this.notFollowed(v);
  }

  private object(): Record<string, unknown> {
    const s = this.src;
    this.i++;
    const out: Record<string, unknown> = {};
    for (;;) {
      this.skip();
      const c = s[this.i];
      if (c === undefined) this.fail('An object is not closed');
      if (c === '}') {
        this.i++;
        return this.notFollowed(out);
      }
      let key: string;
      if (c === '"' || c === "'") {
        key = this.bare(() => this.string(c));
      } else if (c === '[') {
        this.fail('A computed key is not literal data');
      } else if (c === '.' && s.startsWith('...', this.i)) {
        this.fail('A spread is not literal data');
      } else if (/[0-9.]/.test(c)) {
        key = String(this.bare(() => this.number()));
      } else {
        const at = this.i;
        key = this.word();
        if (!key) this.fail(`A key is expected, not ${this.describe()}`);
        this.skip();
        const n = s[this.i];
        if ((key === 'get' || key === 'set' || key === 'async') && n !== ':' && n !== '(' && n !== ',' && n !== '}') {
          this.i = at;
          this.fail('A getter, setter or method is not literal data');
        }
        if (n === ',' || n === '}') {
          this.i = at;
          this.fail(`\`{ ${key} }\` refers to another name; write \`${key}: <value>\``);
        }
      }
      this.skip();
      if (s[this.i] === '(') this.fail('A method is not literal data');
      if (s[this.i] !== ':') this.fail(`\`:\` is expected after the key ${JSON.stringify(key)}`);
      this.i++;
      const value = this.value();
      // `__proto__: …` sets the prototype in a script, which JSON does not carry: it is dropped, as the page would.
      if (key !== '__proto__') Object.defineProperty(out, key, { value, enumerable: true, configurable: true, writable: true });
      this.skip();
      const sep = s[this.i];
      if (sep === ',') {
        this.i++;
        continue;
      }
      if (sep === '}') continue;
      this.fail(`\`,\` or \`}\` is expected, not ${this.describe()}`);
    }
  }

  /** A key: read like a value, but nothing after it is checked. */
  private bare<T>(read: () => T): T {
    this.keyMode = true;
    try {
      return read();
    } finally {
      this.keyMode = false;
    }
  }

  private array(): unknown[] {
    const s = this.src;
    this.i++;
    const out: unknown[] = [];
    for (;;) {
      this.skip();
      const c = s[this.i];
      if (c === undefined) this.fail('An array is not closed');
      if (c === ']') {
        this.i++;
        return this.notFollowed(out);
      }
      if (c === ',') this.fail('An array with holes is not read here');
      if (c === '.' && s.startsWith('...', this.i)) this.fail('A spread is not literal data');
      out.push(this.value());
      this.skip();
      const sep = s[this.i];
      if (sep === ',') {
        this.i++;
        continue;
      }
      if (sep === ']') continue;
      this.fail(`\`,\` or \`]\` is expected, not ${this.describe()}`);
    }
  }

  private describe(): string {
    const c = this.src[this.i];
    return c === undefined ? 'the end of the block' : `\`${c}\``;
  }

  private fail(message: string): never {
    const before = this.src.slice(0, this.i).split(/\r\n|[\n\r\u2028\u2029]/);
    const line = this.baseLine + before.length;
    const column = (before.length === 1 ? this.baseColumn : 0) + before[before.length - 1]!.length + 1;
    throw new DeclarationError(message, line, column);
  }
}

/** A value as JSON carries it (what frame-host keeps of a declaration). */
function jsonValue(v: unknown): unknown {
  if (v === undefined) return undefined;
  const text = JSON.stringify(v);
  return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
