/**
 * SyncPoint VS Code Extension — thin read-only TreeView panel.
 *
 * Connects to local SyncPoint server via tRPC SDK.
 * Displays agents, tasks, and latest checkpoints.
 */

import * as vscode from "vscode";
import { createSyncPointClient, createEventStream } from "syncpoint-sdk";
import type { EventStreamHandle } from "syncpoint-sdk";
import { formatResumePrompt } from "syncpoint-core";
import type { PromptFormat, ResumeContext } from "syncpoint-core";

const DEFAULT_URL = "http://127.0.0.1:8765";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any;
let eventSource: EventStreamHandle | undefined;
let statusBarItem: vscode.StatusBarItem;

// ── Tree data providers ────────────────────────────────

class AgentsProvider implements vscode.TreeDataProvider<AgentItem> {
  private _onDidChange = new vscode.EventEmitter<AgentItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: AgentItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<AgentItem[]> {
    try {
      const agents = await client.agent.list.query();
      return agents.map(
        (a) =>
          new AgentItem(
            `${a.name}  [${a.status}]`,
            `${a.provider} / ${a.role}`,
            a.status === "IDLE"
              ? vscode.TreeItemCollapsibleState.None
              : vscode.TreeItemCollapsibleState.Collapsed
          )
      );
    } catch {
      return [new AgentItem("(server not running)", "", vscode.TreeItemCollapsibleState.None)];
    }
  }
}

class TasksProvider implements vscode.TreeDataProvider<TaskItem> {
  private _onDidChange = new vscode.EventEmitter<TaskItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: TaskItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<TaskItem[]> {
    try {
      const tasks = await client.task.list.query();
      return tasks.map(
        (t) =>
          new TaskItem(
            `${t.title}  [${t.status}]`,
            t.ownerAgentId ?? "unassigned",
            vscode.TreeItemCollapsibleState.None
          )
      );
    } catch {
      return [new TaskItem("(server not running)", "", vscode.TreeItemCollapsibleState.None)];
    }
  }
}

class CheckpointsProvider implements vscode.TreeDataProvider<CheckpointItem> {
  private _onDidChange = new vscode.EventEmitter<CheckpointItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(element: CheckpointItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<CheckpointItem[]> {
    try {
      const tasks = await client.task.list.query();
      const items: CheckpointItem[] = [];
      for (const t of tasks) {
        const cps = await client.checkpoint.list.query({ taskId: t.id });
        if (cps.length) {
          const latest = cps[cps.length - 1];
          items.push(
            new CheckpointItem(
              `Task ${t.id.slice(0, 6)}: ${latest.summary.slice(0, 60)}`,
              latest.needSync ? "⚠ needs sync" : latest.createdAt,
              vscode.TreeItemCollapsibleState.None
            )
          );
        }
      }
      return items.length ? items : [new CheckpointItem("(no checkpoints)", "", vscode.TreeItemCollapsibleState.None)];
    } catch {
      return [new CheckpointItem("(server not running)", "", vscode.TreeItemCollapsibleState.None)];
    }
  }
}

// ── Tree items ─────────────────────────────────────────

class AgentItem extends vscode.TreeItem {
  constructor(label: string, desc: string, state: vscode.TreeItemCollapsibleState) {
    super(label, state);
    this.description = desc;
    this.iconPath = new vscode.ThemeIcon("robot");
  }
}

class TaskItem extends vscode.TreeItem {
  constructor(label: string, desc: string, state: vscode.TreeItemCollapsibleState) {
    super(label, state);
    this.description = desc;
    this.iconPath = new vscode.ThemeIcon("checklist");
  }
}

class CheckpointItem extends vscode.TreeItem {
  constructor(label: string, desc: string, state: vscode.TreeItemCollapsibleState) {
    super(label, state);
    this.description = desc;
    this.iconPath = new vscode.ThemeIcon("bookmark");
  }
}

// ── Sync Status tree data provider ──────────────────────

interface SyncSection {
  kind: "header";
  label: string;
  icon: string;
  children: SyncLeaf[];
}

interface SyncLeaf {
  label: string;
  description: string;
  icon: string;
  tooltip?: string;
}

class SyncStatusProvider implements vscode.TreeDataProvider<SyncSection | SyncLeaf> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _sections: SyncSection[] = [];

  refresh(): void {
    this._loadData().then(() => this._onDidChange.fire());
  }

  getTreeItem(element: SyncSection | SyncLeaf): vscode.TreeItem {
    if ("children" in element) {
      const item = new vscode.TreeItem(
        `${element.label} (${element.children.length})`,
        element.children.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon(element.icon);
      return item;
    }
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.iconPath = new vscode.ThemeIcon(element.icon);
    if (element.tooltip) item.tooltip = element.tooltip;
    return item;
  }

  getChildren(element?: SyncSection | SyncLeaf): (SyncSection | SyncLeaf)[] {
    if (!element) return this._sections;
    if ("children" in element) return element.children;
    return [];
  }

  private async _loadData(): Promise<void> {
    try {
      const data = await client.syncStatus.overview.query();
      const sections: SyncSection[] = [];

      // 1. Agents — who is working, who is blocked
      sections.push({
        kind: "header",
        label: "Agents",
        icon: "robot",
        children: data.agents.map((a: any) => ({
          label: a.blocked ? `\u26D4 ${a.name}` : a.name,
          description: a.blocked ? "BLOCKED" : `${a.status} \u2022 wakes: ${a.pendingWakes}`,
          icon: a.blocked ? "error" : "person",
          tooltip: a.claimedFiles.length
            ? `Claimed: ${a.claimedFiles.join(", ")}`
            : undefined,
        })),
      });

      // 2. Active Sessions
      sections.push({
        kind: "header",
        label: "Sessions",
        icon: "symbol-event",
        children: data.activeSessions.map((s: any) => ({
          label: s.title,
          description: `${s.status} \u2022 ${s.relationshipMode}`,
          icon: "window",
        })),
      });

      // 3. Sync Gates
      sections.push({
        kind: "header",
        label: "Sync Gates",
        icon: "shield",
        children: data.activeGates.map((g: any) => ({
          label: g.description || g.reason || g.id,
          description: `${g.status} \u2022 ${g.reason}`,
          icon: "warning",
          tooltip: `Required: ${g.requiredAgentIds}\nAcked: ${g.ackedAgentIds || "none"}`,
        })),
      });

      // 4. File Claims
      sections.push({
        kind: "header",
        label: "File Claims",
        icon: "file-symlink-file",
        children: data.claims.map((c: any) => ({
          label: c.paths,
          description: `by ${c.agentId}`,
          icon: "lock",
        })),
      });

      // 5. Conflicts
      sections.push({
        kind: "header",
        label: "Conflicts",
        icon: "flame",
        children: data.conflicts.map((c: any) => ({
          label: c.path ?? c.overlappingPaths?.join(", ") ?? "conflict",
          description: `agents: ${c.claimIds?.join(", ") ?? "?"}`,
          icon: "error",
        })),
      });

      this._sections = sections;
    } catch {
      this._sections = [{
        kind: "header",
        label: "(server not running)",
        icon: "warning",
        children: [],
      }];
    }
  }
}

// ── Resume context picker ─────────────────────────────

async function pickResumeContext(): Promise<ResumeContext | undefined> {
  try {
    const tasks = await client.task.list.query();
    if (!tasks.length) {
      vscode.window.showWarningMessage("No tasks found.");
      return undefined;
    }
    const taskPick = await vscode.window.showQuickPick(
      tasks.map((t: any) => ({ label: t.title, description: `[${t.status}]`, id: t.id })),
      { placeHolder: "Select task" }
    ) as unknown as { id: string } | undefined;
    if (!taskPick) return undefined;

    const agents = await client.agent.list.query();
    if (!agents.length) {
      vscode.window.showWarningMessage("No agents found.");
      return undefined;
    }
    const agentPick = await vscode.window.showQuickPick(
      agents.map((a: any) => ({ label: a.name, description: `${a.provider} / ${a.role}`, id: a.id })),
      { placeHolder: "Select agent" }
    ) as unknown as { id: string } | undefined;
    if (!agentPick) return undefined;

    return await client.resumeContext.get.query({ taskId: taskPick.id, agentId: agentPick.id }) as ResumeContext;
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to get resume context: ${e.message}`);
    return undefined;
  }
}

// ── Extension activation ──────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("syncpoint");
  const url = config.get<string>("serverUrl", DEFAULT_URL);
  client = createSyncPointClient(url);

  const agentsProvider = new AgentsProvider();
  const tasksProvider = new TasksProvider();
  const checkpointsProvider = new CheckpointsProvider();
  const syncStatusProvider = new SyncStatusProvider();

  // Register tree views
  vscode.window.registerTreeDataProvider("syncpoint-agents", agentsProvider);
  vscode.window.registerTreeDataProvider("syncpoint-tasks", tasksProvider);
  vscode.window.registerTreeDataProvider("syncpoint-checkpoints", checkpointsProvider);
  vscode.window.registerTreeDataProvider("syncpoint-sync-status", syncStatusProvider);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("syncpoint.startServer", async () => {
      const port = await vscode.window.showInputBox({
        prompt: "Port number",
        value: "8765",
      });
      if (!port) return;
      // Server is started externally via CLI; just verify connection
      try {
        const resp = await fetch(`${url}/status`);
        const data = await resp.json();
        vscode.window.showInformationMessage(`SyncPoint server connected: v${(data as any).version}`);
      } catch {
        vscode.window.showWarningMessage("SyncPoint server not reachable. Run `syncpoint server start` first.");
      }
    }),

    vscode.commands.registerCommand("syncpoint.registerAgent", async () => {
      const name = await vscode.window.showInputBox({ prompt: "Agent name" });
      if (!name) return;
      const provider = await vscode.window.showQuickPick(
        ["codex", "claude-code", "cursor", "cline", "copilot", "human", "other"],
        { placeHolder: "Provider" }
      );
      if (!provider) return;
      const role = await vscode.window.showQuickPick(
        ["manager", "frontend", "backend", "tester", "reviewer", "other"],
        { placeHolder: "Role" }
      );
      if (!role) return;
      try {
        await client.agent.create.mutate({ name, provider, role });
        agentsProvider.refresh();
        vscode.window.showInformationMessage(`Agent "${name}" registered`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to register agent: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("syncpoint.createTask", async () => {
      const title = await vscode.window.showInputBox({ prompt: "Task title" });
      if (!title) return;
      try {
        await client.task.create.mutate({ title });
        tasksProvider.refresh();
        vscode.window.showInformationMessage(`Task "${title}" created`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to create task: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("syncpoint.refreshStatus", () => {
      agentsProvider.refresh();
      tasksProvider.refresh();
      checkpointsProvider.refresh();
      syncStatusProvider.refresh();
    }),

    vscode.commands.registerCommand("syncpoint.resumePrompt", async () => {
      const rc = await pickResumeContext();
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
      const rc = await pickResumeContext();
      if (!rc) return;
      const text = formatResumePrompt(rc, "clipboard");
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage("Resume prompt copied to clipboard");
    }),

    vscode.commands.registerCommand("syncpoint.writeRulesFile", async () => {
      const rc = await pickResumeContext();
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
      const root = folders[0].uri;
      const fileUri = vscode.Uri.joinPath(root, format.label);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(text, "utf-8"));
      vscode.window.showInformationMessage(`Written: ${format.label}`);
    })
  );

  // Status bar — context readiness
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = "syncpoint.resumePrompt";
  statusBarItem.text = "$(sync) SyncPoint";
  statusBarItem.tooltip = "SyncPoint: Click to generate resume prompt";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Auto-refresh via SSE
  eventSource = createEventStream(url, () => {
    agentsProvider.refresh();
    tasksProvider.refresh();
    checkpointsProvider.refresh();
    syncStatusProvider.refresh();
  });

  // Initial load for sync status
  syncStatusProvider.refresh();
}

export function deactivate() {
  eventSource?.close();
}
