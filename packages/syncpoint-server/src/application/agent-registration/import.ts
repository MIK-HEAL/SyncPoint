import fs from "node:fs";
import path from "node:path";
import {
  detectUserAgentManifestFormatFromPath,
  materializeAgentTeamTemplate,
  parseAgentTeamTemplateContent,
  parseUserAgentManifestContent,
} from "syncpoint-core";
import { ensureAgentManifestDirectory, syncDeclaredAgentFile } from "../agent-registry-service.js";
import {
  isInsideDirectory,
  listDeclarationSourceFiles,
  persistDeclaredManifest,
  resolveAgentProjectRoot,
} from "./filesystem.js";
import type {
  AgentDeclarationImportInput,
  AgentDeclarationImportResult,
  AgentManifestWriteResult,
} from "./types.js";

export function importAgentDeclarations(
  input: AgentDeclarationImportInput,
): AgentDeclarationImportResult {
  const sourcePath = path.resolve(input.sourcePath);
  const files = listDeclarationSourceFiles(sourcePath);
  const manifestDir = ensureAgentManifestDirectory();
  const writes = files.flatMap(filePath => {
    const format = detectUserAgentManifestFormatFromPath(filePath);
    if (!format) {
      throw new Error(`Unsupported declaration file: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf8");
    const importedTeam = tryParseTeamTemplate(content, format);
    if (importedTeam) {
      return materializeAgentTeamTemplate(importedTeam, {
        namePrefix: input.namePrefix,
        defaultProvider: input.defaultProvider,
      }).map((item: { manifest: AgentManifestWriteResult["manifest"]; fileStem: string }) => persistDeclaredManifest({
        manifest: item.manifest,
        fileStem: item.fileStem,
        format: input.format ?? format,
        sync: input.sync,
        force: input.force,
      }));
    }

    const manifest = parseUserAgentManifestContent(content, format);
    if (
      isInsideDirectory(manifestDir, filePath)
      && input.force !== true
      && (input.format === undefined || input.format === format)
    ) {
      const syncedRecord = input.sync === false ? null : syncDeclaredAgentFile(filePath);
      return [
        {
          filePath,
          manifestPath: syncedRecord?.manifestPath
            ?? path.relative(resolveAgentProjectRoot(), filePath).split(path.sep).join("/"),
          format,
          manifest,
          syncedRecord,
          written: false,
        } satisfies AgentManifestWriteResult,
      ];
    }

    return [persistDeclaredManifest({
      manifest,
      fileStem: path.parse(filePath).name,
      format: input.format ?? format,
      sync: input.sync,
      force: input.force,
    })];
  });

  return {
    sourcePath,
    writes,
  };
}

function tryParseTeamTemplate(
  content: string,
  format: NonNullable<ReturnType<typeof detectUserAgentManifestFormatFromPath>>,
) {
  try {
    return parseAgentTeamTemplateContent(content, format);
  } catch {
    return null;
  }
}
