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
const TSX = process.platform === "win32"
  ? path.resolve("node_modules/.bin/tsx.cmd")
  : path.resolve("node_modules/.bin/tsx");
const CLI = path.resolve("../syncpoint-cli/src/main.js");

function cli(args: string): string {
  return execSync(`"${TSX}" "${CLI}" ${args}`, {
    cwd: tmpDir,
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=source`.trim(),
      SYNCPOINT_DB_DIR: spDir,
    },
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
    expect(out).toContain("SyncPoint Status");
    expect(out).toContain("Agents");
    expect(out).toContain("codex");
  });
});

describe("CLI session --mode", () => {
  let sessionId: string;

  it("session create --mode peer-contract", () => {
    const out = cli('session create --title "Mode test" --mode peer-contract --json');
    const result = JSON.parse(out);
    expect(result.session.relationshipMode).toBe("peer-contract");
    sessionId = result.session.id;
  });

  it("session status shows mode", () => {
    const out = cli(`session status --session ${sessionId}`);
    expect(out).toContain("Mode: peer-contract");
  });

  it("session create with default mode", () => {
    const out = cli('session create --title "Default mode" --json');
    const result = JSON.parse(out);
    expect(result.session.relationshipMode).toBe("manager-delegate");
  });

  it("session create with invalid mode throws", () => {
    expect(() => cli('session create --title "Bad" --mode invalid-mode')).toThrow();
  });
});
