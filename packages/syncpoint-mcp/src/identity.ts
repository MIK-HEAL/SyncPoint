/**
 * MCP Identity — resolves the bound agent for this MCP connection.
 *
 * Reads SYNCPOINT_AGENT_ID / SYNCPOINT_RUNTIME_ID from environment,
 * and provides a single function that tools call to get the effective agentId.
 */

import { resolveIdentity, IdentityConflictError } from "syncpoint-adapters";
import type { BoundIdentity } from "syncpoint-adapters";
import { getAgentIdForRuntime } from "syncpoint-server/repositories";
import { log } from "./errors.js";

// ── Cached identity (resolved once at startup) ──────────

let _cachedIdentity: BoundIdentity | null | undefined = undefined;

/**
 * Resolve the bound agent for the current MCP connection.
 *
 * Call with an optional inputAgentId (from tool parameters).
 * - If connection is bound (env vars), uses the bound identity.
 * - If inputAgentId conflicts with bound identity, throws IdentityConflictError.
 * - If no binding, returns null — tools require explicit agentId.
 *
 * Returns the effective agentId, or null if none can be determined.
 */
export function resolveBoundAgentId(inputAgentId?: string): string | null {
  const identity = resolveBoundIdentity(inputAgentId);
  return identity?.agentId ?? null;
}

/**
 * Get the full bound identity object for this connection.
 * Returns null if no identity can be resolved.
 */
export function resolveBoundIdentity(inputAgentId?: string): BoundIdentity | null {
  return resolveIdentity(
    {
      SYNCPOINT_AGENT_ID: process.env.SYNCPOINT_AGENT_ID,
      SYNCPOINT_RUNTIME_ID: process.env.SYNCPOINT_RUNTIME_ID,
    },
    inputAgentId,
    getAgentIdForRuntime,
  );
}

/**
 * Get the startup-resolved identity (cached).
 * This does NOT check inputAgentId — use for whoami / status.
 */
export function getConnectionIdentity(): BoundIdentity | null {
  if (_cachedIdentity === undefined) {
    try {
      _cachedIdentity = resolveBoundIdentity();
    } catch {
      _cachedIdentity = null;
    }
  }
  return _cachedIdentity;
}

/**
 * Returns true if this MCP connection has a bound agent identity.
 */
export function isBound(): boolean {
  const id = getConnectionIdentity();
  return id !== null;
}

/**
 * Log the identity binding status at startup.
 */
export function logIdentityStatus(): void {
  const envAgent = process.env.SYNCPOINT_AGENT_ID;
  const envRuntime = process.env.SYNCPOINT_RUNTIME_ID;

  if (envAgent) {
    log(`Identity bound: agentId=${envAgent} (env)`);
  } else if (envRuntime) {
    const resolved = getAgentIdForRuntime(envRuntime);
    if (resolved) {
      log(`Identity bound: agentId=${resolved} via runtimeId=${envRuntime}`);
    } else {
      log(`Runtime ${envRuntime} registered but no agent bound — unbound`);
    }
  } else {
    log("No identity binding — tools require explicit agentId");
  }
}

export { IdentityConflictError };
