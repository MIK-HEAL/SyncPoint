import { buildAgentCard } from "syncpoint-adapters";
import { getAgent, getAgentByName, listAgents } from "../../repositories/_exports/foundation.js";
import { getAgentManifest } from "../../repositories/_exports/runtime.js";
import { listDeclaredAgents, syncDeclaredAgents } from "../agent-registry-service.js";
import type {
  ExportAgentCardsInput,
  ExportAgentCardsResult,
  ExportedAgentCardRecord,
} from "./types.js";

export function exportAgentCards(
  input: ExportAgentCardsInput = {},
): ExportAgentCardsResult {
  if (input.sync !== false) {
    syncDeclaredAgents();
  }

  const declaredRecords = listDeclaredAgents({ includeRemoved: input.includeRemoved });
  const requestedIds = input.agentIds ? new Set(input.agentIds) : null;
  const matchedDeclared = new Set<string>();
  const cards: ExportedAgentCardRecord[] = [];

  for (const record of declaredRecords) {
    if (record.status === "removed" && input.includeRemoved !== true) continue;
    if (requestedIds && (!record.agentId || !requestedIds.has(record.agentId))) continue;
    if (record.agentId) matchedDeclared.add(record.agentId);

    const agent = record.agentId ? tryGetAgent(record.agentId) : null;
    const runtimeManifest = record.agentId ? getAgentManifest(record.agentId) ?? null : null;

    cards.push({
      agentId: record.agentId,
      manifestPath: record.manifestPath,
      status: record.status,
      card: buildAgentCard({
        manifestPath: record.manifestPath,
        agent,
        declaredManifest: record.manifest,
        runtimeManifest,
        metadata: {
          registryStatus: record.status,
        },
      }),
    });
  }

  if (requestedIds) {
    for (const agentId of requestedIds) {
      if (matchedDeclared.has(agentId)) continue;
      const agent = tryGetAgent(agentId);
      if (!agent) continue;
      cards.push({
        agentId: agent.id,
        manifestPath: null,
        status: "active",
        card: buildAgentCard({
          agent,
          runtimeManifest: getAgentManifest(agent.id) ?? null,
          metadata: {
            registryStatus: "runtime-only",
          },
        }),
      });
    }
  }

  return {
    cards,
  };
}

export function resolveAgentIdsForCardExport(rawValues: string[]): string[] {
  return rawValues.map(value => {
    const direct = tryGetAgent(value);
    if (direct) return direct.id;
    const named = getAgentByName(value);
    if (named) return named.id;
    throw new Error(`Agent not found: ${value}`);
  });
}

export function listRuntimeAgentIds(): string[] {
  return listAgents().map(agent => agent.id);
}

function tryGetAgent(agentId: string) {
  try {
    return getAgent(agentId);
  } catch {
    return null;
  }
}
