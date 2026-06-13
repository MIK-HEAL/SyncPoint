import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const ROOT = (p: string) => resolve(__dirname, p);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    conditions: ["source"],
    alias: [
      { find: /^syncpoint-core$/, replacement: ROOT("../syncpoint-core/src/index.ts") },
      { find: /^syncpoint-kernel$/, replacement: ROOT("../syncpoint-kernel/src/index.ts") },
      { find: /^syncpoint-governance$/, replacement: ROOT("../syncpoint-governance/src/index.ts") },
      { find: /^syncpoint-context$/, replacement: ROOT("../syncpoint-context/src/index.ts") },
      { find: /^syncpoint-adapters$/, replacement: ROOT("../syncpoint-adapters/src/index.ts") },
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
});
