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
const mainPath = path.resolve(testDir, "../main.js");

const serviceEntryFiles = [
  "constraint-evaluation-service.js",
  "file-audit-service.js",
  "loop-service.js",
  "operation-service.js",
  "reality-projection-service.js",
  "resource-claim-service.js",
  "wake-engine-service.js",
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

  it("core consumer entry files do not import _plugin-init", () => {
    for (const fileName of serviceEntryFiles) {
      const source = fs.readFileSync(path.join(applicationDir, fileName), "utf8");
      expect(source).not.toContain('_plugin-init');
    }
  });

  it("exposes the bootstrap API from the application barrel and server startup", () => {
    const barrelSource = fs.readFileSync(path.join(applicationDir, "index.js"), "utf8");
    expect(barrelSource).toContain('export * from "./bootstrap.js"');

    const mainSource = fs.readFileSync(mainPath, "utf8");
    expect(mainSource).toContain('import { ensureApplicationBootstrap } from "./application/bootstrap.js";');
    expect(mainSource).toContain("ensureApplicationBootstrap();");
  });

  it("_plugin-init.ts has been removed", () => {
    expect(fs.existsSync(path.join(applicationDir, "_plugin-init.js"))).toBe(false);
  });
});
