/**
 * Runtime — represents a real execution entry point (editor window, daemon, cloud).
 *
 * A runtime is the physical process that connects to SyncPoint via MCP/CLI/SDK.
 * Binding an agent to a runtime means "this connection speaks as that agent."
 */

import { z } from "zod";
import { ForbiddenError } from "syncpoint-kernel";

// ── Status ──────────────────────────────────────────────

export enum RuntimeStatus {
  ACTIVE = "ACTIVE",
  DISCONNECTED = "DISCONNECTED",
}

export enum RuntimeKind {
  LOCAL_MCP = "local-mcp",
  DAEMON = "daemon",
  CLOUD = "cloud",
}

// ── Schema ──────────────────────────────────────────────

export const RuntimeSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  kind: z.nativeEnum(RuntimeKind).default(RuntimeKind.LOCAL_MCP),
  provider: z.string().default(""),
  host: z.string().default(""),
  workspaceRoot: z.string().default(""),
  agentId: z.string().nullable().default(null),
  status: z.nativeEnum(RuntimeStatus).default(RuntimeStatus.ACTIVE),
  lastSeenAt: z.string().default(""),
  createdAt: z.string(),
});

export type Runtime = z.infer<typeof RuntimeSchema>;

export const RuntimeCreateSchema = z.object({
  name: z.string().min(1),
  kind: z.nativeEnum(RuntimeKind).default(RuntimeKind.LOCAL_MCP),
  provider: z.string().default(""),
  host: z.string().default(""),
  workspaceRoot: z.string().default(""),
  agentId: z.string().nullable().default(null),
});

export type RuntimeCreate = z.infer<typeof RuntimeCreateSchema>;

// ── Identity Resolution (pure logic) ────────────────────

export interface BoundIdentity {
  agentId: string;
  runtimeId: string | null;
  source: "env-agent" | "env-runtime";
}

export interface IdentityEnv {
  SYNCPOINT_AGENT_ID?: string;
  SYNCPOINT_RUNTIME_ID?: string;
}

/**
 * Resolve the effective agent identity from environment + optional parameter.
 *
 * Priority:
 *   1. SYNCPOINT_AGENT_ID env → bound agent (reject mismatched param)
 *   2. SYNCPOINT_RUNTIME_ID env → look up agent from runtime (caller supplies resolver)
 *
 * Returns null if no identity can be resolved.
 * Throws if inputAgentId conflicts with bound identity.
 */
export function resolveIdentity(
  env: IdentityEnv,
  inputAgentId: string | undefined,
  runtimeAgentLookup?: (runtimeId: string) => string | null,
): BoundIdentity | null {
  const envAgentId = env.SYNCPOINT_AGENT_ID;
  const envRuntimeId = env.SYNCPOINT_RUNTIME_ID;

  // Case 1: explicit SYNCPOINT_AGENT_ID
  if (envAgentId) {
    if (inputAgentId && inputAgentId !== envAgentId) {
      throw new IdentityConflictError(envAgentId, inputAgentId);
    }
    return { agentId: envAgentId, runtimeId: envRuntimeId ?? null, source: "env-agent" };
  }

  // Case 2: SYNCPOINT_RUNTIME_ID → resolve agent
  if (envRuntimeId && runtimeAgentLookup) {
    const resolved = runtimeAgentLookup(envRuntimeId);
    if (resolved) {
      if (inputAgentId && inputAgentId !== resolved) {
        throw new IdentityConflictError(resolved, inputAgentId);
      }
      return { agentId: resolved, runtimeId: envRuntimeId, source: "env-runtime" };
    }
  }

  return null;
}

// ── Errors ──────────────────────────────────────────────

export class IdentityConflictError extends ForbiddenError {
  constructor(
    public boundAgentId: string,
    public requestedAgentId: string,
  ) {
    super(
      "identity switch",
      `connection bound to "${boundAgentId}" but requested "${requestedAgentId}"`
    );
    this.name = "IdentityConflictError";
  }
}
