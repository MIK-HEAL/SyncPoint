/**
 * Function name parsing strategies for resource scope refinement.
 *
 * Provides language-aware function name extraction from source text,
 * enabling function-scoped resource claims that avoid false conflicts
 * when two agents modify different functions in the same file.
 */

export interface FunctionParseStrategy {
  /** Language identifier matching common conventions. */
  language: string;
  /** File extensions this strategy handles (with leading dot). */
  extensions: string[];
  /**
   * Extract function names from source text.
   * Returns an array of { name, startLine, endLine } entries.
   */
  parse(source: string): ParsedFunction[];
}

export interface ParsedFunction {
  /** Function/method name. */
  name: string;
  /** 1-indexed start line of the function definition. */
  startLine: number;
  /** 1-indexed end line (last line of function body, best-effort). */
  endLine: number;
}

// ── Built-in strategies ────────────────────────────────

const TYPESCRIPT_STRATEGY: FunctionParseStrategy = {
  language: "typescript",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  parse(source: string): ParsedFunction[] {
    const results: ParsedFunction[] = [];
    const lines = source.split("\n");
    // Matches: function name(, const name = (, const name = async (, name(params) {, async name(params) {
    const funcRe = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(|^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^=]+)?\s*(?:=>|\{)/;
    // Method: name(params) { inside class/object
    const methodRe = /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^=]+)?\s*\{/;
    // Arrow: const name = (...) =>
    const arrowRe = /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/;

    let braceDepth = 0;
    let current: ParsedFunction | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      if (current) {
        braceDepth += countBraces(line);
        if (braceDepth <= 0) {
          current.endLine = lineNum;
          results.push(current);
          current = null;
          braceDepth = 0;
        }
        continue;
      }

      const funcMatch = line.match(funcRe) || line.match(arrowRe);
      const methodMatch = !funcMatch ? line.match(methodRe) : null;
      const match = funcMatch || methodMatch;

      if (match) {
        const name = match[1] || match[2] || match[3] || "";
        if (!name || name.startsWith("//") || name === "if" || name === "for" || name === "while" || name === "switch" || name === "catch") {
          // Skip control flow keywords that look like function calls
          continue;
        }
        braceDepth = countBraces(line);
        if (braceDepth > 0) {
          current = { name, startLine: lineNum, endLine: lineNum };
        } else {
          // Single-line function (arrow without braces)
          results.push({ name, startLine: lineNum, endLine: lineNum });
        }
      }
    }

    // If unclosed function at EOF, close it
    if (current) {
      current.endLine = lines.length;
      results.push(current);
    }

    return results;
  },
};

const PYTHON_STRATEGY: FunctionParseStrategy = {
  language: "python",
  extensions: [".py", ".pyw", ".pyi"],
  parse(source: string): ParsedFunction[] {
    const results: ParsedFunction[] = [];
    const lines = source.split("\n");
    const funcRe = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/;

    let current: ParsedFunction | null = null;
    let baseIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;
      const match = line.match(funcRe);

      if (match) {
        // Close previous function
        if (current) {
          current.endLine = lineNum - 1;
          results.push(current);
        }
        const indent = match[1]!.length;
        baseIndent = indent;
        current = { name: match[2]!, startLine: lineNum, endLine: lineNum };
      } else if (current) {
        // A function ends when we encounter a line with equal or less indentation that is not blank
        const trimmed = line.trimEnd();
        if (trimmed.length > 0) {
          const leadingSpaces = line.match(/^(\s*)/)?.[1]!.length ?? 0;
          if (leadingSpaces <= baseIndent && !line.trimStart().startsWith("#")) {
            current.endLine = lineNum - 1;
            results.push(current);
            current = null;
          }
        }
      }
    }

    if (current) {
      current.endLine = lines.length;
      results.push(current);
    }

    return results;
  },
};

const GO_STRATEGY: FunctionParseStrategy = {
  language: "go",
  extensions: [".go"],
  parse(source: string): ParsedFunction[] {
    const results: ParsedFunction[] = [];
    const lines = source.split("\n");
    // func name( or func (r *Type) name(
    const funcRe = /^\s*func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/;

    let braceDepth = 0;
    let current: ParsedFunction | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      if (current) {
        braceDepth += countBraces(line);
        if (braceDepth <= 0) {
          current.endLine = lineNum;
          results.push(current);
          current = null;
          braceDepth = 0;
        }
        continue;
      }

      const match = line.match(funcRe);
      if (match) {
        braceDepth = countBraces(line);
        if (braceDepth > 0) {
          current = { name: match[1]!, startLine: lineNum, endLine: lineNum };
        } else {
          results.push({ name: match[1]!, startLine: lineNum, endLine: lineNum });
        }
      }
    }

    if (current) {
      current.endLine = lines.length;
      results.push(current);
    }

    return results;
  },
};

// ── Registry ──────────────────────────────────────────

const _strategies = new Map<string, FunctionParseStrategy>();

function registerBuiltinStrategies(): void {
  if (_strategies.size > 0) return;
  for (const s of [TYPESCRIPT_STRATEGY, PYTHON_STRATEGY, GO_STRATEGY]) {
    _strategies.set(s.language, s);
  }
}

export function registerFunctionParseStrategy(strategy: FunctionParseStrategy): void {
  _strategies.set(strategy.language, strategy);
}

export function getFunctionParseStrategy(language: string): FunctionParseStrategy | undefined {
  registerBuiltinStrategies();
  return _strategies.get(language);
}

export function getStrategyForExtension(ext: string): FunctionParseStrategy | undefined {
  registerBuiltinStrategies();
  for (const s of _strategies.values()) {
    if (s.extensions.includes(ext)) return s;
  }
  return undefined;
}

export function clearFunctionParseStrategies(): void {
  _strategies.clear();
}

/**
 * Parse function names from source text using the strategy for the given language or extension.
 */
export function parseFunctions(source: string, languageOrExt: string): ParsedFunction[] {
  registerBuiltinStrategies();
  const strategy = _strategies.get(languageOrExt) ?? getStrategyForExtension(languageOrExt);
  if (!strategy) return [];
  return strategy.parse(source);
}

/**
 * Find which function contains a given line number.
 */
export function findFunctionAtLine(functions: ParsedFunction[], line: number): ParsedFunction | undefined {
  return functions.find(f => line >= f.startLine && line <= f.endLine);
}

// ── Helpers ───────────────────────────────────────────

function countBraces(line: string): number {
  let count = 0;
  let inString: string | null = null;
  let escaped = false;
  for (const ch of line) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { inString = ch; continue; }
    if (ch === "{") count++;
    if (ch === "}") count--;
  }
  return count;
}
