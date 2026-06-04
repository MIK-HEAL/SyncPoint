import * as vscode from "vscode";
import {
  createUserAgentManifestTemplate,
  serializeUserAgentManifest,
} from "syncpoint-adapters";
import type {
  AgentRole,
  UserAgentProvider,
} from "syncpoint-adapters";

export interface CreateAgentManifestFileInput {
  name: string;
  provider: UserAgentProvider;
  role: AgentRole;
  profile?: string;
  format?: "yaml" | "json";
}

export function getPrimaryWorkspaceFolder(): vscode.Uri | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri ?? null;
}

export async function createAgentManifestFile(
  workspaceRoot: vscode.Uri,
  input: CreateAgentManifestFileInput,
): Promise<vscode.Uri> {
  const format = input.format ?? "yaml";
  const manifestDir = vscode.Uri.joinPath(workspaceRoot, ".syncpoint", "agents");
  await vscode.workspace.fs.createDirectory(manifestDir);

  const manifest = createUserAgentManifestTemplate({
    name: input.name,
    provider: input.provider,
    profile: input.profile ?? input.role,
    role: input.role,
  });

  const extension = format === "json" ? ".json" : ".yml";
  const fileUri = await nextAvailableManifestUri(manifestDir, slugify(input.name) || "agent", extension);
  const content = serializeUserAgentManifest(manifest, format);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf-8"));
  return fileUri;
}

async function nextAvailableManifestUri(
  manifestDir: vscode.Uri,
  baseName: string,
  extension: string,
): Promise<vscode.Uri> {
  let index = 0;
  while (true) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = vscode.Uri.joinPath(manifestDir, `${baseName}${suffix}${extension}`);
    if (!(await fileExists(candidate))) return candidate;
    index += 1;
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
