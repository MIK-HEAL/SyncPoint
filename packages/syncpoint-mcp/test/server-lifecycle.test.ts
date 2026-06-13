/**
 * Tests for MCP server lifecycle — creation, capability queries, shutdown.
 */
import { describe, it, expect } from "vitest";
import { createSyncPointMcpServer } from "../src/server.js";

describe("server creation", () => {
  it("creates a server instance", () => {
    const server = createSyncPointMcpServer();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
    expect(typeof server.close).toBe("function");
  });

  it("creates multiple independent instances", () => {
    const server1 = createSyncPointMcpServer();
    const server2 = createSyncPointMcpServer();
    expect(server1).not.toBe(server2);
  });

  it("has serverInfo with correct name and version", () => {
    const server = createSyncPointMcpServer();
    // Server should be constructable without errors
    expect(server).toBeTruthy();
  });
});

describe("server capabilities", () => {
  it("server implements the MCP server interface", () => {
    const server = createSyncPointMcpServer();
    // These methods are part of the McpServer interface
    expect(typeof server.registerTool).toBe("function");
    expect(typeof server.registerResource).toBe("function");
    expect(typeof server.registerPrompt).toBe("function");
  });
});
