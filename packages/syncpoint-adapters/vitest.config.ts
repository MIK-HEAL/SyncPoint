import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
      { find: "syncpoint-kernel", replacement: "../syncpoint-kernel/src/index.ts" },
      { find: "syncpoint-governance", replacement: "../syncpoint-governance/src/index.ts" },
      { find: "syncpoint-context", replacement: "../syncpoint-context/src/index.ts" },
    ],
  },
});
