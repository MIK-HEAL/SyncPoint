import { AgentAvailability, DEFAULT_AGENT_MANIFEST } from "./agent-manifest.js";
import type { AgentManifest } from "./agent-manifest.js";
import { createUserAgentManifestTemplate } from "./agent-file-manifest.js";
import type { UserAgentManifest, UserAgentManifestInput } from "./agent-file-manifest.js";
import type { Agent } from "./models.js";

type RuntimeAgentIdentity = Pick<Agent, "name" | "provider" | "role">;
type RuntimeAgentManifestSource = Partial<
  Pick<
    AgentManifest,
    "capabilities" | "escalationPreference" | "availability" | "canHandleHumanEscalation" | "tags"
  >
>;

export interface RuntimeToUserAgentManifestInput {
  agent: RuntimeAgentIdentity;
  runtimeManifest?: RuntimeAgentManifestSource | null;
  overrides?: Partial<UserAgentManifestInput>;
}

export function toUserAgentManifestFromRuntime(
  input: RuntimeToUserAgentManifestInput,
): UserAgentManifest {
  const runtimeManifest = input.runtimeManifest ?? {};
  const overrides = input.overrides ?? {};

  return createUserAgentManifestTemplate({
    version: overrides.version ?? 1,
    name: overrides.name ?? input.agent.name,
    profile: overrides.profile ?? input.agent.role,
    provider: overrides.provider ?? input.agent.provider,
    role: overrides.role ?? input.agent.role,
    tags: overrides.tags ?? runtimeManifest.tags ?? DEFAULT_AGENT_MANIFEST.tags,
    capabilities: overrides.capabilities ?? runtimeManifest.capabilities ?? DEFAULT_AGENT_MANIFEST.capabilities,
    availability: overrides.availability ?? runtimeManifest.availability ?? AgentAvailability.ONLINE,
    autoStart: overrides.autoStart ?? false,
    notes: overrides.notes ?? "",
    escalationPreference: overrides.escalationPreference
      ?? runtimeManifest.escalationPreference
      ?? DEFAULT_AGENT_MANIFEST.escalationPreference,
    canHandleHumanEscalation: overrides.canHandleHumanEscalation
      ?? runtimeManifest.canHandleHumanEscalation
      ?? false,
  });
}
