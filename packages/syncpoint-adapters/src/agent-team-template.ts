import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { AgentAvailability, EscalationPreferenceSchema } from "./agent-manifest.js";
import {
  AgentManifestCapabilityInputSchema,
  AgentManifestFileFormatSchema,
  AgentRoleSchema,
  UserAgentProviderSchema,
  createUserAgentManifestTemplate,
  resolveAgentRole,
} from "./agent-file-manifest.js";
import type {
  AgentManifestCapabilityInput,
  AgentManifestFileFormat,
  UserAgentManifest,
  UserAgentManifestInput,
  UserAgentProvider,
} from "./agent-file-manifest.js";
import { InternalError, ValidationError } from "syncpoint-kernel";

const AgentTeamMemberTemplateBodySchema = z.object({
  key: z.string().min(1).optional(),
  name: z.string().min(1),
  profile: z.string().min(1).default("general"),
  provider: UserAgentProviderSchema.default("auto_detect"),
  role: AgentRoleSchema.optional(),
  tags: z.array(z.string()).default([]),
  capabilities: z.array(AgentManifestCapabilityInputSchema).default([]),
  availability: z.nativeEnum(AgentAvailability).default(AgentAvailability.ONLINE),
  autoStart: z.boolean().default(false),
  notes: z.string().default(""),
  escalationPreference: EscalationPreferenceSchema.default({}),
  canHandleHumanEscalation: z.boolean().default(false),
});

export const AgentTeamMemberTemplateSchema = AgentTeamMemberTemplateBodySchema.transform(member => ({
  key: slugify(member.key ?? member.name),
  name: member.name.trim(),
  profile: member.profile.trim(),
  provider: member.provider,
  role: resolveAgentRole(member.role, member.profile),
  tags: normalizeStringList(member.tags),
  capabilities: member.capabilities,
  availability: member.availability,
  autoStart: member.autoStart,
  notes: member.notes.trim(),
  escalationPreference: EscalationPreferenceSchema.parse(member.escalationPreference),
  canHandleHumanEscalation: member.canHandleHumanEscalation,
}));

export type AgentTeamMemberTemplate = z.infer<typeof AgentTeamMemberTemplateSchema>;

const AgentTeamTemplateBodySchema = z.object({
  version: z.coerce.number().int().min(1).default(1),
  name: z.string().min(1),
  description: z.string().default(""),
  members: z.array(AgentTeamMemberTemplateSchema).min(1),
});

export const AgentTeamTemplateSchema = AgentTeamTemplateBodySchema.transform(template => ({
  version: template.version,
  name: template.name.trim(),
  description: template.description.trim(),
  members: ensureUniqueMemberKeys(template.members),
}));

export type AgentTeamTemplate = z.infer<typeof AgentTeamTemplateSchema>;
export type AgentTeamTemplateInput = z.input<typeof AgentTeamTemplateSchema>;

export interface MaterializeAgentTeamTemplateOptions {
  namePrefix?: string;
  defaultProvider?: UserAgentProvider;
}

export interface MaterializedAgentManifest {
  key: string;
  fileStem: string;
  manifest: UserAgentManifest;
}

export interface BuiltInAgentTeamTemplate {
  id: string;
  title: string;
  description: string;
  template: AgentTeamTemplate;
}

const BUILT_IN_AGENT_TEAM_TEMPLATES: BuiltInAgentTeamTemplate[] = [
  {
    id: "delivery-pod",
    title: "Delivery Pod",
    description: "Balanced delivery team with manager, builders, and reviewer.",
    template: createAgentTeamTemplate({
      name: "Delivery Pod",
      description: "Manager-led delivery pod for product work.",
      members: [
        {
          key: "architect",
          name: "architect",
          profile: "manager",
          role: "manager",
          provider: "auto_detect",
          tags: ["coordination", "planning"],
          capabilities: ["architecture", "planning"],
          canHandleHumanEscalation: true,
          notes: "Coordinates task boundaries and final decisions.",
        },
        {
          key: "backend-executor",
          name: "backend-executor",
          profile: "backend",
          role: "backend",
          provider: "auto_detect",
          tags: ["backend", "api"],
          capabilities: ["api", "service"],
          notes: "Owns server-side implementation.",
        },
        {
          key: "frontend-executor",
          name: "frontend-executor",
          profile: "frontend",
          role: "frontend",
          provider: "auto_detect",
          tags: ["frontend", "ui"],
          capabilities: ["ui", "interaction"],
          notes: "Owns user-facing polish and flows.",
        },
        {
          key: "reviewer",
          name: "reviewer",
          profile: "reviewer",
          role: "reviewer",
          provider: "auto_detect",
          tags: ["review", "quality"],
          capabilities: ["review", "quality"],
          notes: "Checks correctness and collaboration safety.",
        },
      ],
    }),
  },
  {
    id: "lean-pair",
    title: "Lean Pair",
    description: "Small team for fast solo or pair execution.",
    template: createAgentTeamTemplate({
      name: "Lean Pair",
      description: "Minimal manager + executor pair.",
      members: [
        {
          key: "lead",
          name: "lead",
          profile: "manager",
          role: "manager",
          provider: "auto_detect",
          tags: ["lead", "coordination"],
          capabilities: ["planning"],
          canHandleHumanEscalation: true,
          notes: "Keeps the plan and checkpoints aligned.",
        },
        {
          key: "executor",
          name: "executor",
          profile: "backend",
          role: "backend",
          provider: "auto_detect",
          tags: ["implementation"],
          capabilities: ["implementation"],
          notes: "Executes the main task path.",
        },
      ],
    }),
  },
];

export function parseAgentTeamTemplateObject(input: unknown): AgentTeamTemplate {
  return AgentTeamTemplateSchema.parse(extractAgentTeamTemplateBody(input));
}

export function parseAgentTeamTemplateContent(
  content: string,
  format?: AgentManifestFileFormat,
): AgentTeamTemplate {
  const trimmed = content.trim();
  const resolvedFormat = format ?? detectDocumentFormat(trimmed);
  const parsed = resolvedFormat === "json"
    ? JSON.parse(trimmed)
    : parseYaml(trimmed);
  return parseAgentTeamTemplateObject(parsed);
}

export function createAgentTeamTemplate(
  input: AgentTeamTemplateInput,
): AgentTeamTemplate {
  return parseAgentTeamTemplateObject(input);
}

export function serializeAgentTeamTemplate(
  input: AgentTeamTemplate | AgentTeamTemplateInput,
  format: AgentManifestFileFormat = "yaml",
): string {
  const template = AgentTeamTemplateSchema.parse(input);
  const document = {
    version: template.version,
    team: {
      name: template.name,
      description: template.description,
      members: template.members.map(member => ({
        key: member.key,
        name: member.name,
        profile: member.profile,
        provider: member.provider,
        role: member.role,
        tags: member.tags,
        capabilities: member.capabilities,
        availability: member.availability,
        autoStart: member.autoStart,
        notes: member.notes,
        escalationPreference: member.escalationPreference,
        canHandleHumanEscalation: member.canHandleHumanEscalation,
      })),
    },
  };

  if (format === "json") return `${JSON.stringify(document, null, 2)}\n`;
  return stringifyYaml(document);
}

export function materializeAgentTeamTemplate(
  template: AgentTeamTemplate,
  options: MaterializeAgentTeamTemplateOptions = {},
): MaterializedAgentManifest[] {
  return template.members.map(member => {
    const name = joinNamePrefix(options.namePrefix, member.name);
    return {
      key: member.key,
      fileStem: slugify(joinNamePrefix(options.namePrefix, member.key)),
      manifest: createUserAgentManifestTemplate({
        version: template.version,
        name,
        profile: member.profile,
        provider: options.defaultProvider ?? member.provider,
        role: member.role,
        tags: member.tags,
        capabilities: member.capabilities,
        availability: member.availability,
        autoStart: member.autoStart,
        notes: member.notes,
        escalationPreference: member.escalationPreference,
        canHandleHumanEscalation: member.canHandleHumanEscalation,
      }),
    };
  });
}

export function listBuiltInAgentTeamTemplates(): BuiltInAgentTeamTemplate[] {
  return BUILT_IN_AGENT_TEAM_TEMPLATES.map(entry => ({
    ...entry,
    template: createAgentTeamTemplate(entry.template),
  }));
}

export function getBuiltInAgentTeamTemplate(id: string): BuiltInAgentTeamTemplate | null {
  const match = BUILT_IN_AGENT_TEAM_TEMPLATES.find(entry => entry.id === id);
  if (!match) return null;
  return {
    ...match,
    template: createAgentTeamTemplate(match.template),
  };
}

function extractAgentTeamTemplateBody(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const nested = isRecord(input.team) ? input.team : input;
  if (!isRecord(nested)) return nested;
  return {
    ...nested,
    version: nested.version ?? input.version,
  };
}

function ensureUniqueMemberKeys(
  members: AgentTeamMemberTemplate[],
): AgentTeamMemberTemplate[] {
  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.key)) {
      throw new ValidationError("team member key", `duplicate key: ${member.key}`);
    }
    seen.add(member.key);
  }
  return members;
}

function detectDocumentFormat(content: string): AgentManifestFileFormat {
  return content.startsWith("{") || content.startsWith("[") ? "json" : "yaml";
}

function normalizeStringList(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function joinNamePrefix(prefix: string | undefined, value: string): string {
  const normalizedPrefix = prefix?.trim();
  return normalizedPrefix ? `${normalizedPrefix}-${value}` : value;
}

function slugify(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new InternalError("unable to derive a stable team manifest key");
  return normalized;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export { AgentManifestFileFormatSchema };
export type { AgentManifestCapabilityInput, AgentManifestFileFormat, UserAgentManifest, UserAgentManifestInput };
