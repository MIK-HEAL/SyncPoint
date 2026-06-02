/**
 * Unified SyncPoint configuration schema.
 *
 * Single source of truth for all configuration, with:
 *   - Zod validation
 *   - Environment variable mapping
 *   - Sensible defaults
 */

import { z } from "zod";

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

  // Auth
  if (process.env.SYNCPOINT_SHARED_SECRET) config.auth = { sharedSecret: process.env.SYNCPOINT_SHARED_SECRET };

  // Log
  if (process.env.LOG_LEVEL) config.log = { level: process.env.LOG_LEVEL as SyncPointConfig["log"]["level"] };

  return config as Partial<SyncPointConfig>;
}
