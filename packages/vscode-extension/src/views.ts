/**
 * SyncPoint VS Code Extension — tree view provider and webview panels.
 */

import * as vscode from "vscode";

// ── Tree node types ────────────────────────────────────

export interface SyncSection {
  kind: "section";
  label: string;
  icon: string;
  badge?: string;
  children: SyncNode[];
}

export interface SyncItem {
  kind: "item";
  label: string;
  description: string;
  icon: string;
  tooltip?: string;
  children?: SyncNode[];
  contextValue?: string;
  gateId?: string;
}

export type SyncNode = SyncSection | SyncItem;

export function section(label: string, icon: string, children: SyncNode[], badge?: string): SyncSection {
  return { kind: "section", label, icon, children, badge };
}

export function item(label: string, description: string, icon: string, tooltip?: string, children?: SyncNode[]): SyncItem {
  return { kind: "item", label, description, icon, tooltip, children };
}

export function gateItem(label: string, description: string, icon: string, gateId: string, tooltip?: string, children?: SyncNode[]): SyncItem {
  return { kind: "item", label, description, icon, tooltip, children, contextValue: "syncGateBlocker", gateId };
}

// ── Sync View Provider ─────────────────────────────────

export class SyncViewProvider implements vscode.TreeDataProvider<SyncNode> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _root: SyncNode[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _client: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setClient(client: any): void {
    this._client = client;
  }

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await this._client.syncStatus.snapshot.query();
      const root: SyncNode[] = [];

      // ── Summary bar ──
      const s = data.summary;
      root.push(item(
        "Sync Status",
        s.blockerCount > 0
          ? `⚠ ${s.blockerCount} blocker${s.blockerCount > 1 ? "s" : ""}`
          : "✔ All clear",
        s.blockerCount > 0 ? "warning" : "pass",
        `Sessions: ${s.activeSessionCount} | Agents: ${s.agentCount} | Blocked: ${s.blockedAgentCount}\n` +
        `Claims: ${s.activeClaimCount} | Hard conflicts: ${s.hardConflictCount}\n` +
        `Operations: ${s.pendingOperationCount} | Wakes: ${s.pendingWakeCount}`
      ));

      // ── Sessions ──
      root.push(section("Sessions", "symbol-event",
        data.sessions.map((sess: any) =>
          item(sess.title, `${sess.status} • ${sess.relationshipMode}`, "window",
            undefined,
            sess.agents.map((a: any) => item(a.agentName, a.role, "person"))
          )
        )
      ));

      // ── Agents / Active Work ──
      root.push(section("Active Work", "robot",
        data.agents.filter((a: any) => a.activeAssignments.length > 0 || a.blocked).map((a: any) => {
          const children: SyncNode[] = [];
          for (const ta of a.activeAssignments) {
            children.push(item(ta.taskTitle, ta.status, ta.status === "IN_PROGRESS" ? "play" : "circle-outline"));
          }
          if (a.claimedResources.length) {
            for (const c of a.claimedResources) {
              const locs = c.resources.map((r: any) => r.locator).join(", ");
              children.push(item(locs, `${c.mode}`, c.mode === "exclusive" ? "lock" : "unlock"));
            }
          }
          return item(
            a.blocked ? `⛔ ${a.name}` : a.name,
            a.blocked ? "BLOCKED" : `${a.activeAssignments.length} task(s)`,
            a.blocked ? "error" : "person",
            `Provider: ${a.provider} | Role: ${a.role}\nWakes: ${a.pendingWakeCount}`,
            children
          );
        })
      ));

      // ── Resource Ownership ──
      const fo = data.resourceOwnership;
      const resourceChildren: SyncNode[] = [];
      for (const c of fo.activeClaims) {
        const locs = c.resources.map((r: any) => r.locator).join(", ");
        resourceChildren.push(item(locs, `${c.actorName} • ${c.mode}`,
          c.mode === "exclusive" ? "lock" : "unlock", `Task: ${c.taskTitle}`));
      }
      if (fo.conflicts.length) {
        resourceChildren.push(section("Conflicts", "flame",
          fo.conflicts.map((c: any) =>
            item(c.overlappingLocator, "conflict", "warning",
              `${c.claimA.actorName} (${c.claimA.mode}) vs ${c.claimB.actorName} (${c.claimB.mode})`)
          )
        ));
      }
      root.push(section("Resource Ownership", "file-symlink-file", resourceChildren,
        `${fo.stats.totalClaims} claims, ${fo.stats.hardConflicts} conflicts`));

      // ── Sync Blockers ──
      root.push(section("Blockers", "shield",
        data.blockers.map((b: any) => {
          const agentNames = b.requiredAgents.map((a: any) => a.name).join(", ");
          const iconMap: Record<string, string> = {
            sync_gate: "shield", checkpoint_review: "git-pull-request",
            handoff: "arrow-swap", review: "eye",
          };

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
            if (gd.deadlineAt) detailChildren.push(item("Deadline", gd.deadlineAt, "calendar"));
            if (gd.requiresHuman) detailChildren.push(item("Requires Human Decision", "Manual action needed", "alert"));
            if (gd.escalationAgentIds?.length) detailChildren.push(item("Escalation", gd.escalationAgentIds.join(", "), "mention"));
            detailChildren.push(item("Pending", agentNames || "none", "person"));

            const tooltip = `Policy: ${gd.policy}\nStatus: ${b.status}` +
              (gd.deadlineAt ? `\nDeadline: ${gd.deadlineAt}` : "") +
              (gd.requiresHuman ? "\n⚠ Requires human decision" : "") +
              `\nNeeds: ${agentNames}\nTask: ${b.relatedTaskId ?? "global"}`;

            return gateItem(b.description || b.reason, `${b.status} • ${gd.policy}`, gateIcon, b.id, tooltip, detailChildren);
          }

          return item(b.description || b.reason, `${b.type} • ${b.status}`,
            iconMap[b.type] || "warning", `Needs: ${agentNames}\nTask: ${b.relatedTaskId ?? "global"}`);
        })
      ));

      // ── Operations ──
      root.push(section("Operations", "diff",
        data.operations.map((op: any) =>
          item(op.title, `${op.status} • ${op.needsAction}`,
            op.status === "APPROVED" ? "pass" :
            op.status === "CONFLICTING" ? "error" :
            op.status === "SUBMITTED" ? "eye" : "edit",
            `By: ${op.actorName}\nTask: ${op.taskTitle}`)
        )
      ));

      // ── Wake Queue ──
      root.push(section("Wake Queue", "bell",
        data.wakeQueue.map((w: any) =>
          item(w.targetAgentName, `${w.reason}`, "bell-dot",
            `Event: ${w.sourceEvent}\nCreated: ${w.createdAt}`)
        )
      ));

      // ── Agent Registry ──
      try {
        const registry = await this._client.agentRegistry.list.query({});
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
              item(a.manifestPath, a.errorMessage ?? "unknown error", "error", "Fix: check file for syntax errors or missing required fields")
            )
          ));
        }

        if (removedAgents.length) {
          registryChildren.push(section("Removed", "trash",
            removedAgents.map((a: any) =>
              item(a.name ?? a.manifestPath, "removed", "trash",
                a.exists ? "File still exists — run syncpoint agent sync to reconcile" : "File deleted")
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
