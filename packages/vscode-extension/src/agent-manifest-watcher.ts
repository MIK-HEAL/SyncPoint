import * as vscode from "vscode";

export interface AgentManifestWatcherOptions {
  client: any;
  onSynced?: () => void;
  onWarning?: (message: string) => void;
  onCreated?: (uri: vscode.Uri) => void;
  outputChannel?: vscode.OutputChannel;
}

export function registerAgentManifestWatcher(options: AgentManifestWatcherOptions): vscode.Disposable {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) return vscode.Disposable.from();

  const disposables: vscode.Disposable[] = [];
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let warnedMessage = "";

  const log = (message: string) => {
    options.outputChannel?.appendLine(`[agent-watcher] ${new Date().toISOString()} ${message}`);
  };

  const warn = (message: string) => {
    if (!message || message === warnedMessage) return;
    warnedMessage = message;
    options.onWarning?.(message);
  };

  const scheduleSync = (uri: vscode.Uri, { isNew }: { isNew: boolean }) => {
    const key = uri.toString();
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);
    pending.set(key, setTimeout(async () => {
      pending.delete(key);
      try {
        log(`syncing: ${uri.fsPath}`);
        await options.client.agentRegistry.syncFile.mutate({ filePath: uri.fsPath });
        options.onSynced?.();
        if (isNew) {
          log(`created: ${uri.fsPath}`);
          options.onCreated?.(uri);
        }
      } catch (error: any) {
        const msg = `Failed to sync agent manifest: ${error?.message ?? String(error)}`;
        log(`error: ${msg}`);
        warn(msg);
      }
    }, 150));
  };

  const handleRemove = async (uri: vscode.Uri) => {
    const key = uri.toString();
    const existing = pending.get(key);
    if (existing) {
      clearTimeout(existing);
      pending.delete(key);
    }

    try {
      log(`removing: ${uri.fsPath}`);
      await options.client.agentRegistry.removeFile.mutate({ filePath: uri.fsPath });
      options.onSynced?.();
    } catch (error: any) {
      const msg = `Failed to remove agent manifest: ${error?.message ?? String(error)}`;
      log(`error: ${msg}`);
      warn(msg);
    }
  };

  for (const folder of folders) {
    for (const pattern of [".syncpoint/agents/*.yml", ".syncpoint/agents/*.yaml", ".syncpoint/agents/*.json"]) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, pattern));
      watcher.onDidCreate(uri => scheduleSync(uri, { isNew: true }));
      watcher.onDidChange(uri => scheduleSync(uri, { isNew: false }));
      watcher.onDidDelete(handleRemove);
      disposables.push(watcher);
    }
  }

  void options.client.agentRegistry.sync.mutate()
    .then(() => {
      log("initial sync completed");
      options.onSynced?.();
    })
    .catch((error: any) => {
      const msg = `Failed to sync agent manifests: ${error?.message ?? String(error)}`;
      log(`error: ${msg}`);
      warn(msg);
    });

  disposables.push({
    dispose: () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  });

  return vscode.Disposable.from(...disposables);
}
