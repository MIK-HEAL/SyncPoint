/**
 * Shared tRPC initialization.
 *
 * P0 Hardening: tRPC context carries authenticated caller identity.
 * - publicProcedure: no auth required (reads, metadata, health).
 * - protectedProcedure: requires `x-caller-id` header (mutations, exports, projection).
 * - adminProcedure: requires `x-caller-id` + admin role (constraint management, config).
 */

import { initTRPC, TRPCError } from "@trpc/server";
import type { IncomingMessage } from "node:http";
import { logger } from "../logger.js";
import { withTrace } from "../trace.js";

// ── Context ─────────────────────────────────────────────

export interface TRPCContext {
  /** Authenticated caller identity, derived from x-caller-id header. null if absent. */
  callerId: string | null;
  /** Agent role, derived from x-agent-role header or agent registry. null if unauthenticated. */
  callerRole: string | null;
  /** Agent token, derived from x-agent-token header. null if absent. */
  callerToken: string | null;
}

// ── Rate limiter (simple token bucket, per-caller) ─────

const rateLimitBuckets = new Map<string, { tokens: number; lastRefill: number }>();
const RATE_LIMIT = 100;        // requests per second
const RATE_REFILL_MS = 1000;   // refill interval

function checkRateLimit(callerId: string): boolean {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(callerId);
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT, lastRefill: now };
    rateLimitBuckets.set(callerId, bucket);
  }
  // Refill
  const elapsed = now - bucket.lastRefill;
  if (elapsed > RATE_REFILL_MS) {
    bucket.tokens = Math.min(RATE_LIMIT, bucket.tokens + Math.floor(elapsed / RATE_REFILL_MS) * RATE_LIMIT);
    bucket.lastRefill = now;
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens--;
  return true;
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 300_000;
  for (const [id, bucket] of rateLimitBuckets) {
    if (bucket.lastRefill < cutoff) rateLimitBuckets.delete(id);
  }
}, 300_000).unref();

// ── Auth helpers ────────────────────────────────────────

/**
 * Validate an agent token.
 * Currently supports simple shared-secret tokens.
 * Future: JWT validation, registry-backed lookup.
 */
function validateAgentToken(token: string): { valid: boolean; agentId?: string; role?: string } {
  // If SYNCPOINT_SHARED_SECRET is set, require it as the token
  const sharedSecret = process.env.SYNCPOINT_SHARED_SECRET;
  if (sharedSecret) {
    if (token !== sharedSecret) return { valid: false };
  }
  // Without shared secret, accept any non-empty token (trust-on-localhost mode)
  // The callerId from x-caller-id is the primary identity
  return { valid: true };
}

// ── Context factory ─────────────────────────────────────

/**
 * Create tRPC context from the incoming HTTP request.
 * Extracts caller identity, role, and token from headers.
 */
export function createContext(req: IncomingMessage): TRPCContext {
  const rawCaller = req.headers["x-caller-id"];
  const rawRole = req.headers["x-agent-role"];
  const rawToken = req.headers["x-agent-token"];
  const callerId = typeof rawCaller === "string" && rawCaller.trim().length > 0 ? rawCaller.trim() : null;
  const callerRole = typeof rawRole === "string" && rawRole.trim().length > 0 ? rawRole.trim() : null;
  const callerToken = typeof rawToken === "string" && rawToken.trim().length > 0 ? rawToken.trim() : null;
  return { callerId, callerRole, callerToken };
}

// ── tRPC init ───────────────────────────────────────────

export const t = initTRPC.context<TRPCContext>().create();

// ── Procedures ──────────────────────────────────────────

/** Public: no auth required. Suitable for health checks, status, and read-only queries. */
export const publicProcedure = t.procedure;

/**
 * Protected: requires authenticated caller identity.
 * 1. Validates agent token if present (x-agent-token header).
 * 2. Rejects with UNAUTHORIZED if caller identity cannot be established.
 * 3. Applies rate limiting per caller.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next, path }) => {
  // Token validation: if a token is provided, validate it
  if (ctx.callerToken) {
    const result = validateAgentToken(ctx.callerToken);
    if (!result.valid) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid agent token.",
      });
    }
  }

  // Caller identity required — either from token or x-caller-id
  if (!ctx.callerId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required. Provide x-caller-id header.",
    });
  }

  // Rate limiting
  if (!checkRateLimit(ctx.callerId)) {
    logger.warn("Rate limit exceeded", { callerId: ctx.callerId, path });
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Rate limit exceeded. Slow down.",
    });
  }
  return withTrace(() => next({
    ctx: { ...ctx, callerId: ctx.callerId },
  }), { callerId: ctx.callerId, operation: path });
});

/**
 * Admin: requires caller identity + admin role.
 * Rejects with FORBIDDEN if the caller does not have an admin role.
 */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.callerRole !== "admin" && ctx.callerRole !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin role required for this operation.",
    });
  }
  return next({ ctx });
});

// ── Per-operation authorization ─────────────────────────

/** Operation permission rules: maps operation → required role/ownership constraint. */
const OPERATION_PERMISSIONS: Record<string, { role?: string[]; ownResourceOnly?: boolean }> = {
  claimResource: { role: ["agent", "admin", "owner"] },
  releaseResource: { role: ["agent", "admin", "owner"], ownResourceOnly: true },
  resolveConflict: { role: ["agent", "admin", "owner"] },
  createConstraint: { role: ["admin", "owner"] },
  modifyConstraint: { role: ["admin", "owner"] },
  createCheckpoint: { role: ["agent", "admin", "owner"] },
  approveCheckpoint: { role: ["agent", "admin", "owner"] },
  rejectCheckpoint: { role: ["agent", "admin", "owner"] },
  forceRecover: { role: ["admin", "owner"] },
};

/**
 * Authorize an operation against the caller context.
 * Throws FORBIDDEN if the caller lacks the required role or ownership.
 *
 * @param ctx - Authenticated tRPC context
 * @param operation - The operation being attempted (e.g. 'claimResource')
 * @param resourceOwnerId - For ownResourceOnly checks, the owner of the resource
 */
export function authorize(ctx: TRPCContext, operation: string, resourceOwnerId?: string): void {
  const perm = OPERATION_PERMISSIONS[operation];
  if (!perm) {
    // Default-deny: operations without explicit permission rules are forbidden
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Operation '${operation}' is not authorized. No permission rule defined.`,
    });
  }

  // Role check
  if (perm.role && perm.role.length > 0) {
    const callerRole = ctx.callerRole ?? "agent"; // default role
    if (!perm.role.includes(callerRole)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Role '${callerRole}' is not authorized for operation '${operation}'. Required: ${perm.role.join(", ")}`,
      });
    }
  }

  // Ownership check
  if (perm.ownResourceOnly && resourceOwnerId && ctx.callerId !== resourceOwnerId) {
    // Admin/owner can bypass ownership
    if (ctx.callerRole !== "admin" && ctx.callerRole !== "owner") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Only the resource owner or admin can perform '${operation}'.`,
      });
    }
  }
}

// ── Audit logger ────────────────────────────────────────

/**
 * Log an auditable operation. Call this from mutation handlers
 * for sensitive operations (resource claims, constraint changes, approvals).
 */
export function auditLog(operation: string, ctx: TRPCContext, detail?: Record<string, unknown>): void {
  logger.info(`AUDIT: ${operation}`, {
    callerId: ctx.callerId,
    callerRole: ctx.callerRole,
    operation,
    ...detail,
  });
}

// ── Test exports ────────────────────────────────────────

/** Exported for testing only. */
export { validateAgentToken };
