export {
  listAgentTeamTemplates,
  getAgentTeamTemplate,
  initAgentTeam,
} from "./agent-registration/team.js";

export {
  initAgentManifest,
  initProjectAgents,
} from "./agent-registration/init.js";

export type {
  InitAgentManifestInput,
  InitAgentManifestResult,
  InitProjectAgentsInput,
  InitProjectAgentsResult,
} from "./agent-registration/init.js";

export {
  diagnoseAgentRegistry,
} from "./agent-registration/diagnose.js";

export type {
  DiagnoseAgentRegistryInput,
  DiagnoseAgentRegistryResult,
  AgentDiagnosticEntry,
} from "./agent-registration/diagnose.js";

export {
  importAgentDeclarations,
} from "./agent-registration/import.js";

export {
  validateAgentDeclarations,
} from "./agent-registration/validate.js";

export {
  migrateRuntimeAgentsToDeclaredManifests,
} from "./agent-registration/migrate.js";

export {
  exportAgentCards,
  resolveAgentIdsForCardExport,
  listRuntimeAgentIds,
} from "./agent-registration/card.js";

export type {
  AgentManifestWriteResult,
  InitAgentTeamInput,
  InitAgentTeamResult,
  AgentDeclarationImportInput,
  AgentDeclarationImportResult,
  ValidateAgentDeclarationsInput,
  AgentDeclarationValidationRecord,
  ValidateAgentDeclarationsResult,
  MigrateRuntimeAgentsInput,
  MigrateRuntimeAgentsResult,
  RuntimeAgentMigrationItem,
  ExportAgentCardsInput,
  ExportAgentCardsResult,
  ExportedAgentCardRecord,
  AgentTeamTemplateCatalogResult,
} from "./agent-registration/types.js";
