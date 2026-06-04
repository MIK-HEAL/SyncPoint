import { z } from "zod";
import { AgentStatus } from "./states.js";
import { AgentCapabilitySchema, AgentAvailability } from "./agent-manifest.js";
import type { AgentManifest } from "./agent-manifest.js";
import { AgentRoleSchema, UserAgentProviderSchema } from "./agent-file-manifest.js";
import type { UserAgentManifest } from "./agent-file-manifest.js";
import type { Agent } from "./models.js";
import { toUserAgentManifestFromRuntime } from "./agent-manifest-conversion.js";

export const AgentCardEndpointSchema = z.object({
  kind: z.string().min(1),
  url: z.string().min(1),
});

export type AgentCardEndpoint = z.infer<typeof AgentCardEndpointSchema>;

export const AgentCardSchema = z.object({
  schema: z.literal("syncpoint/agent-card/v1"),
  agentId: z.string().nullable().default(null),
  manifestPath: z.string().nullable().default(null),
  name: z.string().min(1),
  profile: z.string().min(1),
  role: AgentRoleSchema,
  provider: UserAgentProviderSchema,
  status: z.nativeEnum(AgentStatus).nullable().default(null),
  availability: z.nativeEnum(AgentAvailability).default(AgentAvailability.ONLINE),
  tags: z.array(z.string()).default([]),
  capabilities: z.array(AgentCapabilitySchema).default([]),
  notes: z.string().default(""),
  canHandleHumanEscalation: z.boolean().default(false),
  protocols: z.array(z.string()).default(["syncpoint", "a2a-like"]),
  endpoints: z.array(AgentCardEndpointSchema).default([]),
  metadata: z.record(z.string()).default({}),
});

export type AgentCard = z.infer<typeof AgentCardSchema>;

type AgentCardRuntimeManifestSource = Partial<
  Pick<
    AgentManifest,
    "capabilities" | "escalationPreference" | "availability" | "canHandleHumanEscalation" | "tags"
  >
>;

export interface BuildAgentCardInput {
  manifestPath?: string | null;
  agent?: Pick<Agent, "id" | "name" | "provider" | "role" | "status"> | null;
  declaredManifest?: UserAgentManifest | null;
  runtimeManifest?: AgentCardRuntimeManifestSource | null;
  endpoints?: AgentCardEndpoint[];
  metadata?: Record<string, string>;
}

export function buildAgentCard(input: BuildAgentCardInput): AgentCard {
  const manifest = resolveCardManifest(input);
  if (!manifest) {
    throw new Error("Cannot build agent card without a declared or derived manifest.");
  }

  return AgentCardSchema.parse({
    schema: "syncpoint/agent-card/v1",
    agentId: input.agent?.id ?? null,
    manifestPath: input.manifestPath ?? null,
    name: manifest.name,
    profile: manifest.profile,
    role: manifest.role,
    provider: manifest.provider,
    status: input.agent?.status ?? null,
    availability: manifest.availability,
    tags: manifest.tags,
    capabilities: manifest.capabilities,
    notes: manifest.notes,
    canHandleHumanEscalation: manifest.canHandleHumanEscalation,
    protocols: ["syncpoint", "a2a-like"],
    endpoints: input.endpoints ?? [],
    metadata: {
      source: input.declaredManifest ? "declared" : "runtime-derived",
      ...(input.metadata ?? {}),
    },
  });
}

function resolveCardManifest(input: BuildAgentCardInput): UserAgentManifest | null {
  if (input.declaredManifest) return input.declaredManifest;
  if (!input.agent) return null;
  return toUserAgentManifestFromRuntime({
    agent: input.agent,
    runtimeManifest: input.runtimeManifest,
  });
}
