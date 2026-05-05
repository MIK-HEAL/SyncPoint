/**
 * StateSnapshot — generic actor state snapshot.
 *
 * A point-in-time snapshot of an actor's work state, referencing
 * the resources they are working with. Generalizes checkpoint +
 * capsule concepts for any resource type.
 */

import { z } from "zod";
import { ResourceRefSchema } from "./resource.js";

// ── Schema ──────────────────────────────────────────

export const StateSnapshotSchema = z.object({
  id: z.string(),
  actorId: z.string(),
  taskId: z.string(),
  sessionId: z.string().default(""),
  summary: z.string(),
  resourceRefs: z.array(ResourceRefSchema),
  createdAt: z.string(),
});

export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

export const StateSnapshotCreateSchema = z.object({
  actorId: z.string(),
  taskId: z.string(),
  sessionId: z.string().optional(),
  summary: z.string().min(1),
  resourceRefs: z.array(ResourceRefSchema).default([]),
});

export type StateSnapshotCreate = z.infer<typeof StateSnapshotCreateSchema>;
