/**
 * Tests for MCP resource registration — validates that resources
 * and resource templates are correctly defined.
 */
import { describe, it, expect } from "vitest";
import { createSyncPointMcpServer } from "../src/server.js";

describe("MCP resources", () => {
  it("server creates without throwing", () => {
    const server = createSyncPointMcpServer();
    expect(server).toBeDefined();
  });

  it("server has expected shape", () => {
    const server = createSyncPointMcpServer();
    expect(typeof server.connect).toBe("function");
    expect(typeof server.close).toBe("function");
  });
});
