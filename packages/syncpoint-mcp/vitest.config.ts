import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
  },
  resolve: {
    conditions: ["source"],
    alias: [
      { find: "syncpoint-core", replacement: resolve(__dirname, "../syncpoint-core/src/index.ts") },
      { find: "syncpoint-server/application", replacement: resolve(__dirname, "../syncpoint-server/src/application/index.ts") },
      { find: "syncpoint-server/repositories", replacement: resolve(__dirname, "../syncpoint-server/src/repositories/index.ts") },
      { find: "syncpoint-plugin-code", replacement: resolve(__dirname, "../syncpoint-plugin-code/src/index.ts") },
      { find: "syncpoint-server", replacement: resolve(__dirname, "../syncpoint-server/src/index.ts") },
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
});
