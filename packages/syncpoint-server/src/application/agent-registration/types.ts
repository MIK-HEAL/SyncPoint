import type {
  AgentCard,
  AgentManifestFileFormat,
  AgentTeamTemplate,
  BuiltInAgentTeamTemplate,
  UserAgentManifest,
  UserAgentProvider,
} from "syncpoint-adapters";
import type { DeclaredAgentRecord } from "../agent-registry-service.js";

export interface AgentManifestWriteResult {
  filePath: string;
  manifestPath: string;
  format: AgentManifestFileFormat;
  manifest: UserAgentManifest;
  syncedRecord: DeclaredAgentRecord | null;
  written: boolean;
}

export interface InitAgentTeamInput {
  templateId?: string;
  template?: AgentTeamTemplate;
  namePrefix?: string;
  defaultProvider?: UserAgentProvider;
  format?: AgentManifestFileFormat;
  sync?: boolean;
  force?: boolean;
}

export interface InitAgentTeamResult {
  templateId: string | null;
  templateName: string;
  writes: AgentManifestWriteResult[];
}

export interface AgentDeclarationImportInput {
  sourcePath: string;
  format?: AgentManifestFileFormat;
  defaultProvider?: UserAgentProvider;
  namePrefix?: string;
  sync?: boolean;
  force?: boolean;
}

export interface AgentDeclarationImportResult {
  sourcePath: string;
  writes: AgentManifestWriteResult[];
}

export interface ValidateAgentDeclarationsInput {
  sourcePath?: string;
  content?: string;
  format?: AgentManifestFileFormat;
}

export interface AgentDeclarationValidationRecord {
  filePath: string | null;
  format: AgentManifestFileFormat;
  kind: "manifest" | "team-template" | "unknown";
  valid: boolean;
  name: string | null;
  memberCount: number | null;
  errorMessage: string;
}

export interface ValidateAgentDeclarationsResult {
  sourcePath: string | null;
  results: AgentDeclarationValidationRecord[];
}

export interface MigrateRuntimeAgentsInput {
  agentIds?: string[];
  format?: AgentManifestFileFormat;
  sync?: boolean;
  force?: boolean;
}

export interface RuntimeAgentMigrationItem extends AgentManifestWriteResult {
  agentId: string;
  agentName: string;
  skipped: boolean;
}

export interface MigrateRuntimeAgentsResult {
  items: RuntimeAgentMigrationItem[];
}

export interface ExportAgentCardsInput {
  agentIds?: string[];
  includeRemoved?: boolean;
  sync?: boolean;
}

export interface ExportedAgentCardRecord {
  agentId: string | null;
  manifestPath: string | null;
  status: DeclaredAgentRecord["status"] | "runtime-only";
  card: AgentCard;
}

export interface ExportAgentCardsResult {
  cards: ExportedAgentCardRecord[];
}

export interface AgentTeamTemplateCatalogResult {
  templates: BuiltInAgentTeamTemplate[];
}
