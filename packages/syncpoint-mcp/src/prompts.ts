/**
 * MCP prompts — entry point. Registers all prompt categories.
 *
 * Categories split across:
 *   prompts-system.ts — resume, checkpoint, handoff, onboarding
 *   prompts-task.ts — executor, reviewer, architect, planning
 *   prompts-review.ts — memory review, evidence, playbook, wake, conflicts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSystemPrompts } from "./prompts-system.js";
import { registerTaskPrompts } from "./prompts-task.js";
import { registerReviewPrompts } from "./prompts-review.js";

export function registerPrompts(server: McpServer): void {
  registerSystemPrompts(server);
  registerTaskPrompts(server);
  registerReviewPrompts(server);
}
