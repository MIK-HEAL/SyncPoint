import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const ROOT = (p: string) => resolve(__dirname, p);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000,
  },
  resolve: {
    conditions: ["source"],
    alias: [
      { find: "syncpoint-server/application", replacement: ROOT("../syncpoint-server/src/application/index.ts") },
      { find: "syncpoint-server/repositories", replacement: ROOT("../syncpoint-server/src/repositories/index.ts") },
      { find: /^syncpoint-core$/, replacement: ROOT("../syncpoint-core/src/index.ts") },
      { find: /^syncpoint-kernel$/, replacement: ROOT("../syncpoint-kernel/src/index.ts") },
      { find: /^syncpoint-governance$/, replacement: ROOT("../syncpoint-governance/src/index.ts") },
      { find: /^syncpoint-context$/, replacement: ROOT("../syncpoint-context/src/index.ts") },
      { find: /^syncpoint-adapters$/, replacement: ROOT("../syncpoint-adapters/src/index.ts") },
      { find: /^syncpoint-server$/, replacement: ROOT("../syncpoint-server/src/index.ts") },
      { find: /^syncpoint-plugin-code$/, replacement: ROOT("../syncpoint-plugin-code/src/index.ts") },
      { find: /^syncpoint-plugin-generic-agent$/, replacement: ROOT("../syncpoint-plugin-generic-agent/src/index.ts") },
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
});
