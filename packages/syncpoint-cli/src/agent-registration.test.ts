import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Command } from "commander";
import { closeDb, getDb, initSyncpointDir } from "syncpoint-server";
import { ensureApplicationBootstrap } from "syncpoint-server/application";
import * as repo from "syncpoint-server/repositories";
import { upsertAgentManifest } from "syncpoint-server/repositories";
import { registerAgentCommands } from "./commands/agent.js";
import { registerTeamCommands } from "./commands/team.js";

let projectRoot = "";
let syncpointDir = "";

beforeEach(() => {
  closeDb();
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sp-cli-agent-registration-"));
  syncpointDir = path.join(projectRoot, ".syncpoint");
  fs.mkdirSync(syncpointDir, { recursive: true });
  process.env.SYNCPOINT_PROJECT_ROOT = projectRoot;
  process.env.SYNCPOINT_DB_DIR = syncpointDir;
  ensureApplicationBootstrap();
  getDb();
});

afterEach(() => {
  closeDb();
  delete process.env.SYNCPOINT_PROJECT_ROOT;
  delete process.env.SYNCPOINT_DB_DIR;
  if (projectRoot) {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe("agent/team command registration", () => {
  it("registers agent subcommands", () => {
    const program = new Command();
    registerAgentCommands(program);

    const agent = program.commands.find(command => command.name() === "agent");
    expect(agent).toBeDefined();
    expect(agent?.commands.map(command => command.name())).toEqual([
      "init",
      "add",
      "list",
      "import",
      "validate",
      "sync",
      "diagnose",
      "migrate",
      "card",
    ]);
  });

  it("registers team subcommands", () => {
    const program = new Command();
    registerTeamCommands(program);

    const team = program.commands.find(command => command.name() === "team");
    expect(team).toBeDefined();
    expect(team?.commands.map(command => command.name())).toEqual([
      "list-templates",
      "init",
    ]);
  });
});

describe("agent/team command execution", () => {
  it("prints built-in templates as json", async () => {
    const output = await runCli(["team", "list-templates", "--json"]);
    const payload = JSON.parse(output);

    expect(Array.isArray(payload)).toBe(true);
    expect(payload.some((item: { id: string }) => item.id === "delivery-pod")).toBe(true);
  });

  it("migrates a runtime agent and exports its card via CLI commands", async () => {
    const agent = repo.createAgent({
      name: "cli-reviewer",
      provider: "other",
      role: "reviewer",
    });
    upsertAgentManifest({
      agentId: agent.id,
      tags: ["review"],
      capabilities: [{ domain: "review", skills: ["typescript"], resourceTypes: ["file"] }],
    });

    const migrateOutput = await runCli(["agent", "migrate", "--agent", "cli-reviewer", "--json"]);
    const migratePayload = JSON.parse(migrateOutput);
    expect(migratePayload.items).toHaveLength(1);
    expect(migratePayload.items[0]!.agentId).toBe(agent.id);

    const cardOutput = await runCli(["agent", "card", "cli-reviewer", "--json"]);
    const cardPayload = JSON.parse(cardOutput);
    expect(cardPayload.schema).toBe("syncpoint/agent-card/v1");
    expect(cardPayload.name).toBe("cli-reviewer");
  });

  it("validates declarations and supports manual sync through CLI", async () => {
    const incomingDir = path.join(projectRoot, "incoming");
    fs.mkdirSync(incomingDir, { recursive: true });
    const manifestPath = path.join(incomingDir, "validator.yml");
    fs.writeFileSync(manifestPath, `
version: 1
agent:
  name: cli-validator
  profile: reviewer
  provider: cursor
`, "utf8");

    const validationOutput = await runCli(["agent", "validate", manifestPath, "--json"]);
    const validationPayload = JSON.parse(validationOutput);
    expect(validationPayload.results).toHaveLength(1);
    expect(validationPayload.results[0]!.valid).toBe(true);
    expect(validationPayload.results[0]!.name).toBe("cli-validator");

    fs.mkdirSync(path.join(projectRoot, ".syncpoint", "agents"), { recursive: true });
    fs.copyFileSync(manifestPath, path.join(projectRoot, ".syncpoint", "agents", "cli-validator.yml"));

    const syncOutput = await runCli(["agent", "sync", "--json"]);
    const syncPayload = JSON.parse(syncOutput);
    expect(Array.isArray(syncPayload)).toBe(true);
    expect(syncPayload.some((item: { name: string | null }) => item.name === "cli-validator")).toBe(true);
  });

  it("materializes a team template through the CLI", async () => {
    const output = await runCli(["team", "init", "lean-pair", "--prefix", "gamma", "--json"]);
    const payload = JSON.parse(output);

    expect(payload.templateName).toBe("Lean Pair");
    expect(payload.writes.length).toBeGreaterThan(1);
    expect(payload.writes.every((item: { manifestPath: string }) => item.manifestPath.startsWith(".syncpoint/agents/"))).toBe(true);

    const cards = await runCli(["agent", "card", "--all", "--json"]);
    const cardPayload = JSON.parse(cards);
    expect(Array.isArray(cardPayload)).toBe(true);
    expect(cardPayload.length).toBeGreaterThan(1);
  });

  it("generates a single agent manifest via agent init", async () => {
    const output = await runCli(["agent", "init", "--name", "test-builder", "--profile", "backend", "--provider", "cursor", "--json"]);
    const payload = JSON.parse(output);

    expect(payload.manifest.name).toBe("test-builder");
    expect(payload.manifest.profile).toBe("backend");
    expect(payload.manifest.provider).toBe("cursor");
    expect(payload.write.written).toBe(true);
    expect(fs.existsSync(payload.write.filePath)).toBe(true);
  });

  it("agent init with --no-sync creates file without syncing", async () => {
    const output = await runCli(["agent", "init", "--name", "unsynced-agent", "--no-sync", "--json"]);
    const payload = JSON.parse(output);

    expect(payload.manifest.name).toBe("unsynced-agent");
    expect(payload.write.written).toBe(true);
    expect(payload.write.syncedRecord).toBeNull();
  });

  it("diagnoses the agent registry via CLI", async () => {
    const output = await runCli(["agent", "diagnose", "--json"]);
    const payload = JSON.parse(output);

    expect(payload).toHaveProperty("total");
    expect(payload).toHaveProperty("healthy");
    expect(payload).toHaveProperty("errors");
    expect(payload).toHaveProperty("entries");
    expect(Array.isArray(payload.entries)).toBe(true);
  });
});

async function runCli(args: string[]): Promise<string> {
  const program = new Command();
  program.exitOverride();
  registerAgentCommands(program);
  registerTeamCommands(program);

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...parts: unknown[]) => {
    logs.push(parts.map(part => typeof part === "string" ? part : JSON.stringify(part)).join(" "));
  };

  try {
    await program.parseAsync(["node", "syncpoint", ...args], { from: "node" });
  } finally {
    console.log = originalLog;
  }

  return logs.join("\n");
}
