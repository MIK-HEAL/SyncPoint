import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  detectUserAgentManifestFormatFromPath,
  isSupportedUserAgentManifestPath,
  parseUserAgentManifestContent,
  RuntimeStatus,
  toAgentCreateFromUserAgentManifest,
  toRuntimeAgentManifestInputFromUserAgentManifest,
} from "syncpoint-adapters";
import type {
  Agent,
  AgentManifestFileFormat,
  UserAgentManifest,
} from "syncpoint-adapters";
import { InternalError } from "syncpoint-kernel";
import { getSyncpointDir } from "../db.js";
import {
  createAgent,
  getAgent,
  getAgentByName,
  updateAgentProfile,
} from "../repositories/agent-repository.js";
import {
  deleteAgentManifest,
  upsertAgentManifest,
} from "../repositories/agent-manifest-repository.js";
import {
  getAgentRegistryEntry,
  getAgentRegistryEntryByAgentId,
  listAgentRegistryEntries,
  upsertAgentRegistryEntry,
} from "../repositories/agent-registry-repository.js";
import type {
  AgentRegistryEntry,
  AgentRegistryEntryStatus,
} from "../repositories/agent-registry-repository.js";
import { listRuntimes } from "../repositories/runtime-repository.js";

export type AgentAvailability = "running" | "offline" | "available" | "error" | "removed";

export interface DeclaredAgentRecord {
  manifestPath: string;
  absolutePath: string;
  exists: boolean;
  sourceFormat: AgentManifestFileFormat | null;
  contentHash: string;
  status: AgentRegistryEntryStatus;
  availability: AgentAvailability;
  errorMessage: string;
  lastSyncAt: string;
  agentId: string | null;
  name: string | null;
  profile: string | null;
  provider: string | null;
  role: string | null;
  manifest: UserAgentManifest | null;
}

export class AgentRegistryPathError extends InternalError {
  constructor(message: string) {
    super(message);
    this.name = "AgentRegistryPathError";
  }
}

export function getAgentManifestDirectory(): string {
  return path.join(getSyncpointDir(), "agents");
}

export function ensureAgentManifestDirectory(): string {
  const dir = getAgentManifestDirectory();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listDeclaredAgents(options?: {
  includeRemoved?: boolean;
}): DeclaredAgentRecord[] {
  return listAgentRegistryEntries()
    .filter(entry => options?.includeRemoved || entry.status !== "removed")
    .map(toDeclaredAgentRecord)
    .sort((a, b) => a.manifestPath.localeCompare(b.manifestPath));
}

export function syncDeclaredAgents(): DeclaredAgentRecord[] {
  const files = listManifestFilesOnDisk();
  const seen = new Set<string>();

  for (const filePath of files) {
    const normalized = normalizeManifestPath(filePath);
    seen.add(normalized.manifestPath);
    syncDeclaredAgentFile(normalized.absolutePath);
  }

  for (const entry of listAgentRegistryEntries()) {
    if (!entry.manifestPath.startsWith(".syncpoint/agents/")) continue;
    if (seen.has(entry.manifestPath)) continue;
    removeDeclaredAgentFile(entry.manifestPath);
  }

  return listDeclaredAgents();
}

export function syncDeclaredAgentFile(filePath: string): DeclaredAgentRecord {
  const normalized = normalizeManifestPath(filePath);
  const sourceFormat = detectUserAgentManifestFormatFromPath(normalized.absolutePath) ?? null;
  const existing = getAgentRegistryEntry(normalized.manifestPath);

  if (!sourceFormat) {
    return persistAgentRegistryError({
      manifestPath: normalized.manifestPath,
      sourceFormat,
      contentHash: existing?.contentHash ?? "",
      manifest: existing?.manifest ?? null,
      agentId: existing?.agentId ?? null,
      error: new AgentRegistryPathError(`Unsupported agent manifest file: ${normalized.manifestPath}`),
    });
  }

  if (!fs.existsSync(normalized.absolutePath)) {
    return removeDeclaredAgentFile(normalized.absolutePath) ?? persistAgentRegistryError({
      manifestPath: normalized.manifestPath,
      sourceFormat,
      contentHash: "",
      manifest: existing?.manifest ?? null,
      agentId: existing?.agentId ?? null,
      error: new AgentRegistryPathError(`Agent manifest not found: ${normalized.manifestPath}`),
    });
  }

  const content = fs.readFileSync(normalized.absolutePath, "utf8");
  const contentHash = createContentHash(content);
  let parsedManifest: UserAgentManifest | null = null;

  try {
    parsedManifest = parseUserAgentManifestContent(content, sourceFormat);
    const agent = upsertDeclaredAgent(normalized.manifestPath, parsedManifest);
    upsertAgentManifest({
      agentId: agent.id,
      ...toRuntimeAgentManifestInputFromUserAgentManifest(parsedManifest),
    });

    const entry = upsertAgentRegistryEntry({
      manifestPath: normalized.manifestPath,
      agentId: agent.id,
      sourceFormat,
      contentHash,
      manifest: parsedManifest,
      status: "active",
      errorMessage: "",
    });

    return toDeclaredAgentRecord(entry);
  } catch (error) {
    return persistAgentRegistryError({
      manifestPath: normalized.manifestPath,
      sourceFormat,
      contentHash,
      manifest: parsedManifest,
      agentId: existing?.agentId ?? null,
      error,
    });
  }
}

export function removeDeclaredAgentFile(filePath: string): DeclaredAgentRecord | null {
  const normalized = normalizeManifestPath(filePath);
  const existing = getAgentRegistryEntry(normalized.manifestPath);

  if (!existing) return null;

  if (existing.agentId) {
    deleteAgentManifest(existing.agentId);
  }

  const entry = upsertAgentRegistryEntry({
    manifestPath: normalized.manifestPath,
    agentId: null,
    sourceFormat: detectUserAgentManifestFormatFromPath(normalized.absolutePath) ?? existing.sourceFormat,
    contentHash: "",
    manifest: null,
    status: "removed",
    errorMessage: "",
  });

  return toDeclaredAgentRecord(entry);
}

function listManifestFilesOnDisk(): string[] {
  const dir = getAgentManifestDirectory();
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && isSupportedUserAgentManifestPath(entry.name))
    .map(entry => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function upsertDeclaredAgent(manifestPath: string, manifest: UserAgentManifest): Agent {
  const desiredProfile = toAgentCreateFromUserAgentManifest(manifest);
  const existingEntry = getAgentRegistryEntry(manifestPath);

  if (existingEntry?.agentId) {
    const existingAgent = tryGetAgent(existingEntry.agentId);
    if (existingAgent) {
      return updateAgentProfile(existingAgent.id, desiredProfile);
    }
  }

  const existingByName = getAgentByName(manifest.name);
  if (existingByName) {
    const boundEntry = getAgentRegistryEntryByAgentId(existingByName.id);
    if (!boundEntry || boundEntry.manifestPath === manifestPath || releaseStaleBinding(boundEntry)) {
      return updateAgentProfile(existingByName.id, desiredProfile);
    }
  }

  return createAgent(desiredProfile);
}

function releaseStaleBinding(entry: AgentRegistryEntry): boolean {
  if (entry.status === "removed") {
    clearAgentBinding(entry);
    return true;
  }

  const absolutePath = absolutePathFromStoredManifestPath(entry.manifestPath);
  if (fs.existsSync(absolutePath)) return false;

  if (entry.agentId) {
    deleteAgentManifest(entry.agentId);
  }

  clearAgentBinding(entry, "removed");
  return true;
}

function clearAgentBinding(
  entry: AgentRegistryEntry,
  status: AgentRegistryEntryStatus = entry.status,
): AgentRegistryEntry {
  return upsertAgentRegistryEntry({
    manifestPath: entry.manifestPath,
    agentId: null,
    sourceFormat: entry.sourceFormat,
    contentHash: status === "removed" ? "" : entry.contentHash,
    manifest: status === "removed" ? null : entry.manifest,
    status,
    errorMessage: status === "removed" ? "" : entry.errorMessage,
    lastSyncAt: entry.lastSyncAt,
  });
}

function persistAgentRegistryError(input: {
  manifestPath: string;
  sourceFormat: AgentManifestFileFormat | null;
  contentHash: string;
  manifest: UserAgentManifest | null;
  agentId: string | null;
  error: unknown;
}): DeclaredAgentRecord {
  const entry = upsertAgentRegistryEntry({
    manifestPath: input.manifestPath,
    agentId: input.agentId,
    sourceFormat: input.sourceFormat,
    contentHash: input.contentHash,
    manifest: input.manifest,
    status: "error",
    errorMessage: getErrorMessage(input.error),
  });

  return toDeclaredAgentRecord(entry);
}

function toDeclaredAgentRecord(entry: AgentRegistryEntry): DeclaredAgentRecord {
  const absolutePath = absolutePathFromStoredManifestPath(entry.manifestPath);
  const boundAgent = entry.agentId ? tryGetAgent(entry.agentId) : null;
  const availability = computeAvailability(entry, boundAgent);

  return {
    manifestPath: entry.manifestPath,
    absolutePath,
    exists: fs.existsSync(absolutePath),
    sourceFormat: entry.sourceFormat,
    contentHash: entry.contentHash,
    status: entry.status,
    availability,
    errorMessage: entry.errorMessage,
    lastSyncAt: entry.lastSyncAt,
    agentId: entry.agentId,
    name: entry.manifest?.name ?? boundAgent?.name ?? null,
    profile: entry.manifest?.profile ?? null,
    provider: entry.manifest?.provider ?? boundAgent?.provider ?? null,
    role: entry.manifest?.role ?? boundAgent?.role ?? null,
    manifest: entry.manifest,
  };
}

function computeAvailability(
  entry: AgentRegistryEntry,
  boundAgent: { id: string } | null,
): AgentAvailability {
  if (entry.status === "error") return "error";
  if (entry.status === "removed") return "removed";
  if (entry.status === "pending") return "available";

  // status === "active" — check runtime binding
  if (boundAgent) {
    const runtimeOnline = isAgentRuntimeOnline(boundAgent.id);
    return runtimeOnline ? "running" : "offline";
  }

  return "available";
}

function isAgentRuntimeOnline(agentId: string): boolean {
  try {
    const runtimes = listRuntimes();
    return runtimes.some((rt: { agentId: string | null; status: string }) => rt.agentId === agentId && rt.status === RuntimeStatus.ACTIVE);
  } catch {
    return false;
  }
}

function normalizeManifestPath(filePath: string): {
  absolutePath: string;
  manifestPath: string;
} {
  const projectRoot = resolveProjectRoot();
  const absolutePath = path.resolve(projectRoot, filePath);
  const manifestDir = path.resolve(getAgentManifestDirectory());
  const relativeToManifestDir = path.relative(manifestDir, absolutePath);

  if (relativeToManifestDir.startsWith("..") || path.isAbsolute(relativeToManifestDir)) {
    throw new AgentRegistryPathError(
      `Agent manifest path must be inside ${manifestDir}: ${filePath}`,
    );
  }

  const relativeToRoot = path.relative(projectRoot, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new AgentRegistryPathError(
      `Agent manifest path must resolve inside ${projectRoot}: ${filePath}`,
    );
  }

  return {
    absolutePath,
    manifestPath: toStoredPath(relativeToRoot),
  };
}

function absolutePathFromStoredManifestPath(manifestPath: string): string {
  return path.resolve(resolveProjectRoot(), fromStoredPath(manifestPath));
}

function resolveProjectRoot(): string {
  const envRoot = process.env.SYNCPOINT_PROJECT_ROOT?.trim();
  if (envRoot) return path.resolve(envRoot);
  return path.resolve(path.dirname(getSyncpointDir()));
}

function toStoredPath(value: string): string {
  return value.split(path.sep).join("/");
}

function fromStoredPath(value: string): string {
  return value.split("/").join(path.sep);
}

function tryGetAgent(agentId: string): Agent | null {
  try {
    return getAgent(agentId);
  } catch {
    return null;
  }
}

function createContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
