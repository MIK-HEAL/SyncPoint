/**
 * SyncPoint Core — public API.
 */

export * as KernelApi from "./_exports/kernel.js";
export * as GovernanceApi from "./_exports/governance.js";
export * as ContextLayerApi from "./_exports/context.js";
export * as AdapterApi from "./_exports/adapters.js";

// Canonical layered surfaces
export * from "syncpoint-kernel";
export * from "syncpoint-governance";
export * from "syncpoint-context";
export * from "syncpoint-adapters";

// Unified Config
export {
  SyncPointConfigSchema,
  DatabaseConfig,
  ServerConfig,
  GuardConfig,
  SseConfig,
  ConstraintsConfig,
  CheckpointConfig,
  AuthConfig,
  LogConfig,
  DEFAULT_CONFIG,
  mergeConfig,
  configFromFile,
  configFromEnv,
  loadConfig,
  validateConfig,
} from "./config.js";

export type { SyncPointConfig, ConfigValidationIssue } from "./config.js";
