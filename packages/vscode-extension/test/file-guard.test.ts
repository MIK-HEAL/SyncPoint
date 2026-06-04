import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { registerFileGuard } from "../src/file-guard.js";

function document(fsPath: string): any {
  return { uri: { scheme: "file", fsPath } };
}

describe("File Audit Guard", () => {
  beforeEach(() => {
    (vscode as any).__resetMockState();
    vi.restoreAllMocks();
  });

  it("audits a file after VS Code saves it", async () => {
    (vscode as any).__setConfiguration({
      agentId: "agent-b",
      taskId: "task-b",
      sessionId: "session-1",
      "fileGuard.enabled": true,
      "fileGuard.auditOnly": true,
    });
    const mutate = vi.fn().mockResolvedValue({ eventType: "FILE_CHANGED" });
    const onAudited = vi.fn();

    registerFileGuard({
      client: {
        fileAudit: { audit: { mutate } },
        syncStatus: { snapshot: { query: vi.fn() } },
      },
      onAudited,
    });

    await (vscode as any).__fireDidSaveTextDocument(document("/test/src/auth.js"));

    expect(mutate).toHaveBeenCalledWith({
      actorId: "agent-b",
      taskId: "task-b",
      sessionId: "session-1",
      locator: "src/auth.js",
      auditOnly: true,
    });
    expect(onAudited).toHaveBeenCalledOnce();
  });

  it("warns before saving another agent's exclusive claim", async () => {
    (vscode as any).__setConfiguration({
      agentId: "agent-b",
      taskId: "task-b",
      sessionId: "session-1",
      "fileGuard.enabled": true,
      "fileGuard.auditOnly": false,
    });
    const showWarningMessage = vi.spyOn(vscode.window, "showWarningMessage").mockImplementation(() => undefined as any);
    const query = vi.fn().mockResolvedValue({
      resourceOwnership: {
        activeClaims: [{
          actorId: "agent-a",
          actorName: "Agent A",
          mode: "exclusive",
          resources: [{ type: "file", locator: "src/auth.js", metadata: "" }],
        }],
      },
      agents: [],
    });

    registerFileGuard({
      client: {
        fileAudit: { audit: { mutate: vi.fn() } },
        syncStatus: { snapshot: { query } },
      },
    });

    await (vscode as any).__fireWillSaveTextDocument(document("/test/src/auth.js"));

    expect(query).toHaveBeenCalledWith({ sessionId: "session-1" });
    expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("exclusively claimed by Agent A"));
  });
});
