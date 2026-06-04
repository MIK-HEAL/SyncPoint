/**
 * Resolve resource types for freeform locator strings by matching
 * against the agent's active claims. Falls back to "file" when
 * no claim covers the locator.
 */
import type { ResourceRef } from "syncpoint-kernel";
import { normalizeResourcePath } from "syncpoint-kernel";
import * as protocolRepo from "../repositories/_exports/protocol.js";
import { getProjectRoot } from "./path-resolver.js";

/**
 * Convert freeform locator strings (e.g. from snapshot workingResources)
 * into typed ResourceRef[] by looking up the agent's active claims.
 * If a locator matches a claimed resource, its type is used.
 * Otherwise, defaults to "file".
 */
export function resolveResourceRefs(
  locators: string[],
  agentId: string,
): ResourceRef[] {
  if (locators.length === 0) return [];

  // Normalize locators to match claim locator format (absolute paths)
  const root = getProjectRoot();
  const normalizedLocators = locators.map(loc =>
    normalizeResourcePath(loc, { projectRoot: root }),
  );

  // Build a locator→type map from the agent's active claims
  const claims = protocolRepo.listResourceClaims({ actorId: agentId, status: "ACTIVE" });
  const typeByLocator = new Map<string, string>();
  for (const claim of claims) {
    for (const r of claim.resources) {
      typeByLocator.set(r.locator, r.type);
    }
  }

  return normalizedLocators.map(loc => ({
    type: typeByLocator.get(loc) ?? "file",
    scope: "file" as const,
    locator: loc,
    metadata: "",
  }));
}
