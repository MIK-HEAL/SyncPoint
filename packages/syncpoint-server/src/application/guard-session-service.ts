import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSyncpointDir } from "../db.js";
import { lockClaimedFiles, unlockClaimedFiles } from "./file-permission-guard.js";

export type GuardMode = "observe" | "stage" | "strict" | "readonly";
export type GuardSessionStatus = "active" | "expired" | "revoked";
export type GuardProxyAdapter = "winfsp" | "fuse" | "macfuse" | "manual";

export interface GuardCreateSessionInput {
  actorId: string;
  taskId: string;
  sessionId?: string;
  mode?: GuardMode;
  mountPath?: string;
  adapter?: GuardProxyAdapter;
  ttlSeconds?: number;
}

export interface GuardSession {
  id: string;
  actorId: string;
  taskId: string;
  sessionId: string;
  projectRoot: string;
  mountPath: string;
  mode: GuardMode;
  adapter: GuardProxyAdapter;
  token: string;
  status: GuardSessionStatus;
  createdAt: string;
  expiresAt: string;
}

export interface GuardStatusResult {
  projectRoot: string;
  enforcementLevel: "controlled" | "editor_guard" | "workspace_proxy";
  proxyAvailable: boolean;
  proxyAdapters: Array<{ adapter: GuardProxyAdapter; available: boolean; reason: string }>;
  activeSessions: Array<Omit<GuardSession, "token">>;
}

export interface GuardValidateTokenResult {
  valid: boolean;
  session?: Omit<GuardSession, "token">;
  reason?: string;
}

const DEFAULT_TTL_SECONDS = 3600;
interface StoredGuardSession extends GuardSession {
  tokenHash: string;
}

const sessions = new Map<string, StoredGuardSession>();

export function __clearGuardSessionsForTest(): void {
  sessions.clear();
}

export function guardStatus(): GuardStatusResult {
  expireOldSessions();
  const activeSessions = Array.from(sessions.values())
    .filter(session => session.status === "active")
    .map(redactSession);
  return {
    projectRoot: resolveProjectRoot(),
    enforcementLevel: activeSessions.length > 0 ? "workspace_proxy" : "controlled",
    proxyAvailable: false,
    proxyAdapters: [
      { adapter: "winfsp", available: false, reason: "WinFsp adapter is not mounted by this TypeScript service layer yet." },
      { adapter: "fuse", available: false, reason: "FUSE adapter is not mounted by this TypeScript service layer yet." },
      { adapter: "macfuse", available: false, reason: "macFUSE adapter is not mounted by this TypeScript service layer yet." },
    ],
    activeSessions,
  };
}

export function guardCreateSession(input: GuardCreateSessionInput): GuardSession {
  expireOldSessions();
  const projectRoot = resolveProjectRoot();
  const mountPath = input.mountPath ? validateMountPath(projectRoot, input.mountPath) : "";
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const token = `spg_${randomBytes(24).toString("base64url")}`;
  const now = new Date();
  const session: StoredGuardSession = {
    id: `guard_${randomBytes(8).toString("hex")}`,
    actorId: input.actorId,
    taskId: input.taskId,
    sessionId: input.sessionId ?? "",
    projectRoot,
    mountPath,
    mode: input.mode ?? "strict",
    adapter: input.adapter ?? defaultAdapter(),
    token,
    tokenHash: hashToken(token),
    status: "active",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
  };
  sessions.set(session.id, session);

  if (session.mode === "strict" || session.mode === "readonly") {
    lockClaimedFiles({
      guardSessionId: session.id,
      projectRoot,
      taskId: input.taskId,
      sessionId: input.sessionId,
    });
  }

  return publicSession(session);
}

export function guardValidateToken(token: string): GuardValidateTokenResult {
  expireOldSessions();
  const tokenHash = hashToken(token);
  const session = Array.from(sessions.values()).find(entry => entry.tokenHash === tokenHash);
  if (!session) return { valid: false, reason: "Guard token not found." };
  if (session.status !== "active") return { valid: false, reason: `Guard session is ${session.status}.` };
  return { valid: true, session: redactSession(session) };
}

export function guardRevokeSession(sessionId: string): Omit<GuardSession, "token"> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Guard session not found: ${sessionId}`);
  session.status = "revoked";
  unlockClaimedFiles(sessionId);
  return redactSession(session);
}

function expireOldSessions(): void {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (session.status === "active" && new Date(session.expiresAt).getTime() <= now) {
      session.status = "expired";
      unlockClaimedFiles(session.id);
    }
  }
}

function redactSession(session: StoredGuardSession): Omit<GuardSession, "token"> {
  const { token, tokenHash, ...rest } = session;
  return rest;
}

function publicSession(session: StoredGuardSession): GuardSession {
  const { tokenHash, ...rest } = session;
  return rest;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function defaultAdapter(): GuardProxyAdapter {
  if (process.platform === "win32") return "winfsp";
  if (process.platform === "darwin") return "macfuse";
  return "fuse";
}

function resolveProjectRoot(): string {
  const envRoot = process.env.SYNCPOINT_PROJECT_ROOT;
  if (envRoot) return canonicalRoot(envRoot);
  return canonicalRoot(path.dirname(getSyncpointDir()));
}

function canonicalRoot(root: string): string {
  const resolved = path.resolve(root);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function validateMountPath(projectRoot: string, mountPath: string): string {
  const resolved = path.resolve(projectRoot, mountPath);
  if (!isInsideOrSame(projectRoot, resolved)) {
    throw new Error(`Guard mount path must stay inside the project root: ${mountPath}`);
  }
  const relative = path.relative(projectRoot, resolved).replace(/\\/g, "/");
  const segments = relative.split("/").filter(Boolean);
  if (segments.includes(".git") || segments.includes(".syncpoint")) {
    throw new Error("Guard mount path cannot be inside .git or .syncpoint.");
  }
  return resolved;
}

function isInsideOrSame(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
