import { z } from "zod";

// ---------------------------------------------------------------------------
// Runner configuration schema
// ---------------------------------------------------------------------------

export const RunnerConfigSchema = z.object({
  // SyncPoint server connection
  serverUrl: z.string().url().default("http://127.0.0.1:8765"),

  // Worker pool
  concurrency: z.coerce.number().int().min(1).max(16).default(1),
  agentPrefix: z.string().default("runner"),

  // Claude Code CLI settings
  claudeBinary: z.string().default("claude"),
  claudePrintMode: z.boolean().default(true),
  claudeTimeout: z.coerce.number().int().min(1000).default(600_000), // 10 min
  claudeMaxTokens: z.coerce.number().int().optional(),

  // Loop behaviour
  maxIterations: z.coerce.number().int().min(1).default(100),
  maxFailuresPerTask: z.coerce.number().int().min(1).default(3),
  pollInterval: z.coerce.number().int().min(100).default(2_000),

  // Safety
  dryRun: z.boolean().default(false),
  escalateOnBlock: z.boolean().default(true),

  // Task filtering
  taskFilter: z
    .object({
      roles: z.array(z.string()).optional(),
      titlePattern: z.string().optional(),
    })
    .optional(),

  // Logging
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  logFile: z.string().optional(),
});

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

// ---------------------------------------------------------------------------
// Environment variable overrides
// ---------------------------------------------------------------------------

const ENV_MAP: Record<string, keyof RunnerConfig> = {
  SYNCPOINT_URL: "serverUrl",
  SYNCPOINT_CONCURRENCY: "concurrency",
  SYNCPOINT_MAX_ITERATIONS: "maxIterations",
  SYNCPOINT_AGENT_PREFIX: "agentPrefix",
  SYNCPOINT_CLAUDE_BINARY: "claudeBinary",
  SYNCPOINT_LOG_LEVEL: "logLevel",
};

/**
 * Parse and validate the runner config. Merges explicit values with env var
 * fallbacks and Zod defaults.
 */
export function parseConfig(overrides: Partial<Record<string, unknown>> = {}): RunnerConfig {
  const merged: Record<string, unknown> = {};

  // Layer 1: env vars
  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    const val = process.env[envKey];
    if (val !== undefined) {
      merged[configKey] = val;
    }
  }

  // Layer 2: explicit overrides (CLI args take precedence)
  Object.assign(merged, overrides);

  // Zod applies defaults for anything still undefined
  return RunnerConfigSchema.parse(merged);
}
