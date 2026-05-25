import * as vscode from "vscode";

export interface AgentManifestWatcherOptions {
  client: any;
  onSynced?: () => void;
  onWarning?: (message: string) => void;
}

export function registerAgentManifestWatcher(options: AgentManifestWatcherOptions): vscode.Disposable {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) return vscode.Disposable.from();

  const disposables: vscode.Disposable[] = [];
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let warnedMessage = "";

  const warn = (message: string) => {
    if (!message || message === warnedMessage) return;
    warnedMessage = message;
    options.onWarning?.(message);
  };

  const scheduleSync = (uri: vscode.Uri) => {
    const key = uri.toString();
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);
    pending.set(key, setTimeout(async () => {
      pending.delete(key);
      try {
        await options.client.agentRegistry.syncFile.mutate({ filePath: uri.fsPath });
        options.onSynced?.();
      } catch (error: any) {
        warn(`Failed to sync agent manifest: ${error?.message ?? String(error)}`);
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
      await options.client.agentRegistry.removeFile.mutate({ filePath: uri.fsPath });
      options.onSynced?.();
    } catch (error: any) {
      warn(`Failed to remove agent manifest: ${error?.message ?? String(error)}`);
    }
  };

  for (const folder of folders) {
    for (const pattern of [".syncpoint/agents/*.yml", ".syncpoint/agents/*.yaml", ".syncpoint/agents/*.json"]) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, pattern));
      watcher.onDidCreate(scheduleSync);
      watcher.onDidChange(scheduleSync);
      watcher.onDidDelete(handleRemove);
      disposables.push(watcher);
    }
  }

  void options.client.agentRegistry.sync.mutate()
    .then(() => options.onSynced?.())
    .catch((error: any) => warn(`Failed to sync agent manifests: ${error?.message ?? String(error)}`));

  disposables.push({
    dispose: () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  });

  return vscode.Disposable.from(...disposables);
}
