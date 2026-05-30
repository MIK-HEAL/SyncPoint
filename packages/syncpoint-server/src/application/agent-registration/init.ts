import {
  createUserAgentManifestTemplate,
  getBuiltInAgentTeamTemplate,
  materializeAgentTeamTemplate,
} from "syncpoint-core";
import type {
  AgentManifestFileFormat,
  UserAgentManifest,
  UserAgentProvider,
} from "syncpoint-core";
import { ensureAgentManifestDirectory } from "../agent-registry-service.js";
import { persistDeclaredManifest, slugify } from "./filesystem.js";
import type { AgentManifestWriteResult } from "./types.js";

export interface InitAgentManifestInput {
  name: string;
  profile?: string;
  provider?: UserAgentProvider;
  role?: string;
  tags?: string[];
  capabilities?: string[];
  notes?: string;
  format?: AgentManifestFileFormat;
  sync?: boolean;
  force?: boolean;
}

export interface InitAgentManifestResult {
  write: AgentManifestWriteResult;
  manifest: UserAgentManifest;
}

export function initAgentManifest(
  input: InitAgentManifestInput,
): InitAgentManifestResult {
  ensureAgentManifestDirectory();

  const manifest = createUserAgentManifestTemplate({
    name: input.name,
    profile: input.profile ?? "general",
    provider: input.provider ?? "auto_detect",
    role: input.role as UserAgentManifest["role"] | undefined,
    tags: input.tags ?? [],
    capabilities: input.capabilities ?? [],
    notes: input.notes ?? "",
  });

  const write = persistDeclaredManifest({
    manifest,
    fileStem: slugify(input.name),
    format: input.format ?? "yaml",
    sync: input.sync,
    force: input.force,
  });

  return { write, manifest };
}

export interface InitProjectAgentsInput {
  exampleAgent?: boolean;
  teamTemplateId?: string;
  defaultProvider?: UserAgentProvider;
  format?: AgentManifestFileFormat;
  namePrefix?: string;
  sync?: boolean;
  force?: boolean;
}

export interface InitProjectAgentsResult {
  exampleManifest: InitAgentManifestResult | null;
  teamWrites: AgentManifestWriteResult[];
}

const EXAMPLE_AGENT_NAME = "my-agent";

export function initProjectAgents(
  input: InitProjectAgentsInput = {},
): InitProjectAgentsResult {
  const result: InitProjectAgentsResult = {
    exampleManifest: null,
    teamWrites: [],
  };

  if (input.exampleAgent !== false) {
    result.exampleManifest = initAgentManifest({
      name: input.namePrefix
        ? `${input.namePrefix}-${EXAMPLE_AGENT_NAME}`
        : EXAMPLE_AGENT_NAME,
      profile: "executor",
      provider: input.defaultProvider ?? "auto_detect",
      tags: ["example"],
      capabilities: ["implementation"],
      notes: "Example agent — edit or replace this manifest to get started.",
      format: input.format ?? "yaml",
      sync: input.sync,
      force: input.force,
    });
  }

  if (input.teamTemplateId) {
    const builtIn = getBuiltInAgentTeamTemplate(input.teamTemplateId);
    if (!builtIn) {
      throw new Error(`Unknown team template: ${input.teamTemplateId}`);
    }

    const manifests = materializeAgentTeamTemplate(builtIn.template, {
      namePrefix: input.namePrefix,
      defaultProvider: input.defaultProvider,
    });

    result.teamWrites = manifests.map(item =>
      persistDeclaredManifest({
        manifest: item.manifest,
        fileStem: item.fileStem,
        format: input.format ?? "yaml",
        sync: input.sync,
        force: input.force,
      }),
    );
  }

  return result;
}
