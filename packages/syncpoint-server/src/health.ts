/**
 * Health check endpoint and utilities for SyncPoint server.
 *
 * Provides:
 *   - GET /health — liveness/readiness check with DB status
 *   - Uptime tracking
 *   - WAL status reporting
 */

import { defaultContext } from "./db.js";
import { logger } from "./logger.js";

// ── Uptime ─────────────────────────────────────────────

const startTime = Date.now();

export function getUptimeSeconds(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

// ── Health status ──────────────────────────────────────

export type HealthStatus = "ok" | "degraded" | "down";

export interface HealthReport {
  status: HealthStatus;
  uptime: number;
  db: {
    status: HealthStatus;
    wal: boolean;
    walSizeBytes?: number | null;
  };
  timestamp: string;
  version: string;
}

/**
 * Build a health report. Used by the health check HTTP endpoint.
 */
export function getHealthReport(): HealthReport {
  const dbIntegrity = defaultContext.checkIntegrity();
  const walEnabled = defaultContext.walEnabled;
  const walSize = defaultContext.getWalSize();

  let dbStatus: HealthStatus = "ok";
  if (!dbIntegrity.ok) {
    dbStatus = "down";
    logger.error("Database integrity check failed", { details: dbIntegrity.details });
  } else if (walEnabled && walSize !== null && walSize > 100 * 1024 * 1024) {
    // WAL file > 100MB — degraded (checkpoint needed)
    dbStatus = "degraded";
    logger.warn("WAL file size exceeds 100MB", { walSizeBytes: walSize });
  }

  const overallStatus: HealthStatus = dbStatus === "down" ? "down" : dbStatus;

  return {
    status: overallStatus,
    uptime: getUptimeSeconds(),
    db: {
      status: dbStatus,
      wal: walEnabled,
      walSizeBytes: walSize,
    },
    timestamp: new Date().toISOString(),
    version: process.env.SYNCPOINT_VERSION ?? "0.1.0",
  };
}

/**
 * Express/connect-compatible health check handler.
 * Returns JSON with appropriate HTTP status code.
 */
export function healthCheckHandler(_req: unknown, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body: string) => void }): void {
  const report = getHealthReport();
  const httpStatus = report.status === "down" ? 503 : report.status === "degraded" ? 200 : 200;
  res.statusCode = httpStatus;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-cache");
  res.end(JSON.stringify(report));
}
