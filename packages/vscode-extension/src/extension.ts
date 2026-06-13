/**
 * SyncPoint VS Code Extension — Editor Sync View (P9).
 *
 * Connects to local SyncPoint server via tRPC SDK.
 * Tree view: views.ts | Commands & webview: commands.ts
 */

import path from "node:path";
import * as vscode from "vscode";
import { createSyncPointClient, createEventStream } from "syncpoint-sdk";
import type { EventStreamHandle } from "syncpoint-sdk";
import { formatResumePrompt } from "syncpoint-context";
import type { PromptFormat } from "syncpoint-context";
import type { AgentRole, UserAgentProvider } from "syncpoint-adapters";
import { createAgentManifestFile, getPrimaryWorkspaceFolder } from "./agent-manifest-files.js";
import { registerAgentManifestWatcher } from "./agent-manifest-watcher.js";
import { registerFileGuard } from "./file-guard.js";
import { registerGuardedEditor } from "./guarded-editor.js";
import { SyncViewProvider } from "./views.js";
import { pickResumeContext, registerGateCommands } from "./commands.js";

const DEFAULT_URL = "http://127.0.0.1:8765";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any;
let eventSource: EventStreamHandle | undefined;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("syncpoint");
  const url = config.get<string>("serverUrl", DEFAULT_URL);
  client = createSyncPointClient(url);

  const syncView = new SyncViewProvider();
  syncView.setClient(client);
  vscode.window.registerTreeDataProvider("syncpoint-sync-view", syncView);

  const syncpointChannel = vscode.window.createOutputChannel("SyncPoint");
  context.subscriptions.push(syncpointChannel);

  context.subscriptions.push(registerFileGuard({ client, onAudited: () => syncView.refresh() }));
  context.subscriptions.push(registerAgentManifestWatcher({
    client, onSynced: () => syncView.refresh(),
    onWarning: message => vscode.window.showWarningMessage(message),
    onCreated: uri => vscode.window.showInformationMessage(
      `New agent detected, synced into collaboration network: ${path.basename(uri.fsPath)}`),
    outputChannel: syncpointChannel,
  }));
  context.subscriptions.push(registerGuardedEditor({ client }));

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("syncpoint.startServer", async () => {
      const port = await vscode.window.showInputBox({ prompt: "Port number", value: "8765" });
      if (!port) return;
      try {
        const resp = await fetch(`${url}/status`);
        const data = await resp.json();
        vscode.window.showInformationMessage(`SyncPoint Sync View connected: v${(data as any).version}`);
        syncView.refresh();
      } catch {
        vscode.window.showWarningMessage(
          "SyncPoint server not reachable. Run `syncpoint server start` to inspect claims and blockers.");
      }
    }),

    vscode.commands.registerCommand("syncpoint.registerAgent", async () => {
      const workspaceRoot = getPrimaryWorkspaceFolder();
      if (!workspaceRoot) { vscode.window.showWarningMessage("No workspace folder open"); return; }
      const name = await vscode.window.showInputBox({ prompt: "Agent name" });
      if (!name) return;
      const provider = await vscode.window.showQuickPick(
        ["codex", "claude-code", "cursor", "cline", "copilot", "human", "other"],
        { placeHolder: "Provider" }
      ) as UserAgentProvider | undefined;
      if (!provider) return;
      const role = await vscode.window.showQuickPick(
        ["manager", "frontend", "backend", "tester", "reviewer", "other"],
        { placeHolder: "Role" }
      ) as AgentRole | undefined;
      if (!role) return;
      try {
        const fileUri = await createAgentManifestFile(workspaceRoot, { name, provider, role });
        await client.agentRegistry.syncFile.mutate({ filePath: fileUri.fsPath });
        syncView.refresh();
        vscode.window.showInformationMessage(`Agent manifest created: ${fileUri.fsPath}`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to register agent: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("syncpoint.createTask", async () => {
      const title = await vscode.window.showInputBox({ prompt: "Task title" });
      if (!title) return;
      try {
        await client.task.create.mutate({ title });
        syncView.refresh();
        vscode.window.showInformationMessage(`Task "${title}" created`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to create task: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("syncpoint.refreshStatus", () => { syncView.refresh(); }),

    vscode.commands.registerCommand("syncpoint.resumePrompt", async () => {
      const rc = await pickResumeContext(client);
      if (!rc) return;
      const format = await vscode.window.showQuickPick(
        ["system-prompt", "cursorrules", "agents-md", "checkpoint-md", "clipboard"],
        { placeHolder: "Prompt format" }
      ) as PromptFormat | undefined;
      if (!format) return;
      const text = formatResumePrompt(rc, format);
      const doc = await vscode.workspace.openTextDocument({ content: text, language: "markdown" });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand("syncpoint.copyResumePrompt", async () => {
      const rc = await pickResumeContext(client);
      if (!rc) return;
      const text = formatResumePrompt(rc, "clipboard");
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage("Synchronization-aware resume prompt copied to clipboard");
    }),

    vscode.commands.registerCommand("syncpoint.writeRulesFile", async () => {
      const rc = await pickResumeContext(client);
      if (!rc) return;
      const format = await vscode.window.showQuickPick(
        [
          { label: ".cursorrules", description: "Cursor / Windsurf rules file", format: "cursorrules" },
          { label: "AGENTS.md", description: "Project knowledge file", format: "agents-md" },
          { label: ".syncpoint/resume-prompt.md", description: "SyncPoint resume file", format: "system-prompt" },
        ],
        { placeHolder: "Target file" }
      ) as { label: string; format: string } | undefined;
      if (!format) return;
      const text = formatResumePrompt(rc, format.format as PromptFormat);
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) { vscode.window.showWarningMessage("No workspace folder open"); return; }
      const root = folders[0]!.uri;
      const fileUri = vscode.Uri.joinPath(root, format.label);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(text, "utf-8"));
      vscode.window.showInformationMessage(`Written: ${format.label}`);
    }),

    ...registerGateCommands(client, syncView)
  );

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = "syncpoint.resumePrompt";
  statusBarItem.text = "$(sync) SyncPoint";
  statusBarItem.tooltip = "SyncPoint: inspect sync context and generate a blocker-aware resume prompt";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // SSE auto-refresh
  eventSource = createEventStream(url, () => { syncView.refresh(); });

  // Initial load
  syncView.refresh();
}

export function deactivate() {
  eventSource?.close();
}
