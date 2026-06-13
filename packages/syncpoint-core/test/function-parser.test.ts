/**
 * Tests for function name parsing strategies.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  parseFunctions,
  findFunctionAtLine,
  getFunctionParseStrategy,
  getStrategyForExtension,
  clearFunctionParseStrategies,
  registerFunctionParseStrategy,
} from "syncpoint-kernel";

describe("parseFunctions — TypeScript/JavaScript", () => {
  it("parses function declarations", () => {
    const source = `
function foo() {
  return 1;
}
function bar() {
  return 2;
}
`;
    const fns = parseFunctions(source, "typescript");
    expect(fns).toHaveLength(2);
    expect(fns[0]!.name).toBe("foo");
    expect(fns[1]!.name).toBe("bar");
  });

  it("parses async function declarations", () => {
    const source = `
async function fetchData() {
  await fetch('/');
}
`;
    const fns = parseFunctions(source, "typescript");
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe("fetchData");
  });

  it("parses arrow functions assigned to const", () => {
    const source = `
const handleClick = () => {
  console.log("clicked");
};
const add = (a: number, b: number): number => a + b;
`;
    const fns = parseFunctions(source, "typescript");
    expect(fns.length).toBeGreaterThanOrEqual(1);
    expect(fns.some(f => f.name === "handleClick")).toBe(true);
  });

  it("parses methods inside class/object", () => {
    const source = `
class Auth {
  login() {
    return true;
  }
  logout() {
    return false;
  }
}
`;
    const fns = parseFunctions(source, "typescript");
    const names = fns.map(f => f.name);
    expect(names).toContain("login");
    expect(names).toContain("logout");
  });

  it("skips control flow keywords", () => {
    const source = `
function foo() {
  if (true) {
    for (let i = 0; i < 10; i++) {}
  }
}
`;
    const fns = parseFunctions(source, "typescript");
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe("foo");
  });

  it("resolves by extension .tsx", () => {
    const fns = parseFunctions("function Foo() { return 1; }", ".tsx");
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe("Foo");
  });
});

describe("parseFunctions — Python", () => {
  it("parses def functions", () => {
    const source = `
def foo():
    return 1

def bar():
    return 2
`;
    const fns = parseFunctions(source, "python");
    expect(fns).toHaveLength(2);
    expect(fns[0]!.name).toBe("foo");
    expect(fns[1]!.name).toBe("bar");
  });

  it("parses async def functions", () => {
    const source = `
async def fetch_data():
    await something()
`;
    const fns = parseFunctions(source, "python");
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe("fetch_data");
  });

  it("handles nested functions", () => {
    const source = `
def outer():
    def inner():
        pass
    return inner
`;
    const fns = parseFunctions(source, "python");
    const names = fns.map(f => f.name);
    expect(names).toContain("outer");
    expect(names).toContain("inner");
  });

  it("resolves by extension .py", () => {
    const fns = parseFunctions("def foo(): return 1", ".py");
    expect(fns).toHaveLength(1);
  });
});

describe("parseFunctions — Go", () => {
  it("parses func declarations", () => {
    const source = `
func foo() int {
  return 1
}

func bar() string {
  return "hello"
}
`;
    const fns = parseFunctions(source, "go");
    expect(fns).toHaveLength(2);
    expect(fns[0]!.name).toBe("foo");
    expect(fns[1]!.name).toBe("bar");
  });

  it("parses method receivers", () => {
    const source = `
func (s *Server) Start() error {
  return nil
}
`;
    const fns = parseFunctions(source, "go");
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe("Start");
  });

  it("resolves by extension .go", () => {
    const fns = parseFunctions("func main() {}", ".go");
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe("main");
  });
});

describe("findFunctionAtLine", () => {
  it("finds the function containing a line", () => {
    const fns = [
      { name: "foo", startLine: 1, endLine: 5 },
      { name: "bar", startLine: 7, endLine: 12 },
    ];
    expect(findFunctionAtLine(fns, 3)?.name).toBe("foo");
    expect(findFunctionAtLine(fns, 9)?.name).toBe("bar");
    expect(findFunctionAtLine(fns, 6)).toBeUndefined();
  });
});

describe("function parse strategy registry", () => {
  beforeEach(() => clearFunctionParseStrategies());

  it("registers and retrieves custom strategy", () => {
    const custom = {
      language: "rust",
      extensions: [".rs"],
      parse: (src: string) => {
        const results: { name: string; startLine: number; endLine: number }[] = [];
        const lines = src.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i]!.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
          if (m) results.push({ name: m[1]!, startLine: i + 1, endLine: i + 1 });
        }
        return results;
      },
    };
    registerFunctionParseStrategy(custom);
    expect(getFunctionParseStrategy("rust")).toBe(custom);
    expect(getStrategyForExtension(".rs")).toBe(custom);
  });

  it("returns undefined for unknown language", () => {
    expect(getFunctionParseStrategy("brainfuck")).toBeUndefined();
  });
});
