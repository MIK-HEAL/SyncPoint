/**
 * E2E: CLI commands work end-to-end (via child_process).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let tmpDir: string;
let spDir: string;
const CLI = path.resolve("dist/main.js");

function cli(args: string): string {
  return execSync(`node ${path.resolve("../syncpoint-cli/dist/main.js")} ${args}`, {
    cwd: tmpDir,
    env: { ...process.env, SYNCPOINT_DB_DIR: spDir },
    encoding: "utf8",
    timeout: 10_000,
  }).trim();
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-cli-"));
  spDir = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(spDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CLI flow", () => {
  let agentId: string;
  let taskId: string;

  it("syncpoint agent add", () => {
    const out = cli('agent add --name codex --provider codex --role backend');
    const agent = JSON.parse(out);
    expect(agent.name).toBe("codex");
    agentId = agent.id;
  });

  it("syncpoint task create", () => {
    const out = cli('task create "Build CLI"');
    const task = JSON.parse(out);
    expect(task.status).toBe("OPEN");
    taskId = task.id;
  });

  it("syncpoint task assign", () => {
    const out = cli(`task assign ${taskId} --agent ${agentId}`);
    const task = JSON.parse(out);
    expect(task.status).toBe("ASSIGNED");
  });

  it("syncpoint contract draft", () => {
    const out = cli(`contract draft --task ${taskId} --title "CLI contract"`);
    const c = JSON.parse(out);
    expect(c.status).toBe("DRAFT");
  });

  it("syncpoint status", () => {
    const out = cli("status");
    expect(out).toContain("Agents: 1");
    expect(out).toContain("Tasks:");
    expect(out).toContain("1");
  });
});
