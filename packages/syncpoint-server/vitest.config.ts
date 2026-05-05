import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
  },
  resolve: {
    conditions: ["source"],
    alias: [
      { find: "syncpoint-core", replacement: resolve(__dirname, "../syncpoint-core/src/index.ts") },
      { find: "syncpoint-plugin-code", replacement: resolve(__dirname, "../syncpoint-plugin-code/src/index.ts") },
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
});
