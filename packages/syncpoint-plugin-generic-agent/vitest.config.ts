import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    conditions: ["source"],
    alias: [
      { find: "syncpoint-core", replacement: resolve(__dirname, "../syncpoint-core/src/index.ts") },
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
});
