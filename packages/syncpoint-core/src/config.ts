/**
 * Unified SyncPoint configuration schema.
 *
 * Single source of truth for all configuration, with:
 *   - Zod validation
 *   - Environment variable mapping
 *   - Sensible defaults
 */

import { z } from "zod";
import type { ZodInvalidEnumValueIssue, ZodTooSmallIssue, ZodTooBigIssue } from "zod";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

// ── Sub-schemas ──────────────────────────────────────────

export const DatabaseConfig = z.object({
  path: z.string().default(".syncpoint/syncpoint.db"),
  wal: z.boolean().default(true),
  busyTimeout: z.number().min(1000).max(30000).default(5000),
  walAutocheckpoint: z.number().min(100).max(10000).default(1000),
  cacheSize: z.number().min(-128000).max(-1000).default(-64000),
});

export const ServerConfig = z.object({
  port: z.number().min(1024).max(65535).default(8765),
  host: z.string().default("127.0.0.1"),
  corsOrigins: z.array(z.string()).default(["http://localhost:*"]),
  maxBodySize: z.number().min(1024).default(5 * 1024 * 1024), // 5MB
});

export const GuardConfig = z.object({
  mode: z.enum(["off", "L1_audit", "L2_warn", "L3_block"]).default("L2_warn"),
  fileWatcher: z.enum(["@parcel/watcher", "native"]).default("native"),
  debounceMs: z.number().min(50).max(5000).default(300),
  maxWatchers: z.number().min(100).max(50000).default(5000),
});

export const SseConfig = z.object({
  heartbeatIntervalMs: z.number().min(5000).max(120000).default(30000),
  maxConnections: z.number().min(1).max(10000).default(200),
  eventRetentionHours: z.number().min(1).max(720).default(24),
});

export const ConstraintsConfig = z.object({
  defaultPolicy: z.enum(["allow_all", "deny_all"]).default("allow_all"),
});

export const CheckpointConfig = z.object({
  snapshotMode: z.enum(["full", "incremental"]).default("incremental"),
  gcStrategy: z.enum(["keep_last_n", "max_age_days", "max_size_mb"]).default("keep_last_n"),
  gcKeepLast: z.number().min(1).max(1000).default(50),
  gcMaxAgeDays: z.number().min(1).max(365).default(30),
  gcMaxSizeMb: z.number().min(10).max(10000).default(500),
});

export const AuthConfig = z.object({
  sharedSecret: z.string().optional(),
  requireToken: z.boolean().default(false),
  tokenHeader: z.string().default("x-agent-token"),
  callerIdHeader: z.string().default("x-caller-id"),
});

export const LogConfig = z.object({
  level: z.enum(["debug", "info", "warn", "error", "fatal"]).default("info"),
  format: z.enum(["json", "pretty"]).default("json"),
});

// ── Root config ──────────────────────────────────────────

export const SyncPointConfigSchema = z.object({
  database: DatabaseConfig.default({}),
  server: ServerConfig.default({}),
  guard: GuardConfig.default({}),
  sse: SseConfig.default({}),
  constraints: ConstraintsConfig.default({}),
  checkpoint: CheckpointConfig.default({}),
  auth: AuthConfig.default({}),
  log: LogConfig.default({}),
});

export type SyncPointConfig = z.infer<typeof SyncPointConfigSchema>;

// ── Default config ───────────────────────────────────────

export const DEFAULT_CONFIG: SyncPointConfig = SyncPointConfigSchema.parse({});

// ── Config merge ─────────────────────────────────────────

/**
 * Deep merge configs, with later sources overriding earlier ones.
 * Priority: defaults < config file < environment variables
 */
export function mergeConfig(...configs: Partial<SyncPointConfig>[]): SyncPointConfig {
  const merged: Record<string, unknown> = {};
  for (const config of configs) {
    for (const [key, value] of Object.entries(config)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        merged[key] = { ...((merged[key] as Record<string, unknown>) ?? {}), ...(value as Record<string, unknown>) };
      } else if (value !== undefined) {
        merged[key] = value;
      }
    }
  }
  return SyncPointConfigSchema.parse(merged);
}

// ── File-based config loading ─────────────────────────────

/**
 * Load config from a YAML file path. Returns partial config or empty object
 * if the file doesn't exist or can't be parsed.
 *
 * Priority: defaults < config file < environment < CLI args
 */
export function configFromFile(filePath: string): Partial<SyncPointConfig> {
  try {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) return {};
    const raw = fs.readFileSync(absPath, "utf-8");
    if (absPath.endsWith(".json")) {
      return JSON.parse(raw) as Partial<SyncPointConfig>;
    }
    // Use the fully-featured yaml library (already a dependency)
    const parsed = parseYaml(raw);
    return (parsed ?? {}) as Partial<SyncPointConfig>;
  } catch {
    return {};
  }
}

/**
/**
 * Full config loading with priority: CLI > env > file > defaults.
 *
 * @param cliOverrides - Partial config from CLI arguments (highest priority)
 * @param filePath - Path to .syncpoint/config.yaml or config.json
 * @returns Validated SyncPointConfig
 */
export function loadConfig(
  cliOverrides?: Partial<SyncPointConfig>,
  filePath?: string,
): SyncPointConfig {
  const fileConfig = filePath ? configFromFile(filePath) : {};
  const envConfig = configFromEnv();
  return mergeConfig(DEFAULT_CONFIG, fileConfig, envConfig, cliOverrides ?? {});
}

// ── Config validation helpers ──────────────────────────────

/** Structured validation error with user-friendly messages. */
export interface ConfigValidationIssue {
  path: string;
  message: string;
  suggestion: string;
}

/**
 * Validate a partial config and return a list of issues.
 * Returns empty array if config is valid.
 */
export function validateConfig(config: unknown): ConfigValidationIssue[] {
  const result = SyncPointConfigSchema.safeParse(config);
  if (result.success) return [];

  const issues: ConfigValidationIssue[] = [];
  for (const err of result.error.issues) {
    const path = err.path.join(".");
    let message = err.message;
    let suggestion = "Check the configuration reference: docs/CONFIG.md";

    if (err.code === "invalid_type") {
      message = `${path}: expected ${err.expected}, got ${err.received}`;
      suggestion = `Set ${path} to a valid ${err.expected} value.`;
    } else if (err.code === "invalid_enum_value") {
      const enumErr = err as ZodInvalidEnumValueIssue;
      message = `${path}: "${enumErr.received}" is not a valid value`;
      suggestion = `Valid options: ${enumErr.options.join(", ")}.`;
    } else if (err.code === "too_small") {
      const tooSmallErr = err as ZodTooSmallIssue;
      message = `${path}: ${tooSmallErr.message}`;
      suggestion = `Minimum value is ${tooSmallErr.minimum}.`;
    } else if (err.code === "too_big") {
      const tooBigErr = err as ZodTooBigIssue;
      message = `${path}: ${tooBigErr.message}`;
      suggestion = `Maximum value is ${tooBigErr.maximum}.`;
    }

    issues.push({ path, message, suggestion });
  }
  return issues;
}

// ── Environment variable mapping ─────────────────────────

/**
 * Build a partial config from environment variables.
 * All env vars are prefixed with SYNCPOINT_ (e.g., SYNCPOINT_SERVER_PORT=8765).
 */
export function configFromEnv(): Partial<SyncPointConfig> {
  const config: Record<string, unknown> = {};

  // Server
  if (process.env.SYNCPOINT_PORT) config.server = { port: parseInt(process.env.SYNCPOINT_PORT, 10) };
  if (process.env.SYNCPOINT_HOST) config.server = { ...(config.server as object ?? {}), host: process.env.SYNCPOINT_HOST };
  if (process.env.SYNCPOINT_CORS_ORIGINS) {
    const corsOrigins = process.env.SYNCPOINT_CORS_ORIGINS.split(",").map(s => s.trim());
    config.server = { ...(config.server as object ?? {}), corsOrigins };
  }

  // Database
  if (process.env.SYNCPOINT_DB_DIR) config.database = { path: process.env.SYNCPOINT_DB_DIR };
  if (process.env.SYNCPOINT_NO_WAL === "true") config.database = { ...(config.database as object ?? {}), wal: false };

  // Guard
  if (process.env.SYNCPOINT_GUARD_MODE) {
    const mode = GuardConfig.shape.mode.safeParse(process.env.SYNCPOINT_GUARD_MODE);
    if (mode.success) config.guard = { mode: mode.data };
  }

  // Constraints
  if (process.env.SYNCPOINT_DEFAULT_POLICY) {
    const policy = ConstraintsConfig.shape.defaultPolicy.safeParse(process.env.SYNCPOINT_DEFAULT_POLICY);
    if (policy.success) config.constraints = { defaultPolicy: policy.data };
  }

  // Auth
  if (process.env.SYNCPOINT_SHARED_SECRET) config.auth = { sharedSecret: process.env.SYNCPOINT_SHARED_SECRET };

  // Log
  if (process.env.LOG_LEVEL) {
    const level = LogConfig.shape.level.safeParse(process.env.LOG_LEVEL);
    if (level.success) config.log = { level: level.data };
  }

  return config as Partial<SyncPointConfig>;
}
