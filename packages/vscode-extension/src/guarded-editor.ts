import * as path from "node:path";
import * as vscode from "vscode";
import { WriteIntent } from "syncpoint-core";

interface GuardedEditorOptions {
  client: any;
}

interface GuardedEditorConfig {
  enabled: boolean;
  agentId: string;
  taskId: string;
  sessionId?: string;
}

const SCHEME = "syncpoint";

export function registerGuardedEditor(options: GuardedEditorOptions): vscode.Disposable {
  const provider = new SyncPointFileSystemProvider(options.client);
  const providerDisposable = vscode.workspace.registerFileSystemProvider(SCHEME, provider, { isCaseSensitive: process.platform !== "win32" });
  const saveDisposable = vscode.commands.registerCommand("syncpoint.guardedSave", async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      vscode.window.showWarningMessage("SyncPoint guarded save requires an active guarded document.");
      return;
    }
    await provider.save(target);
  });
  const openDisposable = vscode.commands.registerCommand("syncpoint.openGuardedFile", async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || target.scheme !== "file") {
      vscode.window.showWarningMessage("Open a workspace file before opening it through SyncPoint.");
      return;
    }
    const guarded = guardedUriForFile(target);
    if (!guarded) {
      vscode.window.showWarningMessage("File is not inside an open workspace folder.");
      return;
    }
    const document = await vscode.workspace.openTextDocument(guarded);
    await vscode.window.showTextDocument(document);
  });
  return vscode.Disposable.from(providerDisposable, saveDisposable, openDisposable);
}

export function guardedUriForFile(uri: vscode.Uri): vscode.Uri | undefined {
  const locator = locatorForFileUri(uri);
  if (!locator) return undefined;
  return vscode.Uri.from({ scheme: SCHEME, path: `/${locator}` });
}

class SyncPointFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;

  constructor(private readonly client: any) {}

  watch(): vscode.Disposable {
    return { dispose: () => {} };
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const file = backingFileUri(uri);
    if (!file) throw vscode.FileSystemError.FileNotFound(uri);
    return vscode.workspace.fs.stat(file);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const file = backingFileUri(uri);
    if (!file) throw vscode.FileSystemError.FileNotFound(uri);
    return vscode.workspace.fs.readDirectory(file);
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const file = backingFileUri(uri);
    if (!file) throw vscode.FileSystemError.FileNotFound(uri);
    return vscode.workspace.fs.readFile(file);
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const locator = locatorForGuardedUri(uri);
    const config = readConfig();
    if (!locator || !config) throw vscode.FileSystemError.NoPermissions(uri);
    try {
      const prepared = await this.client.write.prepare.mutate({
        actorId: config.agentId,
        taskId: config.taskId,
        sessionId: config.sessionId,
        resources: [{ type: "file", locator, metadata: "" }],
        intent: WriteIntent.MODIFY,
      });
      if (!prepared.decision?.permitted) {
        throw new Error(formatBlockers(prepared.decision?.blockers));
      }
      await this.client.write.applyWrite.mutate({
        permitId: prepared.permit.id,
        mutations: [{ resource: { type: "file", locator, metadata: "" }, contentBase64: Buffer.from(content).toString("base64") }],
      });
      this.changes.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch (error: any) {
      vscode.window.showErrorMessage(`SyncPoint guarded save blocked: ${error?.message ?? String(error)}`);
      throw vscode.FileSystemError.NoPermissions(uri);
    }
  }

  async save(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== SCHEME) {
      vscode.window.showWarningMessage("SyncPoint guarded save only handles syncpoint: documents.");
      return;
    }
    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.uri.toString() !== uri.toString()) {
      vscode.window.showWarningMessage("Open the guarded document before saving through SyncPoint.");
      return;
    }
    await this.writeFile(uri, Buffer.from(document.getText(), "utf8"));
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(oldUri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(oldUri);
  }
}

function readConfig(): GuardedEditorConfig | undefined {
  const config = vscode.workspace.getConfiguration("syncpoint");
  const enabled = config.get<boolean>("fileGuard.enabled", true);
  const mode = config.get<string>("fileGuard.mode", "audit");
  const agentId = config.get<string>("agentId", "").trim();
  const taskId = config.get<string>("taskId", "").trim();
  const sessionId = config.get<string>("sessionId", "").trim() || undefined;
  if (!enabled || mode !== "editor-strict" || !agentId || !taskId) return undefined;
  return { enabled, agentId, taskId, sessionId };
}

function backingFileUri(uri: vscode.Uri): vscode.Uri | undefined {
  const locator = locatorForGuardedUri(uri);
  if (!locator) return undefined;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return undefined;
  return vscode.Uri.joinPath(root, ...locator.split("/"));
}

function locatorForGuardedUri(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== SCHEME) return undefined;
  const locator = uri.path.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!locator || locator.split("/").some(segment => segment === ".." || segment === "")) return undefined;
  return locator;
}

function locatorForFileUri(uri: vscode.Uri): string | undefined {
  const fsPath = uri.fsPath;
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder = folders.find(entry => isInside(fsPath, entry.uri.fsPath));
  if (!folder) return undefined;
  return path.relative(folder.uri.fsPath, fsPath).replace(/\\/g, "/");
}

function isInside(filePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatBlockers(blockers: Array<{ message?: string }> | undefined): string {
  const messages = blockers?.map(blocker => blocker.message).filter(Boolean) ?? [];
  return messages.length ? messages.join("; ") : "write permit denied";
}
