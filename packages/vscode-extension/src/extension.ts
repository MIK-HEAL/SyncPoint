/**
 * SyncPoint VS Code Extension — Editor Sync View (P9).
 *
 * Connects to local SyncPoint server via tRPC SDK.
 * Displays a comprehensive sync map: sessions, agents, resource ownership,
 * blockers, operations, and wake queue in a unified tree view.
 */

import path from "node:path";
import * as vscode from "vscode";
import { createSyncPointClient, createEventStream } from "syncpoint-sdk";
import type { EventStreamHandle } from "syncpoint-sdk";
import { formatResumePrompt } from "syncpoint-context";
import type { PromptFormat, ResumeContext } from "syncpoint-context";
import type { AgentRole, UserAgentProvider } from "syncpoint-adapters";
import { createAgentManifestFile, getPrimaryWorkspaceFolder } from "./agent-manifest-files.js";
import { registerAgentManifestWatcher } from "./agent-manifest-watcher.js";
import { registerFileGuard } from "./file-guard.js";
import { registerGuardedEditor } from "./guarded-editor.js";

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
  contextValue?: string;
  gateId?: string;
}

type SyncNode = SyncSection | SyncItem;

function section(label: string, icon: string, children: SyncNode[], badge?: string): SyncSection {
  return { kind: "section", label, icon, children, badge };
}

function item(label: string, description: string, icon: string, tooltip?: string, children?: SyncNode[]): SyncItem {
  return { kind: "item", label, description, icon, tooltip, children };
}

function gateItem(label: string, description: string, icon: string, gateId: string, tooltip?: string, children?: SyncNode[]): SyncItem {
  return { kind: "item", label, description, icon, tooltip, children, contextValue: "syncGateBlocker", gateId };
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
    if (element.contextValue) ti.contextValue = element.contextValue;
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
        `Operations: ${s.pendingOperationCount} | Wakes: ${s.pendingWakeCount}`
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
          if (a.claimedResources.length) {
            for (const c of a.claimedResources) {
              const locs = c.resources.map((r: any) => r.locator).join(", ");
              children.push(item(locs, `${c.mode}`, c.mode === "exclusive" ? "lock" : "unlock"));
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

      // ── 3. Resource Ownership ──
      const fo = data.resourceOwnership;
      const resourceChildren: SyncNode[] = [];
      for (const c of fo.activeClaims) {
        const locs = c.resources.map((r: any) => r.locator).join(", ");
        resourceChildren.push(item(
          locs,
          `${c.actorName} \u2022 ${c.mode}`,
          c.mode === "exclusive" ? "lock" : "unlock",
          `Task: ${c.taskTitle}`
        ));
      }
      if (fo.conflicts.length) {
        resourceChildren.push(section("Conflicts", "flame",
          fo.conflicts.map((c: any) =>
            item(
              c.overlappingLocator,
              "conflict",
              "warning",
              `${c.claimA.actorName} (${c.claimA.mode}) vs ${c.claimB.actorName} (${c.claimB.mode})`
            )
          )
        ));
      }
      root.push(section("Resource Ownership", "file-symlink-file", resourceChildren,
        `${fo.stats.totalClaims} claims, ${fo.stats.hardConflicts} conflicts`));

      // ── 4. Sync Blockers ──
      root.push(section("Blockers", "shield",
        data.blockers.map((b: any) => {
          const agentNames = b.requiredAgents.map((a: any) => a.name).join(", ");
          const iconMap: Record<string, string> = {
            sync_gate: "shield",
            checkpoint_review: "git-pull-request",
            handoff: "arrow-swap",
            review: "eye",
          };

          // Enhanced gate blocker with details
          if (b.type === "sync_gate" && b.gateDetails) {
            const gd = b.gateDetails;
            const gateIcon = gd.requiresHuman ? "alert"
              : b.status === "PARTIALLY_ACKED" ? "clock"
              : b.status === "ESCALATED" ? "flame"
              : b.status === "TIMED_OUT" ? "watch"
              : "shield";

            const detailChildren: SyncNode[] = [
              item("Policy", gd.policy, "settings-gear"),
              item("Status", b.status, "info"),
            ];
            if (gd.deadlineAt) {
              detailChildren.push(item("Deadline", gd.deadlineAt, "calendar"));
            }
            if (gd.requiresHuman) {
              detailChildren.push(item("Requires Human Decision", "Manual action needed", "alert"));
            }
            if (gd.escalationAgentIds?.length) {
              detailChildren.push(item("Escalation", gd.escalationAgentIds.join(", "), "mention"));
            }
            detailChildren.push(item("Pending", agentNames || "none", "person"));

            const tooltip = `Policy: ${gd.policy}\nStatus: ${b.status}` +
              (gd.deadlineAt ? `\nDeadline: ${gd.deadlineAt}` : "") +
              (gd.requiresHuman ? "\n⚠ Requires human decision" : "") +
              `\nNeeds: ${agentNames}\nTask: ${b.relatedTaskId ?? "global"}`;

            return gateItem(
              b.description || b.reason,
              `${b.status} • ${gd.policy}`,
              gateIcon,
              b.id,
              tooltip,
              detailChildren
            );
          }

          return item(
            b.description || b.reason,
            `${b.type} • ${b.status}`,
            iconMap[b.type] || "warning",
            `Needs: ${agentNames}\nTask: ${b.relatedTaskId ?? "global"}`
          );
        })
      ));

      // ── 5. Operations ──
      root.push(section("Operations", "diff",
        data.operations.map((op: any) =>
          item(
            op.title,
            `${op.status} \u2022 ${op.needsAction}`,
            op.status === "APPROVED" ? "pass" :
            op.status === "CONFLICTING" ? "error" :
            op.status === "SUBMITTED" ? "eye" : "edit",
            `By: ${op.actorName}\nTask: ${op.taskTitle}`
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

      // ── 7. Agent Registry ──
      try {
        const registry = await client.agentRegistry.list.query({});
        const runningAgents = registry.filter((a: any) => a.availability === "running");
        const offlineAgents = registry.filter((a: any) => a.availability === "offline");
        const availableAgents = registry.filter((a: any) => a.availability === "available");
        const errorAgents = registry.filter((a: any) => a.availability === "error");
        const removedAgents = registry.filter((a: any) => a.availability === "removed");
        const badge = errorAgents.length > 0
          ? `${runningAgents.length} running, ${errorAgents.length} error`
          : `${runningAgents.length} running`;

        const registryChildren: SyncNode[] = [];

        if (runningAgents.length) {
          registryChildren.push(section("Running", "pulse",
            runningAgents.map((a: any) => {
              const capStr = a.manifest?.capabilities?.map((c: any) => c.domain).join(", ") ?? "";
              const tagStr = a.manifest?.tags?.join(", ") ?? "";
              const tooltip = `Provider: ${a.provider ?? "?"} | Role: ${a.role ?? "?"}` +
                (capStr ? `\nCapabilities: ${capStr}` : "") +
                (tagStr ? `\nTags: ${tagStr}` : "") +
                `\nManifest: ${a.manifestPath}`;
              return item(a.name ?? "(unnamed)", `${a.provider ?? "?"} / ${a.role ?? "?"}`, "pulse", tooltip);
            })
          ));
        }

        if (offlineAgents.length) {
          registryChildren.push(section("Offline", "debug-pause",
            offlineAgents.map((a: any) =>
              item(a.name ?? "(unnamed)", `${a.provider ?? "?"} / ${a.role ?? "?"}`, "debug-pause", `Last sync: ${a.lastSyncAt}\nManifest: ${a.manifestPath}`)
            )
          ));
        }

        if (availableAgents.length) {
          registryChildren.push(section("Available", "circle-outline",
            availableAgents.map((a: any) =>
              item(a.name ?? "(unnamed)", `${a.provider ?? "?"} / ${a.role ?? "?"}`, "circle-outline", `Not yet bound to a runtime\nManifest: ${a.manifestPath}`)
            )
          ));
        }

        if (errorAgents.length) {
          registryChildren.push(section("Parse Errors", "error",
            errorAgents.map((a: any) =>
              item(
                a.manifestPath,
                a.errorMessage ?? "unknown error",
                "error",
                `Fix: check file for syntax errors or missing required fields`
              )
            )
          ));
        }

        if (removedAgents.length) {
          registryChildren.push(section("Removed", "trash",
            removedAgents.map((a: any) =>
              item(
                a.name ?? a.manifestPath,
                "removed",
                "trash",
                a.exists ? "File still exists — run syncpoint agent sync to reconcile" : "File deleted"
              )
            )
          ));
        }

        root.push(section("Agent Registry", "organization", registryChildren, badge));
      } catch {
        // Agent registry not available — skip section
      }

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

// ── Gate picker ───────────────────────────────────────

async function pickGate(): Promise<string | undefined> {
  try {
    const gates = await client.syncGate.listActive.query();
    if (!gates.length) {
      vscode.window.showWarningMessage("No active sync gates.");
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(
      gates.map((g: any) => ({
        label: g.description || g.reason || g.id,
        description: `[${g.status}] ${g.requiredAgentIds}`,
        id: g.id,
      })),
      { placeHolder: "Select sync gate" }
    ) as unknown as { id: string } | undefined;
    return pick?.id;
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to list gates: ${e.message}`);
    return undefined;
  }
}

async function pickAgent(): Promise<string | undefined> {
  try {
    const agents = await client.agent.list.query();
    if (!agents.length) {
      vscode.window.showWarningMessage("No agents found.");
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(
      agents.map((a: any) => ({ label: a.name, description: `${a.provider} / ${a.role}`, id: a.id })),
      { placeHolder: "Select agent" }
    ) as unknown as { id: string } | undefined;
    return pick?.id;
  } catch (e: any) {
    vscode.window.showErrorMessage(`Failed to list agents: ${e.message}`);
    return undefined;
  }
}

// ── Gate decision commands ─────────────────────────────

function registerGateCommands(syncView: SyncViewProvider): vscode.Disposable[] {
  async function voteOnGate(vote: string) {
    const gateId = await pickGate();
    if (!gateId) return;
    const agentId = await pickAgent();
    if (!agentId) return;
    const summary = await vscode.window.showInputBox({ prompt: `${vote} summary (optional)` }) ?? "";
    try {
      await client.syncGate.vote.mutate({ gateId, agentId, vote, summary });
      syncView.refresh();
      vscode.window.showInformationMessage(`Vote '${vote}' cast on gate.`);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Vote failed: ${e.message}`);
    }
  }

  return [
    vscode.commands.registerCommand("syncpoint.gateApprove", () => voteOnGate("approve")),
    vscode.commands.registerCommand("syncpoint.gateReject", () => voteOnGate("reject")),
    vscode.commands.registerCommand("syncpoint.gateAbstain", () => voteOnGate("abstain")),
    vscode.commands.registerCommand("syncpoint.gateEscalate", () => voteOnGate("escalate")),

    vscode.commands.registerCommand("syncpoint.gateResolve", async () => {
      const gateId = await pickGate();
      if (!gateId) return;
      const summary = await vscode.window.showInputBox({ prompt: "Resolution summary" }) ?? "";
      try {
        await client.syncGate.resolve.mutate({ gateId, summary });
        syncView.refresh();
        vscode.window.showInformationMessage("Gate resolved.");
      } catch (e: any) {
        vscode.window.showErrorMessage(`Resolve failed: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("syncpoint.gateCancel", async () => {
      const gateId = await pickGate();
      if (!gateId) return;
      const reason = await vscode.window.showInputBox({ prompt: "Cancellation reason" }) ?? "";
      try {
        await client.syncGate.cancel.mutate({ gateId, reason });
        syncView.refresh();
        vscode.window.showInformationMessage("Gate cancelled.");
      } catch (e: any) {
        vscode.window.showErrorMessage(`Cancel failed: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand("syncpoint.openDecisionPanel", async () => {
      const gateId = await pickGate();
      if (!gateId) return;
      const agentId = await pickAgent();
      try {
        const detail = await client.syncGate.status.query({ gateId, agentId });
        openDecisionPanel(detail, gateId, syncView);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to load gate detail: ${e.message}`);
      }
    }),
  ];
}

// ── Decision Panel Webview ────────────────────────────

function openDecisionPanel(detail: any, gateId: string, syncView: SyncViewProvider): void {
  const panel = vscode.window.createWebviewPanel(
    "syncpointDecision",
    `Gate Decision: ${detail.gate.description || gateId}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  panel.webview.html = buildDecisionHtml(detail, gateId);

  panel.webview.onDidReceiveMessage(async (msg: any) => {
    try {
      if (msg.type === "vote") {
        await client.syncGate.vote.mutate({
          gateId,
          agentId: msg.agentId,
          vote: msg.vote,
          summary: msg.summary || "",
        });
        vscode.window.showInformationMessage(`Vote '${msg.vote}' cast.`);
      } else if (msg.type === "resolve") {
        await client.syncGate.resolve.mutate({ gateId, summary: msg.summary || "" });
        vscode.window.showInformationMessage("Gate resolved.");
      } else if (msg.type === "cancel") {
        await client.syncGate.cancel.mutate({ gateId, reason: msg.reason || "" });
        vscode.window.showInformationMessage("Gate cancelled.");
      }

      // Refresh and update panel
      syncView.refresh();
      const updated = await client.syncGate.status.query({ gateId, agentId: msg.agentId });
      panel.webview.html = buildDecisionHtml(updated, gateId);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Action failed: ${e.message}`);
    }
  });
}

function buildDecisionHtml(detail: any, gateId: string): string {
  const g = detail.gate;
  const vc = detail.voteCounts;
  const totalVotes = (vc?.approve ?? 0) + (vc?.reject ?? 0) + (vc?.abstain ?? 0) + (vc?.escalate ?? 0);
  const actions = detail.availableActions ?? [];
  const liveness = detail.livenessPreview;

  const votesHtml = totalVotes > 0 ? `
    <div class="card">
      <h3>Votes</h3>
      <div class="vote-bar">
        <span class="approve">✓ ${vc.approve}</span>
        <span class="reject">✗ ${vc.reject}</span>
        <span class="abstain">○ ${vc.abstain}</span>
        <span class="escalate">↑ ${vc.escalate}</span>
      </div>
    </div>` : "";

  const actionsHtml = actions.filter((a: string) => a !== "view_only").map((a: string) => {
    if (a === "ack") return `<button onclick="doVote('approve')">Acknowledge</button>`;
    if (a === "vote" || a === "change_vote") return `
      <button onclick="doVote('approve')">Approve</button>
      <button onclick="doVote('reject')" class="danger">Reject</button>
      <button onclick="doVote('abstain')">Abstain</button>
      <button onclick="doVote('escalate')" class="warn">Escalate</button>`;
    if (a === "owner_override" || a === "resolve") return `<button onclick="doResolve()">Resolve</button>`;
    if (a === "cancel") return `<button onclick="doCancel()" class="danger">Cancel</button>`;
    if (a === "request_more_info") return `<button onclick="doVote('abstain')">Request Info</button>`;
    return "";
  }).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; padding: 12px; margin-bottom: 12px; }
  h2 { margin: 0 0 8px; font-size: 16px; }
  h3 { margin: 0 0 6px; font-size: 13px; color: var(--vscode-descriptionForeground); }
  .status { font-weight: bold; }
  .status.blocking { color: var(--vscode-errorForeground); }
  .status.resolved { color: var(--vscode-testing-iconPassed); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
  .badge.human { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); }
  .vote-bar { display: flex; gap: 12px; font-size: 14px; }
  .approve { color: var(--vscode-testing-iconPassed); }
  .reject { color: var(--vscode-errorForeground); }
  .abstain { color: var(--vscode-descriptionForeground); }
  .escalate { color: var(--vscode-editorWarning-foreground); }
  dl { margin: 0; }
  dt { font-weight: bold; margin-top: 6px; }
  dd { margin: 0 0 0 12px; }
  button { padding: 6px 14px; margin: 4px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.danger { background: var(--vscode-inputValidation-errorBackground); }
  button.warn { background: var(--vscode-inputValidation-warningBackground); }
  .actions { margin-top: 12px; }
  textarea { width: 100%; min-height: 40px; margin: 6px 0; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 6px; font-family: inherit; }
</style>
</head>
<body>
  <h2>${g.description || "Sync Gate"}</h2>

  <div class="card">
    <h3>Overview</h3>
    <dl>
      <dt>Status</dt><dd class="status ${detail.isBlocking ? "blocking" : "resolved"}">${g.status}</dd>
      <dt>Policy</dt><dd>${detail.policy?.kind ?? "all_required"}</dd>
      <dt>Required</dt><dd>${detail.requiredAgentIds?.join(", ") ?? "—"}</dd>
      <dt>Acked</dt><dd>${detail.ackedAgentIds?.join(", ") || "none"}</dd>
      <dt>Pending</dt><dd>${detail.pendingAgentIds?.join(", ") || "none"}</dd>
      ${detail.deadlineAt ? `<dt>Deadline</dt><dd>${detail.deadlineAt}</dd>` : ""}
      ${detail.requiresHuman ? `<dt><span class="badge human">⚠ Requires Human</span></dt><dd></dd>` : ""}
      <dt>Liveness</dt><dd>${liveness?.action ?? "—"} — ${liveness?.reason ?? ""}</dd>
    </dl>
  </div>

  ${votesHtml}

  <div class="card actions">
    <h3>Actions</h3>
    <textarea id="summary" placeholder="Decision summary (optional)"></textarea>
    <div>${actionsHtml || "<em>No actions available (view only)</em>"}</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function doVote(vote) {
      const summary = document.getElementById("summary").value;
      vscode.postMessage({ type: "vote", vote, summary, agentId: "${detail.availableActions ? "prompted" : ""}" });
    }
    function doResolve() {
      const summary = document.getElementById("summary").value;
      vscode.postMessage({ type: "resolve", summary });
    }
    function doCancel() {
      const reason = document.getElementById("summary").value;
      vscode.postMessage({ type: "cancel", reason });
    }
  </script>
</body>
</html>`;
}

// ── Extension activation ──────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("syncpoint");
  const url = config.get<string>("serverUrl", DEFAULT_URL);
  client = createSyncPointClient(url);

  // Unified Sync View — single tree with all 7 sections
  const syncView = new SyncViewProvider();
  vscode.window.registerTreeDataProvider("syncpoint-sync-view", syncView);

  // Output channel for watcher and diagnostic logging
  const syncpointChannel = vscode.window.createOutputChannel("SyncPoint");
  context.subscriptions.push(syncpointChannel);

  context.subscriptions.push(registerFileGuard({
    client,
    onAudited: () => syncView.refresh(),
  }));
  context.subscriptions.push(registerAgentManifestWatcher({
    client,
    onSynced: () => syncView.refresh(),
    onWarning: message => vscode.window.showWarningMessage(message),
    onCreated: uri => vscode.window.showInformationMessage(`New agent detected, synced into collaboration network: ${path.basename(uri.fsPath)}`),
    outputChannel: syncpointChannel,
  }));
  context.subscriptions.push(registerGuardedEditor({ client }));

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
      const workspaceRoot = getPrimaryWorkspaceFolder();
      if (!workspaceRoot) {
        vscode.window.showWarningMessage("No workspace folder open");
        return;
      }
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
      const root = folders[0]!.uri;
      const fileUri = vscode.Uri.joinPath(root, format.label);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(text, "utf-8"));
      vscode.window.showInformationMessage(`Written: ${format.label}`);
    }),

    // ── Gate Decision Commands ──

    ...registerGateCommands(syncView)
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
