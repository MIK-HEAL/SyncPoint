import type { DeclaredAgentRecord } from "../agent-registry-service.js";
import { listDeclaredAgents, syncDeclaredAgents } from "../agent-registry-service.js";

export interface DiagnoseAgentRegistryInput {
  sync?: boolean;
}

export interface AgentDiagnosticEntry {
  manifestPath: string;
  name: string | null;
  status: DeclaredAgentRecord["status"];
  availability: DeclaredAgentRecord["availability"];
  exists: boolean;
  sourceFormat: string | null;
  errorMessage: string;
  fixSuggestions: string[];
}

export interface DiagnoseAgentRegistryResult {
  total: number;
  healthy: number;
  errors: number;
  removed: number;
  entries: AgentDiagnosticEntry[];
}

export function diagnoseAgentRegistry(
  input: DiagnoseAgentRegistryInput = {},
): DiagnoseAgentRegistryResult {
  if (input.sync !== false) syncDeclaredAgents();

  const records = listDeclaredAgents({ includeRemoved: true });

  let healthy = 0;
  let errors = 0;
  let removed = 0;

  const entries = records.map(record => {
    const fixSuggestions = suggestFixes(record);

    if (record.status === "active") healthy += 1;
    else if (record.status === "error") errors += 1;
    else if (record.status === "removed") removed += 1;

    return {
      manifestPath: record.manifestPath,
      name: record.name,
      status: record.status,
      availability: record.availability,
      exists: record.exists,
      sourceFormat: record.sourceFormat ?? null,
      errorMessage: record.errorMessage,
      fixSuggestions,
    };
  });

  return {
    total: records.length,
    healthy,
    errors,
    removed,
    entries,
  };
}

function suggestFixes(record: DeclaredAgentRecord): string[] {
  const suggestions: string[] = [];

  if (record.status === "error") {
    if (!record.exists) {
      suggestions.push("File was deleted — remove the stale entry with `syncpoint agent sync` or recreate the file.");
    } else if (record.errorMessage.includes("Unsupported agent manifest file")) {
      suggestions.push("Rename the file to .yml or .json extension.");
    } else if (record.errorMessage.includes("Agent manifest path must be inside")) {
      suggestions.push("Move the file into the .syncpoint/agents/ directory.");
    } else if (record.errorMessage) {
      suggestions.push("Check the file for YAML/JSON syntax errors or missing required fields (name is required).");
      suggestions.push("Run `syncpoint agent validate <file>` for detailed schema validation.");
    }
  }

  if (record.status === "removed" && record.exists) {
    suggestions.push("File exists but registry marks it removed — run `syncpoint agent sync` to reconcile.");
  }

  return suggestions;
}
