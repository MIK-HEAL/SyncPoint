import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
      { find: "syncpoint-core", replacement: resolve(__dirname, "../syncpoint-core/src/index.ts") },
      { find: "syncpoint-kernel", replacement: resolve(__dirname, "../syncpoint-kernel/src/index.ts") },
      { find: "syncpoint-governance", replacement: resolve(__dirname, "../syncpoint-governance/src/index.ts") },
      { find: "syncpoint-context", replacement: resolve(__dirname, "../syncpoint-context/src/index.ts") },
      { find: "syncpoint-adapters", replacement: resolve(__dirname, "../syncpoint-adapters/src/index.ts") },
    ],
  },
});
