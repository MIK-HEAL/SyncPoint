/**
 * P3A — Projection Service (server-side orchestrator).
 *
 * Bridges collectProjectMemories → compileProjection.
 * Read-only: never mutates capsule, checkpoint, or contract.
 */

import {
  compileProjection,
  type ProjectedReality,
  type ProjectionContext,
  type ProjectionInput,
} from "syncpoint-core";
import {
  collectProjectMemories,
  getMemoryVersion,
} from "../repositories.js";

/**
 * Build a projected reality for a given task.
 * Orchestrates: collect canonical memories → compile projection.
 */
export function buildProjection(ctx: Omit<ProjectionContext, "memoryVersion">): ProjectedReality {
  const memoryVersion = getMemoryVersion();
  const collected = collectProjectMemories(ctx.taskId);

  // Map CollectedMemory → ProjectionInput
  const inputs: ProjectionInput[] = collected.map(m => ({
    id: m.id,
    category: m.category,
    title: m.title,
    content: m.content,
    fingerprint: m.fingerprint,
    kind: m.kind,
    projectionTarget: m.projectionTarget,
    appliesTo: m.appliesTo,
    severity: m.severity,
    validityStatus: m.validityStatus,
  }));

  return compileProjection(inputs, { ...ctx, memoryVersion });
}
