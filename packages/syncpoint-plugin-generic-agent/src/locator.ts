/**
 * URI-style locator utilities for generic resources.
 *
 * Locator format: {scheme}://{path}#{fragment}
 * Examples:
 *   artifact://landing-page-design
 *   binary://assets/hero-banner.png
 *   doc://PRD-001#section=pricing
 *   image://hero-banner#bbox=10,20,200,150
 *
 * If the locator has no scheme, the entire string is treated as the path
 * (backward-compatible with plain file paths and asset names).
 */

// ── Types ────────────────────────────────────────────

export interface ParsedLocator {
  /** Scheme before "://", e.g. "artifact", "binary". Empty string if no scheme. */
  scheme: string;
  /** Path component after "://", before "#". */
  path: string;
  /** Fragment after "#", or undefined. */
  fragment?: string;
}

// ── Parsing ──────────────────────────────────────────

const URI_RE = /^([a-z][a-z0-9_-]*):\/\/(.+)$/;

/**
 * Parse a locator string into scheme, path, and optional fragment.
 */
export function parseLocator(locator: string): ParsedLocator {
  const uriMatch = locator.match(URI_RE);
  if (uriMatch) {
    const [, scheme, rest] = uriMatch;
    const hashIdx = rest.indexOf("#");
    if (hashIdx >= 0) {
      return { scheme, path: rest.slice(0, hashIdx), fragment: rest.slice(hashIdx + 1) };
    }
    return { scheme, path: rest };
  }
  // Plain locator (no scheme) — treat entire string as path
  const hashIdx = locator.indexOf("#");
  if (hashIdx >= 0) {
    return { scheme: "", path: locator.slice(0, hashIdx), fragment: locator.slice(hashIdx + 1) };
  }
  return { scheme: "", path: locator };
}

/**
 * Extract the path component from a locator, stripping scheme and fragment.
 */
export function locatorPath(locator: string): string {
  return parseLocator(locator).path;
}

/**
 * Extract the scheme from a locator, or empty string if none.
 */
export function locatorScheme(locator: string): string {
  return parseLocator(locator).scheme;
}

// ── Overlap ──────────────────────────────────────────

/**
 * Check if two locator paths overlap via exact match or prefix containment.
 * Strips trailing slashes before comparison.
 *
 * Overlap rules (MVP — no fragment-level spatial/temporal logic):
 *   1. Exact path match → overlap
 *   2. One path is a prefix directory of the other → overlap
 */
export function locatorPathsOverlap(a: string, b: string): boolean {
  const pa = locatorPath(a).replace(/\/+$/, "");
  const pb = locatorPath(b).replace(/\/+$/, "");
  if (pa === pb) return true;
  if (pa.startsWith(pb + "/") || pb.startsWith(pa + "/")) return true;
  return false;
}
