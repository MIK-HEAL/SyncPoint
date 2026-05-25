import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, closeDb } from "../db.js";
import {
  exportAgentCards,
  importAgentDeclarations,
  initAgentTeam,
  listDeclaredAgents,
  migrateRuntimeAgentsToDeclaredManifests,
  validateAgentDeclarations,
} from "./index.js";
import {
  createAgent,
} from "../repositories/_exports/foundation.js";
import {
  upsertAgentManifest,
} from "../repositories/_exports/runtime.js";

let projectRoot = "";
let syncpointDir = "";

beforeEach(() => {
  closeDb();
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sp-agent-registration-"));
  syncpointDir = path.join(projectRoot, ".syncpoint");
  fs.mkdirSync(syncpointDir, { recursive: true });
  process.env.SYNCPOINT_PROJECT_ROOT = projectRoot;
  process.env.SYNCPOINT_DB_DIR = syncpointDir;
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

describe("agent registration service", () => {
  it("initializes a built-in team template into declared manifests", () => {
    const result = initAgentTeam({
      templateId: "delivery-pod",
      namePrefix: "alpha",
    });

    expect(result.writes.length).toBeGreaterThan(2);
    expect(result.writes.every(write => fs.existsSync(write.filePath))).toBe(true);
    expect(listDeclaredAgents().length).toBe(result.writes.length);
  });

  it("imports team template files and materializes manifests", () => {
    const sourceDir = path.join(projectRoot, "incoming");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "team.yml"), `
version: 1
team:
  name: Import Team
  description: Imported team
  members:
    - key: lead
      name: lead
      profile: manager
      provider: auto_detect
    - key: builder
      name: builder
      profile: backend
      provider: cursor
`, "utf8");

    const result = importAgentDeclarations({
      sourcePath: sourceDir,
      namePrefix: "beta",
    });

    expect(result.writes).toHaveLength(2);
    expect(result.writes.map(write => write.manifest.name)).toEqual(["beta-lead", "beta-builder"]);
  });

  it("validates manifest content and reports invalid declarations clearly", () => {
    const valid = validateAgentDeclarations({
      content: `
version: 1
agent:
  name: validator
  profile: reviewer
  provider: cursor
`,
      format: "yaml",
    });
    expect(valid.results).toHaveLength(1);
    expect(valid.results[0].valid).toBe(true);
    expect(valid.results[0].kind).toBe("manifest");
    expect(valid.results[0].name).toBe("validator");

    const invalid = validateAgentDeclarations({
      content: `
version: 1
agent:
  provider: invalid-provider
`,
      format: "yaml",
    });
    expect(invalid.results[0].valid).toBe(false);
    expect(invalid.results[0].kind).toBe("unknown");
    expect(invalid.results[0].errorMessage).toContain("Not a valid agent manifest");
  });

  it("migrates runtime agents into declared manifests", () => {
    const agent = createAgent({
      name: "legacy-reviewer",
      provider: "other",
      role: "reviewer",
    });
    upsertAgentManifest({
      agentId: agent.id,
      tags: ["review"],
      capabilities: [{ domain: "code-review", skills: ["typescript"], resourceTypes: ["file"] }],
    });

    const result = migrateRuntimeAgentsToDeclaredManifests({
      agentIds: [agent.id],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].written).toBe(true);
    expect(result.items[0].manifest.tags).toEqual(["review"]);
    expect(fs.existsSync(result.items[0].filePath)).toBe(true);
  });

  it("exports agent cards from declared agents", () => {
    initAgentTeam({ templateId: "lean-pair" });

    const result = exportAgentCards();

    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.cards[0].card.schema).toBe("syncpoint/agent-card/v1");
    expect(result.cards[0].card.protocols).toContain("a2a-like");
  });
});
