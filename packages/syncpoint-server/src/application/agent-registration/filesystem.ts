import fs from "node:fs";
import path from "node:path";
import {
  detectUserAgentManifestFormatFromPath,
  serializeUserAgentManifest,
} from "syncpoint-adapters";
import type {
  AgentManifestFileFormat,
  UserAgentManifest,
} from "syncpoint-adapters";
import { getSyncpointDir } from "../../db.js";
import {
  ensureAgentManifestDirectory,
  syncDeclaredAgentFile,
} from "../agent-registry-service.js";
import type { AgentManifestWriteResult } from "./types.js";

export interface PersistDeclaredManifestInput {
  manifest: UserAgentManifest;
  fileStem: string;
  format: AgentManifestFileFormat;
  sync?: boolean;
  force?: boolean;
  preferredPath?: string;
}

export function listDeclarationSourceFiles(sourcePath: string): string[] {
  const absolutePath = path.resolve(sourcePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Declaration source not found: ${absolutePath}`);
  }

  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    const format = detectUserAgentManifestFormatFromPath(absolutePath);
    if (!format) {
      throw new Error(`Unsupported declaration file: ${absolutePath}`);
    }
    return [absolutePath];
  }

  const files = collectDeclarationFiles(absolutePath);
  if (!files.length) {
    throw new Error(`No YAML or JSON declaration files found in: ${absolutePath}`);
  }
  return files;
}

export function persistDeclaredManifest(
  input: PersistDeclaredManifestInput,
): AgentManifestWriteResult {
  const manifestDir = ensureAgentManifestDirectory();
  const preferredPath = input.preferredPath
    ? path.resolve(input.preferredPath)
    : path.join(
      manifestDir,
      `${slugify(input.fileStem)}${manifestFormatExtension(input.format)}`,
    );
  const targetPath = reserveManifestTargetPath(preferredPath, input.force === true);
  const content = serializeUserAgentManifest(input.manifest, input.format);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");

  const syncedRecord = input.sync === false
    ? null
    : syncDeclaredAgentFile(targetPath);

  return {
    filePath: targetPath,
    manifestPath: syncedRecord?.manifestPath ?? toStoredProjectPath(path.relative(resolveAgentProjectRoot(), targetPath)),
    format: input.format,
    manifest: input.manifest,
    syncedRecord,
    written: true,
  };
}

export function writeJsonDocument(targetPath: string, value: unknown): string {
  const absolutePath = path.resolve(targetPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return absolutePath;
}

export function resolveAgentProjectRoot(): string {
  const envRoot = process.env.SYNCPOINT_PROJECT_ROOT?.trim();
  if (envRoot) return path.resolve(envRoot);
  return path.resolve(path.dirname(getSyncpointDir()));
}

export function absolutePathFromStoredProjectPath(storedPath: string): string {
  return path.resolve(resolveAgentProjectRoot(), storedPath.split("/").join(path.sep));
}

export function isInsideDirectory(parentPath: string, candidatePath: string): boolean {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function slugify(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Unable to derive a stable manifest path.");
  return normalized;
}

function collectDeclarationFiles(rootPath: string): string[] {
  return fs.readdirSync(rootPath, { withFileTypes: true })
    .flatMap(entry => {
      const fullPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) return collectDeclarationFiles(fullPath);
      return detectUserAgentManifestFormatFromPath(fullPath) ? [fullPath] : [];
    })
    .sort((a, b) => a.localeCompare(b));
}

function reserveManifestTargetPath(preferredPath: string, force: boolean): string {
  const parsed = path.parse(preferredPath);
  if (force || !fs.existsSync(preferredPath)) return preferredPath;

  let index = 2;
  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    index += 1;
  }
}

function manifestFormatExtension(format: AgentManifestFileFormat): string {
  return format === "json" ? ".json" : ".yml";
}

function toStoredProjectPath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}
