import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
});
