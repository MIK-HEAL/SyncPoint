/**
 * SyncPoint VS Code Extension — Editor Sync View (P9).
 *
 * Connects to local SyncPoint server via tRPC SDK.
 * Displays a comprehensive sync map: sessions, agents, file ownership,
 * blockers, patches, and wake queue in a unified tree view.
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

// ── Tree node types ────────────────────────────────────

interface SyncSection {
  kind: "section";
  label: string;
  icon: string;
  badge?: string;
  children: SyncNode[];
}

interface SyncItem {
  kind: "item";
  label: string;
  description: string;
  icon: string;
  tooltip?: string;
  children?: SyncNode[];
}

type SyncNode = SyncSection | SyncItem;

function section(label: string, icon: string, children: SyncNode[], badge?: string): SyncSection {
  return { kind: "section", label, icon, children, badge };
}

function item(label: string, description: string, icon: string, tooltip?: string, children?: SyncNode[]): SyncItem {
  return { kind: "item", label, description, icon, tooltip, children };
}

// ── Sync View Provider ─────────────────────────────────

class SyncViewProvider implements vscode.TreeDataProvider<SyncNode> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _root: SyncNode[] = [];

  refresh(): void {
    this._loadSnapshot().then(() => this._onDidChange.fire());
  }

  getTreeItem(element: SyncNode): vscode.TreeItem {
    if (element.kind === "section") {
      const count = element.badge ?? String(element.children.length);
      const ti = new vscode.TreeItem(
        `${element.label} (${count})`,
        element.children.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None
      );
      ti.iconPath = new vscode.ThemeIcon(element.icon);
      return ti;
    }
    // item
    const ti = new vscode.TreeItem(
      element.label,
      element.children?.length
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    ti.description = element.description;
    ti.iconPath = new vscode.ThemeIcon(element.icon);
    if (element.tooltip) ti.tooltip = element.tooltip;
    return ti;
  }

  getChildren(element?: SyncNode): SyncNode[] {
    if (!element) return this._root;
    if (element.kind === "section") return element.children;
    return element.children ?? [];
  }

  private async _loadSnapshot(): Promise<void> {
    try {
      const data = await client.syncStatus.snapshot.query();
      const root: SyncNode[] = [];

      // ── Summary bar ──
      const s = data.summary;
      root.push(item(
        "Sync Status",
        s.blockerCount > 0
          ? `\u26A0 ${s.blockerCount} blocker${s.blockerCount > 1 ? "s" : ""}`
          : "\u2714 All clear",
        s.blockerCount > 0 ? "warning" : "pass",
        `Sessions: ${s.activeSessionCount} | Agents: ${s.agentCount} | Blocked: ${s.blockedAgentCount}\n` +
        `Claims: ${s.activeClaimCount} | Hard conflicts: ${s.hardConflictCount}\n` +
        `Patches: ${s.pendingPatchCount} | Wakes: ${s.pendingWakeCount}`
      ));

      // ── 1. Sessions ──
      root.push(section("Sessions", "symbol-event",
        data.sessions.map((sess: any) =>
          item(
            sess.title,
            `${sess.status} \u2022 ${sess.relationshipMode}`,
            "window",
            undefined,
            sess.agents.map((a: any) =>
              item(a.agentName, a.role, "person")
            )
          )
        )
      ));

      // ── 2. Agents / Active Work ──
      root.push(section("Active Work", "robot",
        data.agents.filter((a: any) => a.activeAssignments.length > 0 || a.blocked).map((a: any) => {
          const children: SyncNode[] = [];
          for (const ta of a.activeAssignments) {
            children.push(item(
              ta.taskTitle,
              ta.status,
              ta.status === "IN_PROGRESS" ? "play" : "circle-outline"
            ));
          }
          if (a.claimedFiles.length) {
            for (const c of a.claimedFiles) {
              children.push(item(c.paths, `${c.mode}`, c.mode === "exclusive" ? "lock" : "unlock"));
            }
          }
          return item(
            a.blocked ? `\u26D4 ${a.name}` : a.name,
            a.blocked ? "BLOCKED" : `${a.activeAssignments.length} task(s)`,
            a.blocked ? "error" : "person",
            `Provider: ${a.provider} | Role: ${a.role}\nWakes: ${a.pendingWakeCount}`,
            children
          );
        })
      ));

      // ── 3. File Ownership ──
      const fo = data.fileOwnership;
      const fileChildren: SyncNode[] = [];
      for (const c of fo.activeClaims) {
        fileChildren.push(item(
          c.paths,
          `${c.agentName} \u2022 ${c.mode}`,
          c.mode === "exclusive" ? "lock" : "unlock",
          `Task: ${c.taskTitle}`
        ));
      }
      if (fo.conflicts.length) {
        fileChildren.push(section("Conflicts", "flame",
          fo.conflicts.map((c: any) =>
            item(
              c.overlappingPath,
              c.isHardConflict ? "HARD CONFLICT" : "soft overlap",
              c.isHardConflict ? "error" : "warning",
              `${c.claimA.agentName} (${c.claimA.mode}) vs ${c.claimB.agentName} (${c.claimB.mode})`
            )
          )
        ));
      }
      root.push(section("File Ownership", "file-symlink-file", fileChildren,
        `${fo.stats.totalClaims} claims, ${fo.stats.hardConflicts} conflicts`));

      // ── 4. Sync Blockers ──
      root.push(section("Blockers", "shield",
        data.blockers.map((b: any) => {
          const agentNames = b.requiredAgents.map((a: any) => a.name).join(", ");
          const iconMap: Record<string, string> = {
            sync_gate: "shield",
            sync_transaction: "git-pull-request",
            handoff: "arrow-swap",
            review: "eye",
          };
          return item(
            b.description || b.reason,
            `${b.type} \u2022 ${b.status}`,
            iconMap[b.type] || "warning",
            `Needs: ${agentNames}\nTask: ${b.relatedTaskId ?? "global"}`
          );
        })
      ));

      // ── 5. Patches ──
      root.push(section("Patches", "diff",
        data.patches.map((p: any) =>
          item(
            p.title,
            `${p.status} \u2022 ${p.needsAction}`,
            p.status === "APPROVED" ? "pass" :
            p.status === "CONFLICTING" ? "error" :
            p.status === "SUBMITTED" ? "eye" : "edit",
            `By: ${p.agentName}\nFiles: ${p.touchedFiles}\nTask: ${p.taskTitle}`
          )
        )
      ));

      // ── 6. Wake Queue ──
      root.push(section("Wake Queue", "bell",
        data.wakeQueue.map((w: any) =>
          item(
            w.targetAgentName,
            `${w.reason}`,
            "bell-dot",
            `Event: ${w.sourceEvent}\nCreated: ${w.createdAt}`
          )
        )
      ));

      this._root = root;
    } catch {
      this._root = [item("(server not running)", "Start with: syncpoint server start", "warning")];
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

  // Unified Sync View — single tree with all 6 sections
  const syncView = new SyncViewProvider();
  vscode.window.registerTreeDataProvider("syncpoint-sync-view", syncView);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("syncpoint.startServer", async () => {
      const port = await vscode.window.showInputBox({
        prompt: "Port number",
        value: "8765",
      });
      if (!port) return;
      try {
        const resp = await fetch(`${url}/status`);
        const data = await resp.json();
        vscode.window.showInformationMessage(`SyncPoint Sync View connected: v${(data as any).version}`);
        syncView.refresh();
      } catch {
        vscode.window.showWarningMessage("SyncPoint server not reachable. Run `syncpoint server start` to inspect claims and blockers.");
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
        syncView.refresh();
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
        syncView.refresh();
        vscode.window.showInformationMessage(`Task "${title}" created`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to create task: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("syncpoint.refreshStatus", () => {
      syncView.refresh();
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
      vscode.window.showInformationMessage("Synchronization-aware resume prompt copied to clipboard");
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
  statusBarItem.tooltip = "SyncPoint: inspect sync context and generate a blocker-aware resume prompt";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Auto-refresh via SSE — all state changes trigger a single snapshot reload
  eventSource = createEventStream(url, () => {
    syncView.refresh();
  });

  // Initial load
  syncView.refresh();
}

export function deactivate() {
  eventSource?.close();
}
