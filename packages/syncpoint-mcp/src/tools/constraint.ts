/**
 * MCP tools for constraint management and preflight checks.
 *
 * syncpoint_constraint_list  — list active constraint rules
 * syncpoint_constraint_check — check if a file/path matches constraints
 * syncpoint_preflight        — pre-modification safety check
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  rcRelease,
  rcDetectConflicts,
  rcList,
} from "syncpoint-server/application";
import { resolveBoundAgentId } from "../identity.js";
import { fail, ok } from "./_shared.js";

export function registerConstraintTools(server: McpServer): void {
  // ── Constraint list ──────────────────────────────────
  server.registerTool(
    "syncpoint_constraint_list",
    {
      title: "List Constraints",
      description: "List active constraint rules (do_not_touch, require_review, etc.) that govern what agents can modify.",
      inputSchema: {
        sessionId: z.string().optional(),
        resourceType: z.string().optional().describe("Filter by constraint type (default: all)"),
      },
    },
    async ({ sessionId }) => {
      try {
        // Constraints are exposed through the project memory and guard systems.
        // Collect do_not_touch entries and other constraint types.
        const constraints: Array<{
          kind: string;
          pattern: string;
          description: string;
          source: string;
        }> = [];

        // Check for do_not_touch patterns in environment / config
        const doNotTouch = process.env.SYNCPOINT_DO_NOT_TOUCH;
        if (doNotTouch) {
          for (const p of doNotTouch.split(",").map(s => s.trim()).filter(Boolean)) {
            constraints.push({
              kind: "do_not_touch",
              pattern: p,
              description: `Files matching '${p}' are protected and must not be edited`,
              source: "environment",
            });
          }
        }

        // Check for require_review patterns
        const requireReview = process.env.SYNCPOINT_REQUIRE_REVIEW;
        if (requireReview) {
          for (const p of requireReview.split(",").map(s => s.trim()).filter(Boolean)) {
            constraints.push({
              kind: "require_review",
              pattern: p,
              description: `Files matching '${p}' require review before merging`,
              source: "environment",
            });
          }
        }

        // Also check active resource claims for guarding context
        const activeClaims = sessionId ? rcList({ sessionId, status: "ACTIVE" }) : [];
        for (const claim of activeClaims) {
          for (const resource of claim.resources ?? []) {
            if (resource.scope === "file") {
              constraints.push({
                kind: "active_claim",
                pattern: resource.locator,
                description: `Currently claimed by ${claim.actorId} (task: ${claim.taskId})`,
                source: `claim:${claim.id}`,
              });
            }
          }
        }

        return ok({
          count: constraints.length,
          constraints,
          hint: "Use syncpoint_preflight to check a specific file before editing.",
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // ── Constraint check ─────────────────────────────────
  server.registerTool(
    "syncpoint_constraint_check",
    {
      title: "Check Constraints",
      description: "Check whether a specific file or path matches any active constraints. Returns warnings if the file is restricted.",
      inputSchema: {
        locator: z.string().describe("File path or glob pattern to check against constraints"),
        sessionId: z.string().optional(),
      },
    },
    async ({ locator, sessionId }) => {
      try {
        const violations: string[] = [];
        const warnings: string[] = [];

        // Check do_not_touch
        const doNotTouch = process.env.SYNCPOINT_DO_NOT_TOUCH?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
        for (const pattern of doNotTouch) {
          if (matchesGlob(locator, pattern)) {
            violations.push(`do_not_touch: ${locator} matches restricted pattern '${pattern}'`);
          }
        }

        // Check require_review
        const requireReview = process.env.SYNCPOINT_REQUIRE_REVIEW?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
        for (const pattern of requireReview) {
          if (matchesGlob(locator, pattern)) {
            warnings.push(`require_review: ${locator} matches review-required pattern '${pattern}'`);
          }
        }

        // Check active exclusive claims
        const activeClaims = sessionId ? rcList({ sessionId, status: "ACTIVE" }) : [];
        for (const claim of activeClaims) {
          for (const resource of claim.resources ?? []) {
            if (resource.scope === "file" && resource.locator === locator && (claim as any).mode === "exclusive") {
              violations.push(`active_claim: ${locator} is exclusively claimed by ${claim.actorId} (task: ${claim.taskId})`);
            }
          }
        }

        return ok({
          locator,
          safe: violations.length === 0,
          violations,
          warnings,
          suggestion: violations.length > 0
            ? `Cannot modify ${locator}: ${violations.join("; ")}`
            : warnings.length > 0
              ? `Proceed with caution: ${warnings.join("; ")}`
              : `No constraints blocking ${locator}.`,
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // ── Preflight check ──────────────────────────────────
  server.registerTool(
    "syncpoint_preflight",
    {
      title: "Preflight Check",
      description: "Run a complete pre-modification safety check on one or more files. Checks constraints, active claims, and conflicts before you edit. Always run this BEFORE modifying any file in a multi-agent project.",
      inputSchema: {
        locators: z.string().describe("Comma-separated file paths to check before modifying"),
        agentId: z.string().optional(),
        taskId: z.string().optional(),
        sessionId: z.string().optional(),
      },
    },
    async ({ locators, agentId, taskId, sessionId }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        const files = locators.split(",").map(s => s.trim()).filter(Boolean);
        const results: Array<{
          locator: string;
          safe: boolean;
          violations: string[];
          warnings: string[];
        }> = [];

        for (const file of files) {
          const fileViolations: string[] = [];
          const fileWarnings: string[] = [];

          // Check do_not_touch
          const doNotTouch = process.env.SYNCPOINT_DO_NOT_TOUCH?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
          for (const pattern of doNotTouch) {
            if (matchesGlob(file, pattern)) {
              fileViolations.push(`do_not_touch: restricted pattern '${pattern}'`);
            }
          }

          // Check active exclusive claims by OTHER agents
          const activeClaims = sessionId ? rcList({ sessionId, status: "ACTIVE" }) : [];
          for (const claim of activeClaims) {
            // Skip this agent's own claims
            if (resolved && claim.actorId === resolved) continue;
            for (const resource of claim.resources ?? []) {
              if (resource.scope === "file" && resource.locator === file) {
                if ((claim as any).mode === "exclusive") {
                  fileViolations.push(`claimed exclusively by ${claim.actorId} (${claim.taskId})`);
                } else {
                  fileWarnings.push(`shared claim by ${claim.actorId} (${claim.taskId})`);
                }
              }
            }
          }

          results.push({
            locator: file,
            safe: fileViolations.length === 0,
            violations: fileViolations,
            warnings: fileWarnings,
          });
        }

        const blockedFiles = results.filter(r => !r.safe);
        const allSafe = blockedFiles.length === 0;

        return ok({
          allSafe,
          totalFiles: files.length,
          blockedCount: blockedFiles.length,
          results,
          suggestion: allSafe
            ? "All files clear to edit."
            : `${blockedFiles.length} file(s) have restrictions. Resolve violations or coordinate with other agents before proceeding.`,
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // ── Conflict suggest ─────────────────────────────────
  server.registerTool(
    "syncpoint_conflict_suggest",
    {
      title: "Suggest Conflict Resolution",
      description: "Generate resolution suggestions for an active resource conflict. Analyzes the conflict and proposes narrowing scope, waiting, or coordinating.",
      inputSchema: {
        locator: z.string().describe("The resource locator involved in the conflict"),
        sessionId: z.string().optional(),
      },
    },
    async ({ locator, sessionId }) => {
      try {
        const conflicts = rcDetectConflicts(sessionId ? { sessionId } : undefined);
        const relevantConflicts = conflicts.filter(c =>
          c.overlappingLocator.includes(locator)
        );

        if (relevantConflicts.length === 0) {
          return ok({
            locator,
            hasConflict: false,
            message: "No active conflicts found for this resource.",
          });
        }

        const suggestions: string[] = [];
        for (const c of relevantConflicts) {
          // Analyze scope overlap for smarter suggestions
          const claimAResources = c.claimA.resources ?? [];
          const claimBResources = c.claimB.resources ?? [];
          const aHasFileScope = claimAResources.some((r: any) => (r.scope ?? "file") === "file");
          const bHasFileScope = claimBResources.some((r: any) => (r.scope ?? "file") === "file");

          if (aHasFileScope || bHasFileScope) {
            suggestions.push(
              `Conflict on '${locator}': one agent claims the entire file. ` +
              `Try narrowing to function-level scope (use --scope function --function <name>) ` +
              `to reduce false conflicts.`
            );
          } else {
            suggestions.push(
              `Conflict on '${locator}': overlapping function or line-range claims. ` +
              `Check if the agents are actually editing the same code. If not, adjust your scope.`
            );
          }

          if (c.isHardConflict) {
            suggestions.push(
              `This is a HARD conflict on '${locator}' (exclusive mode clash). ` +
              `Coordinate with ${c.claimB.actorId} (task: ${c.claimB.taskId}) or wait for their claim to be released.`
            );
          }
        }

        return ok({
          locator,
          hasConflict: true,
          conflictCount: relevantConflicts.length,
          suggestions,
          relatedAgents: [...new Set(relevantConflicts.flatMap(c => [c.claimA.actorId, c.claimB.actorId]))],
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // ── Conflict list ───────────────────────────────────
  server.registerTool(
    "syncpoint_conflict_list",
    {
      title: "List Conflicts",
      description: "List all active resource conflicts across agents. Shows overlapping claims with conflict severity (HARD/SOFT) and the agents involved.",
      inputSchema: {
        sessionId: z.string().optional(),
        resourceType: z.string().optional().describe("Filter by resource type (default: all)"),
      },
    },
    async ({ sessionId, resourceType }) => {
      try {
        const conflicts = rcDetectConflicts({ sessionId, resourceType });

        const formatted = conflicts.map(c => ({
          kind: c.isHardConflict ? "HARD" : "SOFT",
          locator: c.overlappingLocator,
          agents: [c.claimA.actorId, c.claimB.actorId],
          tasks: [c.claimA.taskId, c.claimB.taskId],
          claimIds: [c.claimA.id, c.claimB.id],
          claimAMode: (c.claimA as any).mode ?? "exclusive",
          claimBMode: (c.claimB as any).mode ?? "exclusive",
          claimAScope: c.claimA.resources?.[0]?.scope ?? "file",
          claimBScope: c.claimB.resources?.[0]?.scope ?? "file",
        }));

        return ok({
          count: formatted.length,
          hardCount: formatted.filter(c => c.kind === "HARD").length,
          softCount: formatted.filter(c => c.kind === "SOFT").length,
          conflicts: formatted,
          hint: conflicts.length > 0
            ? "Use syncpoint_conflict_suggest for resolution suggestions, or syncpoint_conflict_resolve to resolve."
            : undefined,
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // ── Conflict resolve ─────────────────────────────────
  server.registerTool(
    "syncpoint_conflict_resolve",
    {
      title: "Resolve Conflict",
      description: "Resolve an active resource conflict. Choose a strategy: release your claim (give way to other agent), force-release theirs (take ownership), or convert both to shared mode (cooperative).",
      inputSchema: {
        claimAId: z.string().describe("First claim ID from the conflict"),
        claimBId: z.string().describe("Second claim ID from the conflict"),
        resolution: z.enum(["release_claim_a", "release_claim_b", "convert_to_shared"]).describe(
          "Resolution strategy: 'release_claim_a' releases the first claim, 'release_claim_b' releases the second, 'convert_to_shared' changes both to shared mode"
        ),
      },
    },
    async ({ claimAId, claimBId, resolution }) => {
      try {
        if (resolution === "release_claim_a") {
          const released = rcRelease(claimAId);
          return ok({
            action: "release_claim_a",
            released,
            message: `Released claim ${claimAId}. Claim ${claimBId} now has sole ownership.`,
          });
        }

        if (resolution === "release_claim_b") {
          const released = rcRelease(claimBId);
          return ok({
            action: "release_claim_b",
            released,
            message: `Released claim ${claimBId}. Claim ${claimAId} now has sole ownership.`,
          });
        }

        // convert_to_shared: release and re-claim in shared mode
        // We release both and the caller should re-claim in shared mode
        return ok({
          action: "convert_to_shared",
          suggestion: "To convert to shared mode, release both claims and re-claim with mode='shared'. Use syncpoint_resource_release followed by syncpoint_resource_claim with mode=shared.",
          claimAId,
          claimBId,
          nextSteps: [
            { tool: "syncpoint_resource_release", params: { claimId: claimAId } },
            { tool: "syncpoint_resource_release", params: { claimId: claimBId } },
            { tool: "syncpoint_resource_claim", params: { mode: "shared", hint: "re-claim resources from both agents with shared mode" } },
          ],
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // ── History ──────────────────────────────────────────
  server.registerTool(
    "syncpoint_history",
    {
      title: "Query Operation History",
      description: "Query recent events in the SyncPoint system. Filter by agent, task, or event type to understand what happened.",
      inputSchema: {
        agentId: z.string().optional(),
        taskId: z.string().optional(),
        eventType: z.string().optional().describe("Filter by event type (e.g. RESOURCE_CLAIMED, SYNC_GATE_CREATED)"),
        limit: z.number().optional().describe("Max events to return (default: 20)"),
      },
    },
    async ({ agentId, taskId, eventType, limit }) => {
      try {
        // Use repository events — listEvents returns most recent first
        const { listEvents } = await import("syncpoint-server/repositories");
        const events = listEvents(limit ?? 100);

        let filtered = events;
        if (agentId) {
          const lower = agentId.toLowerCase();
          filtered = filtered.filter((e: any) =>
            (e.detail ?? "").toLowerCase().includes(lower) ||
            (e.entityId ?? "").toLowerCase().includes(lower)
          );
        }
        if (taskId) {
          filtered = filtered.filter((e: any) =>
            (e.detail ?? "").includes(taskId) ||
            (e.entityId ?? "").includes(taskId)
          );
        }
        if (eventType) {
          filtered = filtered.filter((e: any) => (e.eventType ?? e.type ?? "") === eventType);
        }

        const recent = filtered.slice(0, limit ?? 20);
        return ok({
          count: recent.length,
          totalAvailable: filtered.length,
          events: recent.map((e: any) => ({
            type: e.eventType ?? e.type,
            entity: `${e.entityType ?? ""}:${e.entityId ?? e.id ?? ""}`,
            timestamp: e.createdAt ?? e.timestamp,
            detail: e.detail,
          })),
        });
      } catch (e) {
        return fail(e);
      }
    }
  );
}

// ── Simple glob matcher ───────────────────────────────

function matchesGlob(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*")
    .replace(/\?/g, ".");
  try {
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(filePath);
  } catch {
    // If regex fails, fall back to simple includes match
    return filePath.includes(pattern.replace(/\*\*/g, "").replace(/\*/g, ""));
  }
}
