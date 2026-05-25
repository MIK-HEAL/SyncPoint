import fs from "node:fs";
import path from "node:path";
import {
  detectUserAgentManifestFormatFromPath,
  parseAgentTeamTemplateContent,
  parseUserAgentManifestContent,
} from "syncpoint-core";
import type { AgentManifestFileFormat } from "syncpoint-core";
import { listDeclarationSourceFiles } from "./filesystem.js";
import type {
  AgentDeclarationValidationRecord,
  ValidateAgentDeclarationsInput,
  ValidateAgentDeclarationsResult,
} from "./types.js";

export function validateAgentDeclarations(
  input: ValidateAgentDeclarationsInput,
): ValidateAgentDeclarationsResult {
  if (!!input.sourcePath === !!input.content) {
    throw new Error("Provide exactly one of sourcePath or content for validation.");
  }

  if (input.content !== undefined) {
    const format = input.format ?? detectFormatFromContent(input.content);
    return {
      sourcePath: null,
      results: [validateDeclarationDocument({
        filePath: null,
        content: input.content,
        format,
      })],
    };
  }

  const sourcePath = path.resolve(input.sourcePath ?? "");
  const files = listDeclarationSourceFiles(sourcePath);
  return {
    sourcePath,
    results: files.map(filePath => {
      const format = detectUserAgentManifestFormatFromPath(filePath);
      if (!format) {
        return {
          filePath,
          format: input.format ?? "yaml",
          kind: "unknown",
          valid: false,
          name: null,
          memberCount: null,
          errorMessage: `Unsupported declaration file: ${filePath}`,
        } satisfies AgentDeclarationValidationRecord;
      }

      return validateDeclarationDocument({
        filePath,
        content: fs.readFileSync(filePath, "utf8"),
        format,
      });
    }),
  };
}

function validateDeclarationDocument(input: {
  filePath: string | null;
  content: string;
  format: AgentManifestFileFormat;
}): AgentDeclarationValidationRecord {
  try {
    const template = parseAgentTeamTemplateContent(input.content, input.format);
    return {
      filePath: input.filePath,
      format: input.format,
      kind: "team-template",
      valid: true,
      name: template.name,
      memberCount: template.members.length,
      errorMessage: "",
    };
  } catch (teamError) {
    try {
      const manifest = parseUserAgentManifestContent(input.content, input.format);
      return {
        filePath: input.filePath,
        format: input.format,
        kind: "manifest",
        valid: true,
        name: manifest.name,
        memberCount: null,
        errorMessage: "",
      };
    } catch (manifestError) {
      return {
        filePath: input.filePath,
        format: input.format,
        kind: "unknown",
        valid: false,
        name: null,
        memberCount: null,
        errorMessage: joinValidationErrors(teamError, manifestError),
      };
    }
  }
}

function joinValidationErrors(teamError: unknown, manifestError: unknown): string {
  const teamMessage = getErrorMessage(teamError);
  const manifestMessage = getErrorMessage(manifestError);
  return `Not a valid team template: ${teamMessage}; Not a valid agent manifest: ${manifestMessage}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function detectFormatFromContent(content: string): AgentManifestFileFormat {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[") ? "json" : "yaml";
}
