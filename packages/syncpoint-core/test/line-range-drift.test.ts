/**
 * Tests for line-range drift tracking.
 *
 * Verifies that line number remapping works correctly across
 * common edit scenarios: insertion, deletion, replacement,
 * multi-line changes, and edge cases.
 */

import { describe, it, expect } from "vitest";
import { computeLineDrift, remapLineRanges, rangeStillExists } from "syncpoint-kernel";
import type { LineRange } from "syncpoint-kernel";

// ── Helpers ───────────────────────────────────────────

function src(lines: string[]): string {
  return lines.join("\n");
}

function range(start: number, end: number): LineRange {
  return { start, end };
}

// ── Tests ─────────────────────────────────────────────

describe("computeLineDrift", () => {
  describe("identity (no changes)", () => {
    it("returns identity mapping for identical content", () => {
      const s = src(["line1", "line2", "line3"]);
      const { mapping, added, removed } = computeLineDrift(s, s);
      expect(added).toBe(0);
      expect(removed).toBe(0);
      expect(mapping.mapLine(1)).toBe(1);
      expect(mapping.mapLine(2)).toBe(2);
      expect(mapping.mapLine(3)).toBe(3);
    });

    it("remapRange returns identical range", () => {
      const s = src(["a", "b", "c", "d"]);
      const { mapping } = computeLineDrift(s, s);
      const r = mapping.remapRange(range(2, 4));
      expect(r).toEqual({ start: 2, end: 4 });
    });
  });

  describe("line insertion", () => {
    it("shifts lines after insertion point down", () => {
      const oldSrc = src(["line1", "line2", "line3"]);
      const newSrc = src(["line1", "INSERTED", "line2", "line3"]);
      const { mapping, added, removed } = computeLineDrift(oldSrc, newSrc);

      expect(added).toBeGreaterThan(0);
      expect(mapping.mapLine(1)).toBe(1); // line1 stays
      expect(mapping.mapLine(2)).toBe(3); // line2 shifted down
      expect(mapping.mapLine(3)).toBe(4); // line3 shifted down
    });

    it("shifts a line range after insertion", () => {
      const oldSrc = src(["a", "b", "c", "d", "e"]);
      const newSrc = src(["a", "X", "b", "c", "d", "e"]);
      const { mapping } = computeLineDrift(oldSrc, newSrc);

      // Range covering c-d moves from (3,4) to (4,5)
      const r = mapping.remapRange(range(3, 4));
      expect(r).toEqual({ start: 4, end: 5 });
    });

    it("handles insertion at end of file", () => {
      const oldSrc = src(["a", "b"]);
      const newSrc = src(["a", "b", "c", "d"]);
      const { mapping } = computeLineDrift(oldSrc, newSrc);

      expect(mapping.mapLine(1)).toBe(1);
      expect(mapping.mapLine(2)).toBe(2);
    });

    it("handles insertion at beginning of file", () => {
      const oldSrc = src(["a", "b"]);
      const newSrc = src(["X", "Y", "a", "b"]);
      const { mapping } = computeLineDrift(oldSrc, newSrc);

      expect(mapping.mapLine(1)).toBe(3); // "a" moved to line 3
      expect(mapping.mapLine(2)).toBe(4); // "b" moved to line 4
    });
  });

  describe("line deletion", () => {
    it("returns 0 for deleted lines", () => {
      const oldSrc = src(["line1", "DELETE_ME", "line2"]);
      const newSrc = src(["line1", "line2"]);
      const { mapping } = computeLineDrift(oldSrc, newSrc);

      expect(mapping.mapLine(1)).toBe(1); // line1 stays
      expect(mapping.mapLine(2)).toBe(0); // DELETE_ME → deleted
      expect(mapping.mapLine(3)).toBe(2); // line2 shifted up
    });

    it("remapRange returns undefined if entire range deleted", () => {
      const oldSrc = src(["a", "b", "c", "d"]);
      const newSrc = src(["a", "d"]);
      const { mapping } = computeLineDrift(oldSrc, newSrc);

      // b-c range (2,3) is fully deleted
      const r = mapping.remapRange(range(2, 3));
      expect(r).toBeUndefined();
    });

    it("remapRange shrinks if part of range deleted", () => {
      const oldSrc = src(["a", "b", "c", "d", "e"]);
      const newSrc = src(["a", "b", "d", "e"]); // "c" deleted
      const { mapping } = computeLineDrift(oldSrc, newSrc);

      // Range covering b-c-d (2,4) → b-d (2,3)
      const r = mapping.remapRange(range(2, 4));
      expect(r).toEqual({ start: 2, end: 3 });
    });
  });

  describe("line replacement", () => {
    it("handles replacement of a single line", () => {
      const oldSrc = src(["a", "OLD", "c"]);
      const newSrc = src(["a", "NEW", "c"]);
      const { mapping } = computeLineDrift(oldSrc, newSrc);

      expect(mapping.mapLine(1)).toBe(1); // "a" stays
      expect(mapping.mapLine(2)).toBe(0); // "OLD" doesn't exist in new
      expect(mapping.mapLine(3)).toBe(3); // "c" stays at same position
    });

    it("handles replacement of multiple lines with different count", () => {
      const oldSrc = src(["a", "old1", "old2", "d"]);
      const newSrc = src(["a", "new1", "new2", "new3", "d"]);
      const { mapping } = computeLineDrift(oldSrc, newSrc);

      // "a" stays at 1
      expect(mapping.mapLine(1)).toBe(1);
      // "d" shifts from 4 to 5
      expect(mapping.mapLine(4)).toBe(5);
    });
  });

  describe("multi-line functions", () => {
    it("correctly remaps a function that spans multiple lines after insertion above it", () => {
      const oldSrc = src([
        "import foo",
        "",
        "function hello() {",
        "  console.log('hi');",
        "}",
        "",
        "function world() {",
        "  console.log('earth');",
        "}",
      ]);
      const newSrc = src([
        "import foo",
        "import bar", // inserted
        "",
        "function hello() {",
        "  console.log('hi');",
        "}",
        "",
        "function world() {",
        "  console.log('earth');",
        "}",
      ]);

      const { mapping } = computeLineDrift(oldSrc, newSrc);

      // hello was at lines 3-5, now at 4-6
      expect(mapping.mapLine(3)).toBe(4);
      expect(mapping.mapLine(5)).toBe(6);

      // world was at lines 7-9, now at 8-10
      expect(mapping.mapLine(7)).toBe(8);
      expect(mapping.mapLine(9)).toBe(10);
    });

    it("remaps function ranges when code is inserted between them", () => {
      const oldSrc = src([
        "function foo() {",
        "  return 1;",
        "}",
        "function bar() {",
        "  return 2;",
        "}",
      ]);
      const newSrc = src([
        "function foo() {",
        "  return 1;",
        "}",
        "function inserted() {",
        "  return 99;",
        "}",
        "function bar() {",
        "  return 2;",
        "}",
      ]);

      const { mapping } = computeLineDrift(oldSrc, newSrc);

      // foo stays at 1-3
      expect(mapping.remapRange(range(1, 3))).toEqual({ start: 1, end: 3 });
      // bar moves from 4-6 to 7-9
      expect(mapping.remapRange(range(4, 6))).toEqual({ start: 7, end: 9 });
    });
  });

  describe("edge cases", () => {
    it("handles empty old source", () => {
      const oldSrc = "";
      const newSrc = src(["new", "file"]);
      const { mapping } = computeLineDrift(oldSrc, newSrc);
      // Old source is empty — no lines to map
      expect(mapping.mapLine(1)).toBe(0);
    });

    it("handles empty new source", () => {
      const oldSrc = src(["a", "b"]);
      const newSrc = "";
      const { mapping } = computeLineDrift(oldSrc, newSrc);
      // All old lines deleted
      expect(mapping.mapLine(1)).toBe(0);
      expect(mapping.mapLine(2)).toBe(0);
    });

    it("handles both empty", () => {
      const { mapping } = computeLineDrift("", "");
      // No lines to map
      expect(mapping.mapLine(1)).toBe(0);
    });

    it("handles line number beyond old source length", () => {
      const oldSrc = src(["a", "b"]);
      const newSrc = src(["a", "b"]);
      const { mapping } = computeLineDrift(oldSrc, newSrc);
      // Line 10 in a 2-line old file doesn't exist — return 0
      expect(mapping.mapLine(10)).toBe(0);
    });

    it("handles line number 0 or negative", () => {
      const s = src(["a"]);
      const { mapping } = computeLineDrift(s, s);
      expect(mapping.mapLine(0)).toBe(0);
      expect(mapping.mapLine(-1)).toBe(0);
    });
  });
});

describe("remapLineRanges", () => {
  it("remaps multiple ranges after insertion", () => {
    const oldSrc = src(["a", "b", "c", "d"]);
    const newSrc = src(["X", "a", "b", "c", "d"]);
    const ranges: LineRange[] = [range(1, 2), range(3, 4)];

    const result = remapLineRanges(oldSrc, newSrc, ranges);
    expect(result).toEqual([range(2, 3), range(4, 5)]);
  });

  it("drops ranges that were fully deleted", () => {
    const oldSrc = src(["a", "b", "c", "d"]);
    const newSrc = src(["a", "c", "d"]); // "b" deleted
    const ranges: LineRange[] = [range(1, 1), range(2, 2), range(3, 4)];

    const result = remapLineRanges(oldSrc, newSrc, ranges);
    // range(2,2) = "b" was deleted → dropped
    expect(result).toEqual([range(1, 1), range(2, 3)]);
  });
});

describe("rangeStillExists", () => {
  it("returns true when range survives", () => {
    const oldSrc = src(["a", "b", "c"]);
    const newSrc = src(["X", "a", "b", "c"]);
    expect(rangeStillExists(oldSrc, newSrc, range(1, 2))).toBe(true);
  });

  it("returns false when range is fully deleted", () => {
    const oldSrc = src(["a", "b", "c"]);
    const newSrc = src(["a", "c"]); // "b" deleted
    expect(rangeStillExists(oldSrc, newSrc, range(2, 2))).toBe(false);
  });
});
