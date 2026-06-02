/**
 * Path normalization for cross-platform resource consistency.
 *
 * Ensures that different representations of the same file path
 * are treated as the same resource, regardless of:
 *   - Relative vs absolute paths
 *   - Platform-specific separators (\ vs /)
 *   - Case differences (on case-insensitive filesystems)
 *   - Trailing slashes and redundant segments
 *
 * This module contains PURE functions with no I/O.
 * Filesystem-dependent operations (symlink resolution, realpath)
 * are provided by the server package.
 */

// ── Types ───────────────────────────────────────────────

export interface NormalizePathOptions {
  /** Project root directory (absolute path). Relative paths are resolved against this. */
  projectRoot?: string;
  /** Whether to normalize case to lowercase. Default: auto-detect based on platform. */
  caseSensitive?: boolean;
  /** Paths that should be treated as equivalent to the given canonical form. */
  aliases?: Record<string, string>;
}

// ── Path normalization (pure, no I/O) ───────────────────

/**
 * Normalize a path for use as a resource locator.
 *
 * - Converts to absolute path (if projectRoot is provided)
 * - Resolves `.` and `..` segments
 * - Converts all separators to POSIX `/`
 * - Normalizes case on Windows (unless caseSensitive is true)
 * - Removes trailing slashes
 * - Applies path alias mappings
 *
 * This is a PURE function — no filesystem access.
 */
export function normalizeResourcePath(
  input: string,
  options: NormalizePathOptions = {},
): string {
  let path = input.trim();

  if (!path) return "";

  // URI-scheme locators (e.g. binary://, artifact://) are not file paths — return as-is
  if (isUriScheme(path)) return path;

  // Apply path aliases first (e.g., project-shortcut → real-path)
  if (options.aliases) {
    for (const [alias, target] of Object.entries(options.aliases)) {
      if (path === alias || path.startsWith(alias + "/") || path.startsWith(alias + "\\")) {
        path = target + path.slice(alias.length);
        break;
      }
    }
  }

  // Resolve relative to project root
  if (options.projectRoot && !isAbsolutePath(path)) {
    path = joinPath(options.projectRoot, path);
  }

  // Normalize separators to POSIX
  path = path.replace(/\\/g, "/");

  // Resolve . and .. segments
  path = resolveDotSegments(path);

  // Remove trailing slash (unless root "/")
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  // Case normalization (Windows is case-insensitive by default)
  const caseSensitive = options.caseSensitive ?? !isWindowsPlatform();
  if (!caseSensitive) {
    path = path.toLowerCase();
    // But preserve the drive letter uppercase on Windows (C: → c: is fine)
  }

  return path;
}

// ── Pure helpers ────────────────────────────────────────

/** Check if a string is a URI-scheme locator (e.g. binary://, artifact://). */
function isUriScheme(p: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(p);
}

/** Check if a path is absolute (cross-platform). */
function isAbsolutePath(p: string): boolean {
  // POSIX absolute
  if (p.startsWith("/")) return true;
  // Windows absolute: C:\ or \\server\share
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (p.startsWith("\\\\")) return true;
  return false;
}

/** Join path segments (pure, no fs). */
function joinPath(...segments: string[]): string {
  return segments
    .map(s => s.replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter(Boolean)
    .join("/")
    .replace(/^([a-zA-Z]):/, (_, drive) => drive.toUpperCase() + ":");
}

/** Resolve `.` and `..` segments in a path. */
function resolveDotSegments(p: string): string {
  const isWindowsAbsolute = /^[a-zA-Z]:\//.test(p);
  // Strip drive prefix before splitting so it doesn't become a segment
  const drivePrefix = isWindowsAbsolute ? p.slice(0, 3) : "";
  const strippedPath = isWindowsAbsolute ? p.slice(3) : p;
  const parts = strippedPath.split("/");
  const result: string[] = [];

  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (result.length > 0 && result[result.length - 1] !== "..") {
        result.pop();
      } else if (!isWindowsAbsolute) {
        result.push("..");
      }
    } else {
      result.push(part);
    }
  }

  let resolved = result.join("/");

  // Restore leading slash for POSIX absolute paths
  if (p.startsWith("/")) {
    resolved = "/" + resolved;
  }
  // Restore Windows drive prefix (e.g., "C:/")
  if (isWindowsAbsolute) {
    resolved = drivePrefix + resolved;
  }

  return resolved || (p.startsWith("/") ? "/" : ".");
}

function isWindowsPlatform(): boolean {
  // Allow override via env for testing
  if (process.env.SYNCPOINT_CASE_SENSITIVE === "true") return false;
  if (process.env.SYNCPOINT_CASE_SENSITIVE === "false") return true;
  return process.platform === "win32";
}

// ── Path equivalence ────────────────────────────────────

/**
 * Check if two paths refer to the same resource after normalization.
 * Wrapper around normalizeResourcePath for convenience.
 */
export function arePathsEquivalent(
  a: string,
  b: string,
  options: NormalizePathOptions = {},
): boolean {
  return normalizeResourcePath(a, options) === normalizeResourcePath(b, options);
}

// ── Locator key for resource maps ───────────────────────

/**
 * Produce a stable key for a resource locator that can be used as
 * a Map key for conflict detection and claim lookups.
 * This is the normalized path.
 */
export function toResourceLocatorKey(
  resourceType: string,
  locator: string,
  options: NormalizePathOptions = {},
): string {
  return `${resourceType}:${normalizeResourcePath(locator, options)}`;
}
