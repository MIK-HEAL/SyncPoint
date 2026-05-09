import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { registerGuardedEditor, guardedUriForFile } from "./guarded-editor.js";

function clientWithWrite(prepare: any, applyWrite: any) {
  return { write: { prepare: { mutate: prepare }, applyWrite: { mutate: applyWrite } } };
}

describe("Guarded Editor", () => {
  beforeEach(() => {
    (vscode as any).__resetMockState();
    vi.restoreAllMocks();
  });

  it("maps workspace file URIs to syncpoint guarded URIs", () => {
    const uri = guardedUriForFile((vscode as any).Uri.file("/test/src/auth.ts"));

    expect(uri?.scheme).toBe("syncpoint");
    expect(uri?.path).toBe("/src/auth.ts");
  });

  it("writes syncpoint documents through write.prepare and write.applyWrite", async () => {
    (vscode as any).__setConfiguration({
      agentId: "agent-a",
      taskId: "task-1",
      sessionId: "session-1",
      "fileGuard.enabled": true,
      "fileGuard.mode": "editor-strict",
    });
    const prepare = vi.fn().mockResolvedValue({
      decision: { permitted: true, blockers: [] },
      permit: { id: "permit-1" },
    });
    const applyWrite = vi.fn().mockResolvedValue({ permit: { status: "consumed" }, applied: [] });
    registerGuardedEditor({ client: clientWithWrite(prepare, applyWrite) });
    const provider = (vscode as any).__getRegisteredFileSystemProvider("syncpoint");

    await provider.writeFile((vscode as any).Uri.parse("syncpoint:/src/auth.ts"), Buffer.from("new"));

    expect(prepare).toHaveBeenCalledWith({
      actorId: "agent-a",
      taskId: "task-1",
      sessionId: "session-1",
      resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
      intent: "modify",
    });
    expect(applyWrite).toHaveBeenCalledWith({
      permitId: "permit-1",
      mutations: [{ resource: { type: "file", locator: "src/auth.ts", metadata: "" }, contentBase64: Buffer.from("new").toString("base64") }],
    });
  });

  it("blocks syncpoint document writes when prepare denies the permit", async () => {
    (vscode as any).__setConfiguration({
      agentId: "agent-a",
      taskId: "task-1",
      "fileGuard.enabled": true,
      "fileGuard.mode": "editor-strict",
    });
    const showErrorMessage = vi.spyOn(vscode.window, "showErrorMessage").mockImplementation(() => undefined as any);
    const prepare = vi.fn().mockResolvedValue({
      decision: { permitted: false, blockers: [{ message: "blocked by gate" }] },
      permit: { id: "permit-denied" },
    });
    const applyWrite = vi.fn();
    registerGuardedEditor({ client: clientWithWrite(prepare, applyWrite) });
    const provider = (vscode as any).__getRegisteredFileSystemProvider("syncpoint");

    await expect(provider.writeFile((vscode as any).Uri.parse("syncpoint:/src/auth.ts"), Buffer.from("new"))).rejects.toThrow(/No permissions/);

    expect(applyWrite).not.toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("blocked by gate"));
  });
});
