import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import {
  AgentAvailability,
  AgentCapabilitySchema,
  EscalationPreferenceSchema,
} from "./agent-manifest.js";
import type { AgentCapability, AgentManifest, EscalationPreference } from "./agent-manifest.js";
import type { AgentCreate } from "./models.js";

export const AGENT_PROVIDER_VALUES = [
  "codex",
  "claude-code",
  "cursor",
  "cline",
  "copilot",
  "human",
  "other",
] as const;

export const AgentProviderSchema = z.enum(AGENT_PROVIDER_VALUES);

export type AgentProvider = z.infer<typeof AgentProviderSchema>;

export const AGENT_ROLE_VALUES = [
  "manager",
  "frontend",
  "backend",
  "tester",
  "reviewer",
  "other",
] as const;

export const AgentRoleSchema = z.enum(AGENT_ROLE_VALUES);

export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const USER_AGENT_PROVIDER_VALUES = [...AGENT_PROVIDER_VALUES, "auto_detect"] as const;

export const UserAgentProviderSchema = z.enum(USER_AGENT_PROVIDER_VALUES);

export type UserAgentProvider = z.infer<typeof UserAgentProviderSchema>;

export const AgentManifestFileFormatSchema = z.enum(["yaml", "json"]);

export type AgentManifestFileFormat = z.infer<typeof AgentManifestFileFormatSchema>;

export const AGENT_MANIFEST_FILE_EXTENSIONS = [".yml", ".yaml", ".json"] as const;

export const AgentManifestCapabilityInputSchema = z.union([
  z.string().min(1),
  AgentCapabilitySchema,
]);

export type AgentManifestCapabilityInput = z.infer<typeof AgentManifestCapabilityInputSchema>;

const UserAgentManifestBodySchema = z.object({
  version: z.coerce.number().int().min(1).default(1),
  name: z.string().min(1),
  profile: z.string().min(1).default("general"),
  provider: UserAgentProviderSchema.default("other"),
  role: AgentRoleSchema.optional(),
  tags: z.array(z.string()).default([]),
  capabilities: z.array(AgentManifestCapabilityInputSchema).default([]),
  availability: z.nativeEnum(AgentAvailability).default(AgentAvailability.ONLINE),
  autoStart: z.boolean().default(false),
  notes: z.string().default(""),
  escalationPreference: EscalationPreferenceSchema.default({}),
  canHandleHumanEscalation: z.boolean().default(false),
});

export const UserAgentManifestSchema = UserAgentManifestBodySchema.transform(input => ({
  version: input.version,
  name: input.name.trim(),
  profile: input.profile.trim(),
  provider: input.provider,
  role: resolveAgentRole(input.role, input.profile),
  tags: normalizeStringList(input.tags),
  capabilities: input.capabilities.map(normalizeCapability),
  availability: input.availability,
  autoStart: input.autoStart,
  notes: input.notes.trim(),
  escalationPreference: EscalationPreferenceSchema.parse(input.escalationPreference),
  canHandleHumanEscalation: input.canHandleHumanEscalation,
}));

export type UserAgentManifest = z.infer<typeof UserAgentManifestSchema>;
export type UserAgentManifestInput = z.input<typeof UserAgentManifestSchema>;

export function parseUserAgentManifestObject(input: unknown): UserAgentManifest {
  return UserAgentManifestSchema.parse(extractUserAgentManifestBody(input));
}

export function parseUserAgentManifestContent(
  content: string,
  format?: AgentManifestFileFormat,
): UserAgentManifest {
  const trimmed = content.trim();
  const resolvedFormat = format ?? detectUserAgentManifestFormatFromContent(trimmed);
  const parsed = resolvedFormat === "json"
    ? JSON.parse(trimmed)
    : parseYaml(trimmed);
  return parseUserAgentManifestObject(parsed);
}

export function createUserAgentManifestTemplate(
  overrides: Partial<UserAgentManifestInput> & Pick<UserAgentManifestInput, "name">,
): UserAgentManifest {
  return parseUserAgentManifestObject(overrides);
}

export function serializeUserAgentManifest(
  input: UserAgentManifest | UserAgentManifestInput,
  format: AgentManifestFileFormat = "yaml",
): string {
  const manifest = isUserAgentManifest(input)
    ? input
    : parseUserAgentManifestObject(input);
  const document = {
    version: manifest.version,
    agent: {
      name: manifest.name,
      profile: manifest.profile,
      provider: manifest.provider,
      role: manifest.role,
      tags: manifest.tags,
      capabilities: manifest.capabilities,
      availability: manifest.availability,
      autoStart: manifest.autoStart,
      notes: manifest.notes,
      escalationPreference: manifest.escalationPreference,
      canHandleHumanEscalation: manifest.canHandleHumanEscalation,
    },
  };

  if (format === "json") return `${JSON.stringify(document, null, 2)}\n`;
  return stringifyYaml(document);
}

export function resolveAgentProvider(provider: UserAgentProvider): AgentProvider {
  return provider === "auto_detect" ? "other" : provider;
}

export function resolveAgentRole(role: AgentRole | undefined, profile: string): AgentRole {
  if (role) return role;

  const normalized = profile.trim().toLowerCase();
  if (["manager", "architect", "lead", "owner"].includes(normalized)) return "manager";
  if (["frontend", "ui", "design-system"].includes(normalized)) return "frontend";
  if (["backend", "executor", "implementer", "developer"].includes(normalized)) return "backend";
  if (["tester", "qa", "quality"].includes(normalized)) return "tester";
  if (["reviewer", "review", "auditor"].includes(normalized)) return "reviewer";
  return "other";
}

export function toAgentCreateFromUserAgentManifest(manifest: UserAgentManifest): AgentCreate {
  return {
    name: manifest.name,
    provider: resolveAgentProvider(manifest.provider),
    role: manifest.role,
  };
}

export function toRuntimeAgentManifestInputFromUserAgentManifest(
  manifest: UserAgentManifest,
): Omit<AgentManifest, "agentId"> {
  return {
    capabilities: manifest.capabilities,
    escalationPreference: manifest.escalationPreference,
    availability: manifest.availability,
    canHandleHumanEscalation: manifest.canHandleHumanEscalation,
    tags: manifest.tags,
  };
}

export function detectUserAgentManifestFormatFromPath(
  filePath: string,
): AgentManifestFileFormat | undefined {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".json")) return "json";
  if (normalized.endsWith(".yml") || normalized.endsWith(".yaml")) return "yaml";
  return undefined;
}

export function isSupportedUserAgentManifestPath(filePath: string): boolean {
  return detectUserAgentManifestFormatFromPath(filePath) !== undefined;
}

function detectUserAgentManifestFormatFromContent(content: string): AgentManifestFileFormat {
  return content.startsWith("{") || content.startsWith("[") ? "json" : "yaml";
}

function extractUserAgentManifestBody(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const nested = isRecord(input.agent) ? input.agent : input;
  if (!isRecord(nested)) return nested;
  return {
    ...nested,
    version: nested.version ?? input.version,
  };
}

function normalizeCapability(input: AgentManifestCapabilityInput): AgentCapability {
  if (typeof input === "string") {
    return AgentCapabilitySchema.parse({
      domain: input.trim(),
      skills: [],
      resourceTypes: [],
    });
  }

  return AgentCapabilitySchema.parse({
    ...input,
    domain: input.domain.trim(),
    skills: normalizeStringList(input.skills),
    resourceTypes: normalizeStringList(input.resourceTypes),
  });
}

function normalizeStringList(input: string[]): string[] {
  return Array.from(new Set(input.map(item => item.trim()).filter(Boolean)));
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isUserAgentManifest(input: unknown): input is UserAgentManifest {
  return UserAgentManifestSchema.safeParse(input).success;
}
