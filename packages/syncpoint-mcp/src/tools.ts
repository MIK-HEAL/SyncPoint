/**
 * MCP tools — state-mutating operations exposed to LLM clients.
 * All tools delegate to application layer use cases.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerLoopContextTools } from "./tools/loop-context.js";
import { registerProjectMemoryTools } from "./tools/project-memory.js";
import { registerContextTools } from "./tools/context.js";
import { registerSessionTools } from "./tools/session.js";
import { registerReviewTools } from "./tools/review.js";
import { registerPlaybookTools } from "./tools/playbook.js";
import { registerWakeTools } from "./tools/wake.js";
import { registerResourceTools } from "./tools/resource.js";
import { registerSyncGateTools } from "./tools/sync-gate.js";
import { registerCheckpointReviewTools } from "./tools/checkpoint-review.js";
import { registerOperationTools } from "./tools/operation.js";
import { registerGuardTools } from "./tools/guard.js";
import { registerRuntimeTools } from "./tools/runtime.js";
import { registerAgentMessageTools } from "./tools/agent-message.js";
import { registerConstraintTools } from "./tools/constraint.js";

export function registerTools(server: McpServer): void {
  registerLoopContextTools(server);
  registerProjectMemoryTools(server);
  registerContextTools(server);
  registerSessionTools(server);
  registerReviewTools(server);
  registerPlaybookTools(server);
  registerWakeTools(server);
  registerResourceTools(server);
  registerSyncGateTools(server);
  registerCheckpointReviewTools(server);
  registerOperationTools(server);
  registerGuardTools(server);
  registerRuntimeTools(server);
  registerAgentMessageTools(server);
  registerConstraintTools(server);
}
