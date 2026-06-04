import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
      { find: "vscode", replacement: resolve(__dirname, "src/__mocks__/vscode.ts") },
      { find: "syncpoint-core", replacement: resolve(__dirname, "../syncpoint-core/src/index.ts") },
      { find: "syncpoint-sdk", replacement: resolve(__dirname, "../syncpoint-sdk/src/index.ts") },
    ],
  },
});
