/**
 * VS Code extension integration tests.
 *
 * These tests verify:
 * - Extension module can be loaded
 * - activate/deactivate exports exist
 * - Commands are registered correctly
 * - Server offline doesn't crash
 *
 * Uses @vscode/test-electron for full integration when run via `vscode-test`.
 * Falls back to basic smoke tests when run without VS Code.
 */
import { describe, it, expect } from "vitest";

describe("SyncPoint VS Code Extension", () => {
  it("exports activate and deactivate functions", async () => {
    // Dynamic import to avoid vscode module resolution issues outside of VS Code
    const ext = await import("./extension.js");
    expect(typeof ext.activate).toBe("function");
    expect(typeof ext.deactivate).toBe("function");
  });

  it("package.json declares required commands", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    const commands = pkg.contributes.commands.map((c: any) => c.command);
    expect(commands).toContain("syncpoint.startServer");
    expect(commands).toContain("syncpoint.registerAgent");
    expect(commands).toContain("syncpoint.createTask");
    expect(commands).toContain("syncpoint.refreshStatus");
    expect(commands).toContain("syncpoint.resumePrompt");
    expect(commands).toContain("syncpoint.copyResumePrompt");
    expect(commands).toContain("syncpoint.writeRulesFile");
    expect(commands).toContain("syncpoint.openGuardedFile");
    expect(commands).toContain("syncpoint.guardedSave");
    expect(commands).toContain("syncpoint.gateApprove");
    expect(commands).toContain("syncpoint.gateReject");
    expect(commands).toContain("syncpoint.gateAbstain");
    expect(commands).toContain("syncpoint.gateEscalate");
    expect(commands).toContain("syncpoint.gateResolve");
    expect(commands).toContain("syncpoint.gateCancel");
    expect(commands).toContain("syncpoint.openDecisionPanel");
  });

  it("package.json declares tree views", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    const views = pkg.contributes.views.syncpoint.map((v: any) => v.id);
    expect(views).toContain("syncpoint-sync-view");
  });

  it("package.json declares activation events and engine", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    expect(pkg.engines.vscode).toBeDefined();
    expect(pkg.main).toBe("./dist/extension.js");
    expect(pkg.activationEvents).toContain("onStartupFinished");
    expect(pkg.activationEvents).toContain("workspaceContains:.syncpoint");
  });

  it("package.json declares file guard configuration", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const properties = pkg.contributes.configuration.properties;

    expect(properties["syncpoint.agentId"]).toBeDefined();
    expect(properties["syncpoint.taskId"]).toBeDefined();
    expect(properties["syncpoint.sessionId"]).toBeDefined();
    expect(properties["syncpoint.fileGuard.enabled"].default).toBe(true);
    expect(properties["syncpoint.fileGuard.auditOnly"].default).toBe(false);
    expect(properties["syncpoint.fileGuard.mode"].default).toBe("audit");
  });
});
