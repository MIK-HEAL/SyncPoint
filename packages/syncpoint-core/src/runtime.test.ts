/**
 * Runtime identity — pure logic tests.
 */

import { describe, it, expect } from "vitest";
import { resolveIdentity, IdentityConflictError } from "./runtime.js";

describe("resolveIdentity", () => {
  it("returns null when no env and no parameter", () => {
    const result = resolveIdentity({}, undefined);
    expect(result).toBeNull();
  });

  it("uses SYNCPOINT_AGENT_ID when set", () => {
    const result = resolveIdentity({ SYNCPOINT_AGENT_ID: "agent-arch" }, undefined);
    expect(result).toEqual({
      agentId: "agent-arch",
      runtimeId: null,
      source: "env-agent",
    });
  });

  it("uses SYNCPOINT_AGENT_ID and includes runtimeId if both set", () => {
    const result = resolveIdentity(
      { SYNCPOINT_AGENT_ID: "agent-arch", SYNCPOINT_RUNTIME_ID: "rt-1" },
      undefined,
    );
    expect(result).toEqual({
      agentId: "agent-arch",
      runtimeId: "rt-1",
      source: "env-agent",
    });
  });

  it("throws IdentityConflictError when input conflicts with env agent", () => {
    expect(() =>
      resolveIdentity({ SYNCPOINT_AGENT_ID: "agent-arch" }, "agent-other")
    ).toThrow(IdentityConflictError);
  });

  it("allows input that matches env agent", () => {
    const result = resolveIdentity({ SYNCPOINT_AGENT_ID: "agent-arch" }, "agent-arch");
    expect(result?.agentId).toBe("agent-arch");
    expect(result?.source).toBe("env-agent");
  });

  it("resolves agent via runtime lookup", () => {
    const lookup = (rtId: string) => rtId === "rt-1" ? "agent-work" : null;
    const result = resolveIdentity(
      { SYNCPOINT_RUNTIME_ID: "rt-1" },
      undefined,
      lookup,
    );
    expect(result).toEqual({
      agentId: "agent-work",
      runtimeId: "rt-1",
      source: "env-runtime",
    });
  });

  it("throws when input conflicts with runtime-resolved agent", () => {
    const lookup = (rtId: string) => "agent-work";
    expect(() =>
      resolveIdentity({ SYNCPOINT_RUNTIME_ID: "rt-1" }, "agent-other", lookup)
    ).toThrow(IdentityConflictError);
  });

  it("returns null when runtime lookup returns null and no agentId env", () => {
    const lookup = () => null;
    const result = resolveIdentity(
      { SYNCPOINT_RUNTIME_ID: "rt-1" },
      undefined,
      lookup,
    );
    expect(result).toBeNull();
  });

  it("returns null with no env and no parameter (legacy fallback removed)", () => {
    const result = resolveIdentity({}, "agent-legacy");
    expect(result).toBeNull();
  });
});
