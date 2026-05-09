/**
 * Agent Manifest — declares an agent's capabilities, escalation preferences,
 * and availability for escalation routing.
 *
 * When a SyncGate escalates, the routing logic uses manifests to determine
 * which agents can handle the escalation based on:
 *   - capabilities (what domains/skills the agent covers)
 *   - escalation preferences (opt-in/out, priority)
 *   - availability (online/offline, schedule)
 *   - role suitability (manager, reviewer, human)
 */

import { z } from "zod";

// ── Capability ──────────────────────────────────────

export const AgentCapabilitySchema = z.object({
  domain: z.string(),
  skills: z.array(z.string()).default([]),
  resourceTypes: z.array(z.string()).default([]),
});

export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

// ── Escalation preference ───────────────────────────

export enum EscalationOptIn {
  ALWAYS = "always",
  WHEN_AVAILABLE = "when_available",
  NEVER = "never",
}

export const EscalationPreferenceSchema = z.object({
  optIn: z.nativeEnum(EscalationOptIn).default(EscalationOptIn.WHEN_AVAILABLE),
  priority: z.number().int().min(0).max(100).default(50),
  maxConcurrentEscalations: z.number().int().min(0).default(3),
});

export type EscalationPreference = z.infer<typeof EscalationPreferenceSchema>;

// ── Availability ─────────────────────────────────────

export enum AgentAvailability {
  ONLINE = "online",
  BUSY = "busy",
  OFFLINE = "offline",
}

// ── Agent Manifest ──────────────────────────────────

export const AgentManifestSchema = z.object({
  agentId: z.string(),
  capabilities: z.array(AgentCapabilitySchema).default([]),
  escalationPreference: EscalationPreferenceSchema.default({}),
  availability: z.nativeEnum(AgentAvailability).default(AgentAvailability.ONLINE),
  canHandleHumanEscalation: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

export type AgentManifest = z.infer<typeof AgentManifestSchema>;

export const DEFAULT_AGENT_MANIFEST: Omit<AgentManifest, "agentId"> = {
  capabilities: [],
  escalationPreference: {
    optIn: EscalationOptIn.WHEN_AVAILABLE,
    priority: 50,
    maxConcurrentEscalations: 3,
  },
  availability: AgentAvailability.ONLINE,
  canHandleHumanEscalation: false,
  tags: [],
};

// ── Escalation routing ──────────────────────────────

export interface EscalationCandidate {
  agentId: string;
  manifest: AgentManifest;
  score: number;
  reason: string;
}

export interface EscalationRoutingInput {
  gateId: string;
  taskId?: string;
  reason: string;
  requiredAgentIds: string[];
  escalationAgentIds: string[];
  requiresHuman: boolean;
  relatedDomains?: string[];
  relatedResourceTypes?: string[];
}

/**
 * Score and rank agents for handling an escalation.
 *
 * Priority order:
 *   1. Explicit escalation agents (from gate policy)
 *   2. Human-capable agents (if requiresHuman)
 *   3. Domain/skill match
 *   4. Available agents with highest priority
 *
 * Filters out:
 *   - Agents that opted out (NEVER)
 *   - Agents that are OFFLINE (unless optIn=ALWAYS)
 *   - Agents already at max concurrent escalations
 */
export function routeEscalation(
  input: EscalationRoutingInput,
  manifests: AgentManifest[],
  activeEscalationCounts: Map<string, number>,
): EscalationCandidate[] {
  const candidates: EscalationCandidate[] = [];

  for (const m of manifests) {
    // Filter: opted out
    if (m.escalationPreference.optIn === EscalationOptIn.NEVER) continue;

    // Filter: offline and not ALWAYS
    if (m.availability === AgentAvailability.OFFLINE &&
        m.escalationPreference.optIn !== EscalationOptIn.ALWAYS) continue;

    // Filter: at max concurrent
    const currentCount = activeEscalationCounts.get(m.agentId) ?? 0;
    if (currentCount >= m.escalationPreference.maxConcurrentEscalations) continue;

    // Filter: skip agents already required on this gate (they're the ones who couldn't resolve it)
    if (input.requiredAgentIds.includes(m.agentId)) continue;

    let score = 0;
    const reasons: string[] = [];

    // Boost: explicit escalation agent
    if (input.escalationAgentIds.includes(m.agentId)) {
      score += 100;
      reasons.push("explicit escalation target");
    }

    // Boost: human-capable when human required
    if (input.requiresHuman && m.canHandleHumanEscalation) {
      score += 80;
      reasons.push("can handle human escalation");
    }

    // Boost: domain match
    if (input.relatedDomains?.length) {
      const matchingDomains = m.capabilities.filter(c =>
        input.relatedDomains!.includes(c.domain)
      );
      if (matchingDomains.length > 0) {
        score += 30 * matchingDomains.length;
        reasons.push(`domain match: ${matchingDomains.map(c => c.domain).join(", ")}`);
      }
    }

    // Boost: resource type match
    if (input.relatedResourceTypes?.length) {
      const matchingResTypes = m.capabilities.filter(c =>
        c.resourceTypes.some(rt => input.relatedResourceTypes!.includes(rt))
      );
      if (matchingResTypes.length > 0) {
        score += 20 * matchingResTypes.length;
        reasons.push("resource type match");
      }
    }

    // Base: priority from preference
    score += m.escalationPreference.priority;

    // Penalty: busy
    if (m.availability === AgentAvailability.BUSY) {
      score -= 20;
      reasons.push("busy");
    }

    // Penalty: already handling escalations
    if (currentCount > 0) {
      score -= 10 * currentCount;
      reasons.push(`${currentCount} active escalation(s)`);
    }

    if (score > 0 || input.escalationAgentIds.includes(m.agentId)) {
      candidates.push({
        agentId: m.agentId,
        manifest: m,
        score,
        reason: reasons.join("; ") || "default routing",
      });
    }
  }

  // Sort descending by score
  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}
