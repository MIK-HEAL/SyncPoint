import * as path from "node:path";
import * as vscode from "vscode";

interface FileGuardOptions {
  client: any;
  onAudited?: () => void;
}

interface FileGuardConfig {
  enabled: boolean;
  agentId: string;
  taskId: string;
  sessionId?: string;
  auditOnly: boolean;
}

interface AuditDecision {
  eventType?: string;
  decision?: { kind?: string; conflictingClaims?: Array<{ id: string; actorId: string }> };
  gateId?: string;
  reusedGate?: boolean;
}

export function registerFileGuard(options: FileGuardOptions): vscode.Disposable {
  const willSave = vscode.workspace.onWillSaveTextDocument(event => {
    void warnBeforeSave(options.client, event.document);
  });
  const didSave = vscode.workspace.onDidSaveTextDocument(document => {
    void auditAfterSave(options.client, document, options.onAudited);
  });

  return vscode.Disposable.from(willSave, didSave);
}

async function warnBeforeSave(client: any, document: vscode.TextDocument): Promise<void> {
  const config = readConfig();
  if (!config || document.uri.scheme !== "file") return;

  const locator = locatorForDocument(document);
  if (!locator) return;

  try {
    const snapshot = await client.syncStatus.snapshot.query({ sessionId: config.sessionId });
    const matchingClaims = findMatchingClaims(snapshot, locator);
    const conflictingClaims = matchingClaims.filter(claim =>
      claim.actorId !== config.agentId && String(claim.mode).toLowerCase() === "exclusive"
    );
    const agent = snapshot.agents?.find((entry: any) => entry.id === config.agentId);

    if (conflictingClaims.length > 0) {
      const owners = conflictingClaims.map(claim => claim.actorName ?? claim.actorId).join(", ");
      vscode.window.showWarningMessage(`SyncPoint: ${locator} is exclusively claimed by ${owners}. Save will be audited after write.`);
      return;
    }

    if (agent?.blocked) {
      vscode.window.showWarningMessage(`SyncPoint: ${agent.name ?? config.agentId} is blocked. Save will be audited after write.`);
    }
  } catch {
  }
}

async function auditAfterSave(client: any, document: vscode.TextDocument, onAudited?: () => void): Promise<void> {
  const config = readConfig();
  if (!config || document.uri.scheme !== "file") return;

  const locator = locatorForDocument(document);
  if (!locator) return;

  try {
    const result = await client.fileAudit.audit.mutate({
      actorId: config.agentId,
      taskId: config.taskId,
      sessionId: config.sessionId,
      locator,
      auditOnly: config.auditOnly,
    }) as AuditDecision;

    if (result.eventType === "FILE_POLLUTION_DETECTED") {
      const gate = result.gateId ? ` Gate: ${result.gateId}${result.reusedGate ? " (updated)" : " (created)"}.` : "";
      vscode.window.showWarningMessage(`SyncPoint pollution detected after saving ${locator}.${gate}`);
    } else if (result.eventType === "FILE_AUDIT_ALERT") {
      vscode.window.showWarningMessage(`SyncPoint audit alert after saving ${locator}.`);
    }

    onAudited?.();
  } catch (error: any) {
    vscode.window.showWarningMessage(`SyncPoint file audit skipped: ${error?.message ?? String(error)}`);
  }
}

function readConfig(): FileGuardConfig | undefined {
  const config = vscode.workspace.getConfiguration("syncpoint");
  const enabled = config.get<boolean>("fileGuard.enabled", true);
  const agentId = config.get<string>("agentId", "").trim();
  const taskId = config.get<string>("taskId", "").trim();
  const sessionId = config.get<string>("sessionId", "").trim() || undefined;
  const auditOnly = config.get<boolean>("fileGuard.auditOnly", false);

  if (!enabled || !agentId || !taskId) return undefined;
  return { enabled, agentId, taskId, sessionId, auditOnly };
}

function locatorForDocument(document: vscode.TextDocument): string | undefined {
  const fsPath = document.uri.fsPath;
  if (!fsPath) return undefined;

  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder = folders.find(entry => isInside(fsPath, entry.uri.fsPath));
  const relative = folder ? path.relative(folder.uri.fsPath, fsPath) : path.basename(fsPath);
  const normalized = relative.replace(/\\/g, "/");
  return normalized && !normalized.startsWith("..") ? normalized : undefined;
}

function isInside(filePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function findMatchingClaims(snapshot: any, locator: string): Array<any> {
  const claims = snapshot.resourceOwnership?.activeClaims ?? [];
  return claims.filter((claim: any) =>
    claim.resources?.some((resource: any) => resource.type === "file" && pathsOverlap(resource.locator, locator))
  );
}

function pathsOverlap(a: string, b: string): boolean {
  const left = normalizePath(a).replace(/\/+$/, "");
  const right = normalizePath(b).replace(/\/+$/, "");
  if (left === right) return true;
  if (left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) return true;
  if (left.endsWith("/*") || left.endsWith("/**")) {
    const prefix = left.replace(/\/\*+$/, "");
    return right === prefix || right.startsWith(`${prefix}/`);
  }
  if (right.endsWith("/*") || right.endsWith("/**")) {
    const prefix = right.replace(/\/\*+$/, "");
    return left === prefix || left.startsWith(`${prefix}/`);
  }
  return false;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
