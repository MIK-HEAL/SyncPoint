import { describe, expect, it } from "vitest";
import {
  createAgentTeamTemplate,
  getBuiltInAgentTeamTemplate,
  listBuiltInAgentTeamTemplates,
  materializeAgentTeamTemplate,
  parseAgentTeamTemplateContent,
  serializeAgentTeamTemplate,
} from "./agent-team-template.js";

describe("agent team templates", () => {
  it("parses nested yaml and materializes user manifests", () => {
    const template = parseAgentTeamTemplateContent(`
version: 1
team:
  name: Delivery Squad
  description: Multi-role team
  members:
    - key: architect
      name: architect
      profile: manager
      provider: auto_detect
      tags: [lead, lead, sync]
      capabilities:
        - planning
      canHandleHumanEscalation: true
    - key: reviewer
      name: reviewer
      profile: reviewer
      provider: cursor
      capabilities:
        - domain: code-review
          skills: [typescript]
          resourceTypes: [file]
`, "yaml");

    const manifests = materializeAgentTeamTemplate(template, {
      namePrefix: "alpha",
      defaultProvider: "claude-code",
    });

    expect(template.name).toBe("Delivery Squad");
    expect(manifests).toHaveLength(2);
    expect(manifests[0].fileStem).toBe("alpha-architect");
    expect(manifests[0].manifest.name).toBe("alpha-architect");
    expect(manifests[0].manifest.provider).toBe("claude-code");
    expect(manifests[0].manifest.tags).toEqual(["lead", "sync"]);
    expect(manifests[1].manifest.capabilities).toEqual([
      { domain: "code-review", skills: ["typescript"], resourceTypes: ["file"] },
    ]);
  });

  it("round-trips json serialization", () => {
    const template = createAgentTeamTemplate({
      version: 1,
      name: "Lean Team",
      description: "Fast path team",
      members: [
        {
          key: "lead",
          name: "lead",
          profile: "manager",
          provider: "auto_detect",
        },
      ],
    });

    const json = serializeAgentTeamTemplate(template, "json");
    const reparsed = parseAgentTeamTemplateContent(json, "json");

    expect(reparsed).toEqual(template);
  });

  it("lists and resolves built-in team templates", () => {
    const templates = listBuiltInAgentTeamTemplates();
    const deliveryPod = getBuiltInAgentTeamTemplate("delivery-pod");

    expect(templates.some(template => template.id === "delivery-pod")).toBe(true);
    expect(deliveryPod?.template.members.length).toBeGreaterThan(2);
  });

  it("rejects duplicate member keys", () => {
    expect(() => createAgentTeamTemplate({
      version: 1,
      name: "Broken Team",
      description: "",
      members: [
        {
          key: "duplicate",
          name: "lead",
          profile: "manager",
          provider: "auto_detect",
        },
        {
          key: "duplicate",
          name: "builder",
          profile: "backend",
          provider: "auto_detect",
        },
      ],
    })).toThrow("Duplicate team member key");
  });
});
