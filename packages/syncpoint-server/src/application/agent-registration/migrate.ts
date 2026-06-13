import fs from "node:fs";
import path from "node:path";
import {
  detectUserAgentManifestFormatFromPath,
  toUserAgentManifestFromRuntime,
} from "syncpoint-adapters";
import { ResourceNotFoundError } from "syncpoint-kernel";
import {
  listAgents,
} from "../../repositories/_exports/foundation.js";
import {
  getAgentManifest,
} from "../../repositories/_exports/runtime.js";
import {
  getAgentRegistryEntryByAgentId,
} from "../../repositories/agent-registry-repository.js";
import { syncDeclaredAgentFile } from "../agent-registry-service.js";
import {
  absolutePathFromStoredProjectPath,
  persistDeclaredManifest,
  slugify,
} from "./filesystem.js";
import type {
  MigrateRuntimeAgentsInput,
  MigrateRuntimeAgentsResult,
  RuntimeAgentMigrationItem,
} from "./types.js";

export function migrateRuntimeAgentsToDeclaredManifests(
  input: MigrateRuntimeAgentsInput = {},
): MigrateRuntimeAgentsResult {
  const selectedIds = input.agentIds ? new Set(input.agentIds) : null;
  const items = listAgents()
    .filter(agent => !selectedIds || selectedIds.has(agent.id))
    .map(agent => migrateOneRuntimeAgent(agent.id, input));

  return {
    items,
  };
}

function migrateOneRuntimeAgent(
  agentId: string,
  input: MigrateRuntimeAgentsInput,
): RuntimeAgentMigrationItem {
  const agent = listAgents().find(entry => entry.id === agentId);
  if (!agent) {
    throw new ResourceNotFoundError(agentId);
  }

  const runtimeManifest = getAgentManifest(agent.id) ?? null;
  const manifest = toUserAgentManifestFromRuntime({
    agent,
    runtimeManifest,
  });
  const existingEntry = getAgentRegistryEntryByAgentId(agent.id);

  if (existingEntry?.manifestPath) {
    const existingPath = absolutePathFromStoredProjectPath(existingEntry.manifestPath);
    const existingFormat = detectUserAgentManifestFormatFromPath(existingPath) ?? input.format ?? "yaml";

    if (fs.existsSync(existingPath) && input.force !== true) {
      const syncedRecord = input.sync === false ? null : syncDeclaredAgentFile(existingPath);
      return {
        agentId: agent.id,
        agentName: agent.name,
        filePath: existingPath,
        manifestPath: existingEntry.manifestPath,
        format: existingFormat,
        manifest,
        syncedRecord,
        written: false,
        skipped: true,
      };
    }

    const rewritten = persistDeclaredManifest({
      manifest,
      fileStem: path.parse(existingPath).name,
      format: input.format ?? existingFormat,
      sync: input.sync,
      force: true,
      preferredPath: existingPath,
    });

    return {
      agentId: agent.id,
      agentName: agent.name,
      skipped: false,
      ...rewritten,
    };
  }

  const written = persistDeclaredManifest({
    manifest,
    fileStem: slugify(agent.name),
    format: input.format ?? "yaml",
    sync: input.sync,
    force: input.force,
  });

  return {
    agentId: agent.id,
    agentName: agent.name,
    skipped: false,
    ...written,
  };
}
