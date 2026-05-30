import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, closeDb } from "../db.js";
import {
  diagnoseAgentRegistry,
  exportAgentCards,
  importAgentDeclarations,
  initAgentManifest,
  initAgentTeam,
  initProjectAgents,
  listDeclaredAgents,
  migrateRuntimeAgentsToDeclaredManifests,
  syncDeclaredAgents,
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

  it("initializes a single agent manifest via initAgentManifest", () => {
    const result = initAgentManifest({
      name: "test-worker",
      profile: "backend",
      provider: "cursor",
      tags: ["test"],
      capabilities: ["api"],
    });

    expect(result.manifest.name).toBe("test-worker");
    expect(result.manifest.profile).toBe("backend");
    expect(result.manifest.provider).toBe("cursor");
    expect(result.manifest.tags).toEqual(["test"]);
    expect(result.write.written).toBe(true);
    expect(fs.existsSync(result.write.filePath)).toBe(true);

    const declared = listDeclaredAgents();
    expect(declared.some(d => d.name === "test-worker")).toBe(true);
  });

  it("initializes project agents with example manifest and optional team", () => {
    const result = initProjectAgents({
      exampleAgent: true,
      teamTemplateId: "lean-pair",
    });

    expect(result.exampleManifest).not.toBeNull();
    expect(result.exampleManifest!.manifest.name).toBe("my-agent");
    expect(fs.existsSync(result.exampleManifest!.write.filePath)).toBe(true);

    expect(result.teamWrites.length).toBeGreaterThan(0);
    for (const w of result.teamWrites) {
      expect(fs.existsSync(w.filePath)).toBe(true);
    }

    const declared = listDeclaredAgents();
    expect(declared.length).toBe(1 + result.teamWrites.length);
  });

  it("initProjectAgents without team creates only the example manifest", () => {
    const result = initProjectAgents({ exampleAgent: true });

    expect(result.exampleManifest).not.toBeNull();
    expect(result.teamWrites).toHaveLength(0);
  });

  it("initProjectAgents with exampleAgent=false creates no example manifest", () => {
    const result = initProjectAgents({ exampleAgent: false, teamTemplateId: "lean-pair" });

    expect(result.exampleManifest).toBeNull();
    expect(result.teamWrites.length).toBeGreaterThan(0);
  });

  it("diagnoses a healthy registry", () => {
    initAgentManifest({ name: "healthy-agent", provider: "cursor" });
    const result = diagnoseAgentRegistry({ sync: false });

    expect(result.total).toBeGreaterThan(0);
    expect(result.healthy).toBe(result.total);
    expect(result.errors).toBe(0);
    expect(result.removed).toBe(0);
    const entry = result.entries.find(e => e.name === "healthy-agent");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("active");
    expect(entry!.fixSuggestions).toHaveLength(0);
  });

  it("diagnoses error entries with fix suggestions", () => {
    const agentsDir = path.join(projectRoot, ".syncpoint", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const badFile = path.join(agentsDir, "bad-agent.yml");
    fs.writeFileSync(badFile, "invalid: {broken yaml", "utf-8");

    const result = diagnoseAgentRegistry();

    expect(result.errors).toBeGreaterThanOrEqual(1);
    const badEntry = result.entries.find(e => e.manifestPath.includes("bad-agent"));
    expect(badEntry).toBeDefined();
    expect(badEntry!.status).toBe("error");
    expect(badEntry!.fixSuggestions.length).toBeGreaterThan(0);
  });

  it("computes availability as 'offline' for active agents with agentId but no active runtime", () => {
    initAgentManifest({ name: "offline-agent", provider: "cursor" });
    const agents = listDeclaredAgents();
    const offlineAgent = agents.find(a => a.name === "offline-agent");

    expect(offlineAgent).toBeDefined();
    // initAgentManifest creates a runtime agent row (agentId is set),
    // but no runtime session exists, so availability is "offline"
    expect(offlineAgent!.agentId).toBeTruthy();
    expect(offlineAgent!.availability).toBe("offline");
  });

  it("computes availability as 'error' for agents with parse errors", () => {
    const agentsDir = path.join(projectRoot, ".syncpoint", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const badFile = path.join(agentsDir, "broken.yml");
    fs.writeFileSync(badFile, "invalid: {broken", "utf-8");

    syncDeclaredAgents();
    const agents = listDeclaredAgents({ includeRemoved: true });
    const errorAgent = agents.find(a => a.manifestPath.includes("broken"));

    expect(errorAgent).toBeDefined();
    expect(errorAgent!.availability).toBe("error");

    fs.unlinkSync(badFile);
  });
});
