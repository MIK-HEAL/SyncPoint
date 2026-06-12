/**
 * CORS configuration and security headers for the SyncPoint HTTP server.
 * Extracted from main.ts to keep the server entry point focused.
 */

import http from "node:http";

// ── CORS configuration ──────────────────────────────────

const ALLOWED_ORIGINS = (process.env.SYNCPOINT_CORS_ORIGINS ?? "http://localhost:*").split(",").map(s => s.trim());

export function getAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes("*")) return "*";
  for (const allowed of ALLOWED_ORIGINS) {
    if (allowed === origin) return origin;
    // Wildcard prefix match: "http://localhost:*" matches "http://localhost:3000"
    if (allowed.endsWith(":*")) {
      const prefix = allowed.slice(0, -2);
      if (origin.startsWith(prefix)) return origin;
    }
  }
  return null;
}

// ── Security headers ────────────────────────────────────

export function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  if (process.env.SYNCPOINT_HTTPS === "true") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
}

// ── CORS response headers ───────────────────────────────

export function setCorsHeaders(res: http.ServerResponse, origin: string | undefined): void {
  const allowedOrigin = getAllowedOrigin(origin);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  } else if (origin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin ?? "");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-caller-id, x-agent-role, x-agent-token");
  res.setHeader("Access-Control-Max-Age", "86400");
}
