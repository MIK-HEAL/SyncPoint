/**
 * SyncPoint MCP Server — creates and configures the McpServer instance.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";
import { registerPrompts } from "./prompts.js";

export function createSyncPointMcpServer(): McpServer {
  const server = new McpServer({
    name: "syncpoint",
    version: "0.6.0",
  });

  registerResources(server);
  registerTools(server);
  registerPrompts(server);

  return server;
}
