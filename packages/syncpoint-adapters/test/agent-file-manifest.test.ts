import { describe, expect, it } from "vitest";
import { AgentAvailability } from "../src/agent-manifest.js";
import {
  createUserAgentManifestTemplate,
  detectUserAgentManifestFormatFromPath,
  isSupportedUserAgentManifestPath,
  parseUserAgentManifestContent,
  serializeUserAgentManifest,
  toAgentCreateFromUserAgentManifest,
  toRuntimeAgentManifestInputFromUserAgentManifest,
} from "../src/agent-file-manifest.js";

describe("user agent manifest parsing", () => {
  it("parses nested yaml documents and normalizes aliases", () => {
    const manifest = parseUserAgentManifestContent(`
version: 1
agent:
  name: Executor Jack
  profile: executor
  provider: auto_detect
  tags: [backend, backend, api]
  capabilities:
    - api
    - domain: code-review
      skills: [typescript, typescript]
      resourceTypes: [file]
  availability: busy
  autoStart: true
  notes: Handles backend delivery
`);

    expect(manifest.name).toBe("Executor Jack");
    expect(manifest.role).toBe("backend");
    expect(manifest.provider).toBe("auto_detect");
    expect(manifest.tags).toEqual(["backend", "api"]);
    expect(manifest.capabilities).toEqual([
      { domain: "api", skills: [], resourceTypes: [] },
      { domain: "code-review", skills: ["typescript"], resourceTypes: ["file"] },
    ]);
    expect(manifest.availability).toBe(AgentAvailability.BUSY);
    expect(manifest.autoStart).toBe(true);
  });

  it("parses top-level json documents and applies defaults", () => {
    const manifest = parseUserAgentManifestContent(JSON.stringify({
      name: "Reviewer Rose",
      profile: "reviewer",
      provider: "cursor",
    }), "json");

    expect(manifest.version).toBe(1);
    expect(manifest.role).toBe("reviewer");
    expect(manifest.tags).toEqual([]);
    expect(manifest.capabilities).toEqual([]);
    expect(manifest.availability).toBe(AgentAvailability.ONLINE);
    expect(manifest.autoStart).toBe(false);
    expect(manifest.notes).toBe("");
  });

  it("rejects manifests without a name", () => {
    expect(() => parseUserAgentManifestContent(JSON.stringify({ profile: "backend" }), "json")).toThrow();
  });
});

describe("user agent manifest helpers", () => {
  it("creates runtime agent input from normalized manifests", () => {
    const manifest = createUserAgentManifestTemplate({
      name: "Backend Ada",
      profile: "executor",
      provider: "auto_detect",
      tags: ["backend"],
      capabilities: ["api"],
      canHandleHumanEscalation: true,
    });

    expect(toAgentCreateFromUserAgentManifest(manifest)).toEqual({
      name: "Backend Ada",
      provider: "other",
      role: "backend",
    });

    expect(toRuntimeAgentManifestInputFromUserAgentManifest(manifest)).toEqual({
      capabilities: [{ domain: "api", skills: [], resourceTypes: [] }],
      escalationPreference: {
        optIn: "when_available",
        priority: 50,
        maxConcurrentEscalations: 3,
      },
      availability: "online",
      canHandleHumanEscalation: true,
      tags: ["backend"],
    });
  });

  it("serializes yaml and supports round-trip parsing", () => {
    const source = createUserAgentManifestTemplate({
      name: "Frontend Ivy",
      profile: "frontend",
      provider: "cursor",
      role: "frontend",
      tags: ["ui"],
      capabilities: ["ui-review"],
      notes: "Owns interface polish",
    });

    const yaml = serializeUserAgentManifest(source, "yaml");
    const reparsed = parseUserAgentManifestContent(yaml, "yaml");

    expect(reparsed).toEqual(source);
  });

  it("detects supported manifest file formats by path", () => {
    expect(detectUserAgentManifestFormatFromPath(".syncpoint/agents/reviewer.yml")).toBe("yaml");
    expect(detectUserAgentManifestFormatFromPath(".syncpoint/agents/reviewer.json")).toBe("json");
    expect(detectUserAgentManifestFormatFromPath(".syncpoint/agents/reviewer.txt")).toBeUndefined();
    expect(isSupportedUserAgentManifestPath(".syncpoint/agents/reviewer.yaml")).toBe(true);
    expect(isSupportedUserAgentManifestPath(".syncpoint/agents/reviewer.md")).toBe(false);
  });
});
