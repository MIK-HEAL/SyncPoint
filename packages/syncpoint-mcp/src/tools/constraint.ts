/**
 * MCP tools for constraint management and preflight checks.
 *
 * syncpoint_constraint_list  — list active constraint rules
 * syncpoint_constraint_check — check if a file/path matches constraints
 * syncpoint_preflight        — pre-modification safety check
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { rcList } from "syncpoint-server/application";
import { resolveBoundAgentId } from "../identity.js";
import { fail, ok } from "./_shared.js";
import { matchesGlob } from "./constraint-glob.js";
import { registerConflictTools } from "./constraint-conflicts.js";

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
    "syncpoint_constraint_path_check",
    {
      title: "Check Constraints",
      description: "Check whether a specific file or path matches any active constraints. Returns warnings if the file is restricted.",
      inputSchema: {
        locator: z.string().min(1).describe("File path or glob pattern to check against constraints"),
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
            if (resource.scope === "file" && resource.locator === locator && claim.mode === "exclusive") {
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
                if (claim.mode === "exclusive") {
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

  registerConflictTools(server);
}
