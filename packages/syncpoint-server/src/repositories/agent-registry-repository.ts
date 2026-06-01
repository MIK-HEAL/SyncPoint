import { eq } from "drizzle-orm";
import { AgentManifestFileFormatSchema, UserAgentManifestSchema } from "syncpoint-core";
import type { AgentManifestFileFormat, UserAgentManifest } from "syncpoint-core";
import * as schema from "../schema.js";
import { _getDb, now } from "./_shared.js";

export const AGENT_REGISTRY_ENTRY_STATUS_VALUES = ["pending", "active", "error", "removed"] as const;

export type AgentRegistryEntryStatus = typeof AGENT_REGISTRY_ENTRY_STATUS_VALUES[number];

export interface AgentRegistryEntry {
  manifestPath: string;
  agentId: string | null;
  sourceFormat: AgentManifestFileFormat | null;
  contentHash: string;
  manifest: UserAgentManifest | null;
  status: AgentRegistryEntryStatus;
  errorMessage: string;
  lastSyncAt: string;
  createdAt: string;
  updatedAt: string;
}

interface UpsertAgentRegistryEntryInput {
  manifestPath: string;
  agentId?: string | null;
  sourceFormat?: AgentManifestFileFormat | null;
  contentHash?: string;
  manifest?: UserAgentManifest | null;
  status?: AgentRegistryEntryStatus;
  errorMessage?: string;
  lastSyncAt?: string;
}

function parseManifestJson(value: import("syncpoint-core").UserAgentManifest | null): import("syncpoint-core").UserAgentManifest | null {
  if (!value) return null;
  try {
    return UserAgentManifestSchema.parse(value);
  } catch {
    return null;
  }
}

function hydrateAgentRegistryEntry(
  row: typeof schema.agentRegistryEntries.$inferSelect,
): AgentRegistryEntry {
  const sourceFormat = row.sourceFormat
    ? AgentManifestFileFormatSchema.safeParse(row.sourceFormat)
    : { success: false } as const;

  return {
    manifestPath: row.manifestPath,
    agentId: row.agentId ?? null,
    sourceFormat: sourceFormat.success ? sourceFormat.data : null,
    contentHash: row.contentHash,
    manifest: parseManifestJson(row.manifestJson),
    status: isRegistryEntryStatus(row.status) ? row.status : "pending",
    errorMessage: row.errorMessage,
    lastSyncAt: row.lastSyncAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getAgentRegistryEntry(manifestPath: string): AgentRegistryEntry | undefined {
  const row = _getDb()
    .select()
    .from(schema.agentRegistryEntries)
    .where(eq(schema.agentRegistryEntries.manifestPath, manifestPath))
    .get();

  return row ? hydrateAgentRegistryEntry(row) : undefined;
}

export function getAgentRegistryEntryByAgentId(agentId: string): AgentRegistryEntry | undefined {
  const row = _getDb()
    .select()
    .from(schema.agentRegistryEntries)
    .where(eq(schema.agentRegistryEntries.agentId, agentId))
    .get();

  return row ? hydrateAgentRegistryEntry(row) : undefined;
}

export function listAgentRegistryEntries(): AgentRegistryEntry[] {
  return _getDb()
    .select()
    .from(schema.agentRegistryEntries)
    .all()
    .map(hydrateAgentRegistryEntry)
    .sort((a, b) => a.manifestPath.localeCompare(b.manifestPath));
}

export function upsertAgentRegistryEntry(input: UpsertAgentRegistryEntryInput): AgentRegistryEntry {
  const db = _getDb();
  const ts = now();
  const existing = getAgentRegistryEntry(input.manifestPath);

  if (existing) {
    db.update(schema.agentRegistryEntries)
      .set({
        agentId: input.agentId === undefined ? existing.agentId : input.agentId,
        sourceFormat: input.sourceFormat === undefined
          ? existing.sourceFormat ?? ""
          : input.sourceFormat ?? "",
        contentHash: input.contentHash ?? existing.contentHash,
        manifestJson: input.manifest === undefined
          ? existing.manifest ?? null
          : input.manifest ?? null,
        status: input.status ?? existing.status,
        errorMessage: input.errorMessage ?? existing.errorMessage,
        lastSyncAt: input.lastSyncAt ?? ts,
        updatedAt: ts,
      })
      .where(eq(schema.agentRegistryEntries.manifestPath, input.manifestPath))
      .run();

    return getAgentRegistryEntry(input.manifestPath)!;
  }

  db.insert(schema.agentRegistryEntries)
    .values({
      manifestPath: input.manifestPath,
      agentId: input.agentId ?? null,
      sourceFormat: input.sourceFormat ?? "",
      contentHash: input.contentHash ?? "",
      manifestJson: input.manifest ?? null,
      status: input.status ?? "pending",
      errorMessage: input.errorMessage ?? "",
      lastSyncAt: input.lastSyncAt ?? ts,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();

  return getAgentRegistryEntry(input.manifestPath)!;
}

function isRegistryEntryStatus(input: string): input is AgentRegistryEntryStatus {
  return AGENT_REGISTRY_ENTRY_STATUS_VALUES.includes(input as AgentRegistryEntryStatus);
}
