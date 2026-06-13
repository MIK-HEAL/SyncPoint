/**
 * SyncPoint VS Code Extension — commands, pickers, and decision panel webview.
 */

import path from "node:path";
import * as vscode from "vscode";
import { formatResumePrompt } from "syncpoint-context";
import type { PromptFormat, ResumeContext } from "syncpoint-context";
import type { AgentRole, UserAgentProvider } from "syncpoint-adapters";
import { createAgentManifestFile, getPrimaryWorkspaceFolder } from "./agent-manifest-files.js";
import type { SyncViewProvider } from "./views.js";

// ── Picker helpers ──────────────────────────────────────

export async function pickResumeContext(
  client: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<ResumeContext | undefined> {
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

async function pickGate(
  client: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<string | undefined> {
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

async function pickAgent(
  client: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<string | undefined> {
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

// ── Gate Decision Commands ──────────────────────────────

export function registerGateCommands(
  client: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  syncView: SyncViewProvider
): vscode.Disposable[] {
  async function voteOnGate(vote: string) {
    const gateId = await pickGate(client);
    if (!gateId) return;
    const agentId = await pickAgent(client);
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
      const gateId = await pickGate(client);
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
      const gateId = await pickGate(client);
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
      const gateId = await pickGate(client);
      if (!gateId) return;
      const agentId = await pickAgent(client);
      try {
        const detail = await client.syncGate.status.query({ gateId, agentId });
        openDecisionPanel(client, detail, gateId, syncView);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to load gate detail: ${e.message}`);
      }
    }),
  ];
}

// ── Decision Panel Webview ──────────────────────────────

function openDecisionPanel(
  client: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  detail: any,
  gateId: string,
  syncView: SyncViewProvider
): void {
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
          gateId, agentId: msg.agentId, vote: msg.vote, summary: msg.summary || "",
        });
        vscode.window.showInformationMessage(`Vote '${msg.vote}' cast.`);
      } else if (msg.type === "resolve") {
        await client.syncGate.resolve.mutate({ gateId, summary: msg.summary || "" });
        vscode.window.showInformationMessage("Gate resolved.");
      } else if (msg.type === "cancel") {
        await client.syncGate.cancel.mutate({ gateId, reason: msg.reason || "" });
        vscode.window.showInformationMessage("Gate cancelled.");
      }
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
    <div class="card"><h3>Votes</h3>
      <div class="vote-bar">
        <span class="approve">✓ ${vc.approve}</span>
        <span class="reject">✗ ${vc.reject}</span>
        <span class="abstain">○ ${vc.abstain}</span>
        <span class="escalate">↑ ${vc.escalate}</span>
      </div></div>` : "";

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
<html><head>
<style>
  body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; padding: 12px; margin-bottom: 12px; }
  h2 { margin: 0 0 8px; font-size: 16px; } h3 { margin: 0 0 6px; font-size: 13px; color: var(--vscode-descriptionForeground); }
  .status { font-weight: bold; } .status.blocking { color: var(--vscode-errorForeground); } .status.resolved { color: var(--vscode-testing-iconPassed); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
  .badge.human { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); }
  .vote-bar { display: flex; gap: 12px; font-size: 14px; }
  .approve { color: var(--vscode-testing-iconPassed); } .reject { color: var(--vscode-errorForeground); }
  .abstain { color: var(--vscode-descriptionForeground); } .escalate { color: var(--vscode-editorWarning-foreground); }
  dl { margin: 0; } dt { font-weight: bold; margin-top: 6px; } dd { margin: 0 0 0 12px; }
  button { padding: 6px 14px; margin: 4px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.danger { background: var(--vscode-inputValidation-errorBackground); } button.warn { background: var(--vscode-inputValidation-warningBackground); }
  .actions { margin-top: 12px; }
  textarea { width: 100%; min-height: 40px; margin: 6px 0; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 6px; font-family: inherit; }
</style></head>
<body>
  <h2>${g.description || "Sync Gate"}</h2>
  <div class="card"><h3>Overview</h3><dl>
    <dt>Status</dt><dd class="status ${detail.isBlocking ? "blocking" : "resolved"}">${g.status}</dd>
    <dt>Policy</dt><dd>${detail.policy?.kind ?? "all_required"}</dd>
    <dt>Required</dt><dd>${detail.requiredAgentIds?.join(", ") ?? "—"}</dd>
    <dt>Acked</dt><dd>${detail.ackedAgentIds?.join(", ") || "none"}</dd>
    <dt>Pending</dt><dd>${detail.pendingAgentIds?.join(", ") || "none"}</dd>
    ${detail.deadlineAt ? `<dt>Deadline</dt><dd>${detail.deadlineAt}</dd>` : ""}
    ${detail.requiresHuman ? `<dt><span class="badge human">⚠ Requires Human</span></dt><dd></dd>` : ""}
    <dt>Liveness</dt><dd>${liveness?.action ?? "—"} — ${liveness?.reason ?? ""}</dd>
  </dl></div>
  ${votesHtml}
  <div class="card actions"><h3>Actions</h3>
    <textarea id="summary" placeholder="Decision summary (optional)"></textarea>
    <div>${actionsHtml || "<em>No actions available (view only)</em>"}</div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function doVote(vote) { const summary = document.getElementById("summary").value; vscode.postMessage({ type: "vote", vote, summary, agentId: "${detail.availableActions ? "prompted" : ""}" }); }
    function doResolve() { const summary = document.getElementById("summary").value; vscode.postMessage({ type: "resolve", summary }); }
    function doCancel() { const reason = document.getElementById("summary").value; vscode.postMessage({ type: "cancel", reason }); }
  </script>
</body></html>`;
}
