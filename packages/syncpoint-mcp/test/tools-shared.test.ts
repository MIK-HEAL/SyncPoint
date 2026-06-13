/**
 * Tests for MCP tool shared helpers — ok() and fail() response builders.
 */
import { describe, it, expect } from "vitest";
import { ok, fail } from "../src/tools/_shared.js";

describe("ok", () => {
  it("returns a success content array with JSON text", () => {
    const result = ok({ status: "active", count: 3 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.status).toBe("active");
    expect(parsed.count).toBe(3);
  });

  it("handles empty objects", () => {
    const result = ok({});
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual({});
  });

  it("handles nested objects", () => {
    const result = ok({ session: { id: "s1", title: "Test" } });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.session.id).toBe("s1");
  });
});

describe("fail", () => {
  it("returns an error content array with isError flag", () => {
    const err = new Error("Something went wrong");
    err.name = "NotFoundError";
    const result = fail(err);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("Something went wrong");
  });

  it("handles string errors", () => {
    const result = fail("bad input");
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("Unknown error");
  });

  it("handles null/undefined", () => {
    expect(fail(null).isError).toBe(true);
    expect(fail(undefined).isError).toBe(true);
  });
});
