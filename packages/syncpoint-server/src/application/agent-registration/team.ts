import {
  getBuiltInAgentTeamTemplate,
  listBuiltInAgentTeamTemplates,
  materializeAgentTeamTemplate,
} from "syncpoint-adapters";
import { persistDeclaredManifest } from "./filesystem.js";
import type {
  AgentManifestWriteResult,
  AgentTeamTemplateCatalogResult,
  InitAgentTeamInput,
  InitAgentTeamResult,
} from "./types.js";

export function listAgentTeamTemplates(): AgentTeamTemplateCatalogResult {
  return {
    templates: listBuiltInAgentTeamTemplates(),
  };
}

export function getAgentTeamTemplate(templateId: string) {
  const template = getBuiltInAgentTeamTemplate(templateId);
  if (!template) {
    throw new Error(`Unknown team template: ${templateId}`);
  }
  return template;
}

export function initAgentTeam(input: InitAgentTeamInput): InitAgentTeamResult {
  const resolvedTemplate = input.template
    ? {
      id: null,
      title: input.template.name,
      description: input.template.description,
      template: input.template,
    }
    : getAgentTeamTemplate(input.templateId ?? "delivery-pod");
  const manifests = materializeAgentTeamTemplate(resolvedTemplate.template, {
    namePrefix: input.namePrefix,
    defaultProvider: input.defaultProvider,
  });

  return {
    templateId: resolvedTemplate.id,
    templateName: resolvedTemplate.template.name,
    writes: manifests.map((item: { manifest: AgentManifestWriteResult["manifest"]; fileStem: string }) => persistDeclaredManifest({
      manifest: item.manifest,
      fileStem: item.fileStem,
      format: input.format ?? "yaml",
      sync: input.sync,
      force: input.force,
    })),
  };
}
