// @ts-nocheck — vitest config, processed by vitest not tsc
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/syncpoint-core",
  "packages/syncpoint-server",
  "packages/syncpoint-sdk",
  "packages/syncpoint-cli",
  "packages/syncpoint-plugin-code",
  "packages/syncpoint-plugin-generic-agent",
  "packages/vscode-extension",
  "packages/syncpoint-loop-runner",
]);
