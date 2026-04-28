import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/syncpoint-core",
  "packages/syncpoint-server",
  "packages/syncpoint-sdk",
  "packages/syncpoint-cli",
  "packages/vscode-extension",
]);
