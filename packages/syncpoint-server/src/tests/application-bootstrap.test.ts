import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ensureApplicationBootstrap,
  getApplicationBootstrapStatus,
  resetApplicationBootstrapForTest,
} from "../application/bootstrap.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const applicationDir = path.resolve(testDir, "../application");
const mainPath = path.resolve(testDir, "../main.ts");
const legacyPluginInitPath = path.join(applicationDir, "_plugin-init.ts");

const serviceEntryFiles = [
  "constraint-evaluation-service.ts",
  "file-audit-service.ts",
  "loop-service.ts",
  "operation-service.ts",
  "reality-projection-service.ts",
  "resource-claim-service.ts",
  "wake-engine-service.ts",
];

beforeEach(() => {
  resetApplicationBootstrapForTest();
});

describe("application bootstrap", () => {
  it("starts uninitialized after test reset", () => {
    expect(getApplicationBootstrapStatus()).toEqual({
      initialized: false,
      plugins: {
        code: false,
        genericAgent: false,
      },
    });
  });

  it("registers both first-party plugins explicitly and idempotently", () => {
    const first = ensureApplicationBootstrap();
    expect(first.initialized).toBe(true);
    expect(first.plugins.code).toBe(true);
    expect(first.plugins.genericAgent).toBe(true);

    const second = ensureApplicationBootstrap();
    expect(second).toEqual(first);
  });

  it("removes legacy _plugin-init imports from core consumer entry files", () => {
    for (const fileName of serviceEntryFiles) {
      const source = fs.readFileSync(path.join(applicationDir, fileName), "utf8");
      expect(source).not.toContain('_plugin-init');
    }
  });

  it("exposes the bootstrap API from the application barrel and server startup", () => {
    const barrelSource = fs.readFileSync(path.join(applicationDir, "index.ts"), "utf8");
    expect(barrelSource).toContain("ensureApplicationBootstrap");
    expect(barrelSource).toContain("getApplicationBootstrapStatus");
    expect(barrelSource).toContain("resetApplicationBootstrapForTest");

    const mainSource = fs.readFileSync(mainPath, "utf8");
    expect(mainSource).toContain('import { ensureApplicationBootstrap } from "./application/bootstrap.js";');
    expect(mainSource).toContain("ensureApplicationBootstrap();");

    const legacySource = fs.readFileSync(legacyPluginInitPath, "utf8");
    expect(legacySource).not.toContain("registerCodePlugin");
    expect(legacySource).not.toContain("registerGenericAgentPlugin");
  });
});
