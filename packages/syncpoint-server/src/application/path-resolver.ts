/**
 * Server-side path resolution service.
 *
 * Extends core path-normalize with filesystem-dependent operations:
 *   - Symlink resolution (fs.realpathSync)
 *   - Project root detection
 *   - Path alias mapping from config
 */

import fs from "node:fs";
import path from "node:path";
import {
  normalizeResourcePath,
  type NormalizePathOptions,
} from "syncpoint-core";
import { logger } from "../logger.js";
import { findProjectSyncpointDir } from "../db.js";

// ── Resolve options from config ──────────────────────────

let _cachedProjectRoot: string | null = null;
let _cachedPathAliases: Record<string, string> = {};

/**
 * Detect the project root by looking for .syncpoint/ directory.
 */
export function getProjectRoot(): string {
  if (_cachedProjectRoot) return _cachedProjectRoot;
  // Respect explicit env var (used by tests and CLI overrides)
  const envRoot = process.env.SYNCPOINT_PROJECT_ROOT;
  if (envRoot) {
    _cachedProjectRoot = path.resolve(envRoot);
    return _cachedProjectRoot;
  }
  const syncpointDir = findProjectSyncpointDir();
  if (syncpointDir) {
    _cachedProjectRoot = path.dirname(syncpointDir);
  } else {
    _cachedProjectRoot = process.cwd();
  }
  return _cachedProjectRoot;
}

/**
 * Register path aliases (e.g., from .syncpoint/config.yaml).
 */
export function setPathAliases(aliases: Record<string, string>): void {
  _cachedPathAliases = { ...aliases };
}

// ── Full normalization with I/O ──────────────────────────

/**
 * Fully normalize a resource path for use in claim/constraint operations.
 *
 * Steps:
 *   1. Core normalization (separators, case, dot segments, aliases)
 *   2. Symlink resolution (fs.realpathSync)
 *   3. Re-normalize after symlink resolution
 *
 * This is the canonical form stored in the database.
 */
export function resolveResourcePath(
  input: string,
  options?: { skipSymlinkResolve?: boolean },
): string {
  const root = getProjectRoot();

  const coreOptions: NormalizePathOptions = {
    projectRoot: root,
    aliases: _cachedPathAliases,
  };

  let normalized = normalizeResourcePath(input, coreOptions);

  // Symlink resolution (unless skipped for performance)
  if (!options?.skipSymlinkResolve) {
    try {
      // Only resolve if the file actually exists
      if (fs.existsSync(normalized)) {
        const real = fs.realpathSync(normalized);
        // Re-normalize after realpath (realpath may return platform-native separators)
        normalized = normalizeResourcePath(real, {
          ...coreOptions,
          aliases: undefined, // Already applied above
        });
      }
    } catch (err) {
      // File doesn't exist yet (new file to be created) — use normalized form
      // Symlink loops or permission errors — log and use normalized form
      if (err instanceof Error && !err.message.includes("ENOENT")) {
        logger.warn("Symlink resolution failed, using normalized path", {
          input,
          normalized,
          error: err.message,
        });
      }
    }
  }

  return normalized;
}

/**
 * Normalize a batch of resource locators.
 */
export function resolveResourcePaths(
  locators: string[],
  options?: { skipSymlinkResolve?: boolean },
): string[] {
  return locators.map(loc => resolveResourcePath(loc, options));
}

/**
 * Validate that a path is within the project root.
 * Returns true if the path is safe (no path traversal beyond project root).
 */
export function isPathWithinProject(input: string): boolean {
  const root = getProjectRoot();
  const resolved = resolveResourcePath(input, { skipSymlinkResolve: true });
  const normalizedRoot = normalizeResourcePath(root);
  return resolved.startsWith(normalizedRoot + "/") || resolved === normalizedRoot;
}

/**
 * Reset cached project root (for testing).
 */
export function resetPathResolverCache(): void {
  _cachedProjectRoot = null;
  _cachedPathAliases = {};
}
