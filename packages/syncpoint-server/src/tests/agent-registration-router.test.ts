import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../../src/db.js";
import { ensureApplicationBootstrap } from "../../src/application/index.js";
import { appRouter } from "../../src/router.js";

let projectRoot = "";
let syncpointDir = "";

beforeEach(() => {
  closeDb();
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sp-agent-registration-router-"));
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

describe("agentRegistration router", () => {
  it("lists built-in templates and validates inline content", async () => {
    const caller = appRouter.createCaller({ callerId: null });

    const templates = await caller.agentRegistration.listTemplates();
    expect(templates.templates.some(template => template.id === "delivery-pod")).toBe(true);

    const validation = await caller.agentRegistration.validate({
      content: `
version: 1
agent:
  name: router-validator
  profile: reviewer
  provider: cursor
`,
      format: "yaml",
    });
    expect(validation.results).toHaveLength(1);
    expect(validation.results[0].valid).toBe(true);
    expect(validation.results[0].kind).toBe("manifest");
  });

  it("materializes team templates and exports cards through tRPC", async () => {
    const caller = appRouter.createCaller({ callerId: null });

    const initResult = await caller.agentRegistration.initTeam({
      templateId: "lean-pair",
      namePrefix: "rpc",
    });
    expect(initResult.writes.length).toBeGreaterThan(1);
    expect(initResult.writes.every(write => fs.existsSync(write.filePath))).toBe(true);

    const cards = await caller.agentRegistration.exportCards();
    expect(cards.cards.length).toBeGreaterThan(1);
    expect(cards.cards[0].card.schema).toBe("syncpoint/agent-card/v1");
  });
});
