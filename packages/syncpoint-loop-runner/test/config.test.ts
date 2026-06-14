import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RunnerConfigSchema, parseConfig } from "../src/config.js";

describe("RunnerConfigSchema", () => {
  it("applies defaults for all optional fields", () => {
    const config = RunnerConfigSchema.parse({});
    expect(config.serverUrl).toBe("http://127.0.0.1:8765");
    expect(config.concurrency).toBe(1);
    expect(config.agentPrefix).toBe("runner");
    expect(config.claudeBinary).toBe("claude");
    expect(config.claudePrintMode).toBe(true);
    expect(config.claudeTimeout).toBe(600_000);
    expect(config.maxIterations).toBe(100);
    expect(config.maxFailuresPerTask).toBe(3);
    expect(config.pollInterval).toBe(2_000);
    expect(config.dryRun).toBe(false);
    expect(config.escalateOnBlock).toBe(true);
    expect(config.logLevel).toBe("info");
  });

  it("accepts valid overrides", () => {
    const config = RunnerConfigSchema.parse({
      serverUrl: "http://localhost:9999",
      concurrency: 4,
      maxIterations: 50,
      dryRun: true,
      logLevel: "debug",
    });
    expect(config.serverUrl).toBe("http://localhost:9999");
    expect(config.concurrency).toBe(4);
    expect(config.maxIterations).toBe(50);
    expect(config.dryRun).toBe(true);
    expect(config.logLevel).toBe("debug");
  });

  it("rejects invalid URL", () => {
    expect(() => RunnerConfigSchema.parse({ serverUrl: "not-a-url" })).toThrow();
  });

  it("rejects concurrency out of range", () => {
    expect(() => RunnerConfigSchema.parse({ concurrency: 0 })).toThrow();
    expect(() => RunnerConfigSchema.parse({ concurrency: 17 })).toThrow();
  });

  it("rejects invalid log level", () => {
    expect(() => RunnerConfigSchema.parse({ logLevel: "verbose" })).toThrow();
  });

  it("accepts task filter", () => {
    const config = RunnerConfigSchema.parse({
      taskFilter: { titlePattern: "fix.*bug", roles: ["frontend"] },
    });
    expect(config.taskFilter?.titlePattern).toBe("fix.*bug");
    expect(config.taskFilter?.roles).toEqual(["frontend"]);
  });
});

describe("parseConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and clear env vars
    for (const key of ["SYNCPOINT_URL", "SYNCPOINT_CONCURRENCY", "SYNCPOINT_MAX_ITERATIONS"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it("uses defaults when no overrides or env vars", () => {
    const config = parseConfig();
    expect(config.serverUrl).toBe("http://127.0.0.1:8765");
    expect(config.concurrency).toBe(1);
  });

  it("reads from env vars", () => {
    process.env.SYNCPOINT_URL = "http://localhost:4000";
    process.env.SYNCPOINT_CONCURRENCY = "3";
    const config = parseConfig();
    expect(config.serverUrl).toBe("http://localhost:4000");
    expect(config.concurrency).toBe(3);
  });

  it("explicit overrides take precedence over env vars", () => {
    process.env.SYNCPOINT_URL = "http://localhost:4000";
    const config = parseConfig({ serverUrl: "http://localhost:5000" });
    expect(config.serverUrl).toBe("http://localhost:5000");
  });
});
