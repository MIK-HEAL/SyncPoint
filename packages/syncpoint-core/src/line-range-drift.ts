/**
 * Line-range drift tracking for resource claims.
 *
 * When source code is edited, line numbers shift. This module computes
 * the line-number remapping from old → new source text and provides
 * helpers to update line_range–scoped resource claims automatically.
 *
 * Algorithm: token-based diff that produces an edit script, then
 * builds a monotonic mapping from old line numbers to new line numbers.
 */

import type { LineRange } from "./resource.js";

// ── Public types ──────────────────────────────────────

export interface LineMapping {
  /**
   * Map an old 1-indexed line number to its new 1-indexed line number.
   * Returns 0 if the line was deleted.
   */
  mapLine(oldLine: number): number;

  /**
   * Update a LineRange from old line numbers to new line numbers.
   * Returns undefined if the entire range was deleted.
   */
  remapRange(range: LineRange): LineRange | undefined;
}

export interface DriftResult {
  /** Number of lines added. */
  added: number;
  /** Number of lines removed. */
  removed: number;
  /** Mapping from old line numbers to new. */
  mapping: LineMapping;
}

// ── Core algorithm ────────────────────────────────────

/**
 * Compute the line-number drift between old and new source text.
 *
 * Uses a simple LCS-based diff: identifies unchanged lines,
 * then builds a monotonic old→new mapping. Added lines shift
 * subsequent lines down; removed lines pull subsequent lines up.
 */
export function computeLineDrift(oldSource: string, newSource: string): DriftResult {
  // Normalize empty input: "".split("\n") → [""] (length 1), but we want 0 lines
  const oldLines = oldSource === "" ? [] : oldSource.split("\n");
  const newLines = newSource === "" ? [] : newSource.split("\n");

  // Fast path: identical content
  if (oldSource === newSource) {
    return {
      added: 0,
      removed: 0,
      mapping: identityMapping(oldLines.length),
    };
  }

  // Compute the edit script using a line-hash–based approach.
  // We match lines by content hash, then resolve ambiguities with
  // a greedy longest-common-subsequence pass.
  const editOps = computeEditOps(oldLines, newLines);

  // Build the mapping from edit ops
  const mapping = buildLineMapping(oldLines.length, newLines.length, editOps);

  const added = editOps.filter(op => op.kind === "ins").length;
  const removed = editOps.filter(op => op.kind === "del").length;

  return { added, removed, mapping };
}

// ── Edit operations ───────────────────────────────────

interface EditOp {
  kind: "keep" | "ins" | "del";
  oldLine: number; // 0-indexed
  newLine: number; // 0-indexed (meaningful for keep/ins)
}

/**
 * Compute a minimal edit script (old → new) via greedy LCS.
 *
 * Phase 1: build an index of new-line hashes → positions.
 * Phase 2: walk old lines; for each, find the earliest unused
 *   matching new-line position that respects monotonic order.
 * Phase 3: emit keep/ins/del ops.
 */
function computeEditOps(oldLines: string[], newLines: string[]): EditOp[] {
  // Index new lines by content hash for fast lookup
  const newIndex = new Map<string, number[]>();
  for (let i = 0; i < newLines.length; i++) {
    const h = hashLine(newLines[i]!);
    const arr = newIndex.get(h);
    if (arr) arr.push(i);
    else newIndex.set(h, [i]);
  }

  // Greedy LCS: for each old line, find the earliest matching new line
  // that comes after the previous match
  const matches: Array<{ oldIdx: number; newIdx: number }> = [];
  let newCursor = 0;
  const usedNew = new Set<number>();

  for (let oi = 0; oi < oldLines.length; oi++) {
    const h = hashLine(oldLines[oi]!);
    const candidates = newIndex.get(h);
    if (!candidates) continue;

    // Find the first unused candidate at or after newCursor
    for (const ni of candidates) {
      if (usedNew.has(ni)) continue;
      if (ni >= newCursor) {
        matches.push({ oldIdx: oi, newIdx: ni });
        usedNew.add(ni);
        newCursor = ni + 1;
        break;
      }
    }
  }

  // Build edit ops from matches
  const ops: EditOp[] = [];
  let mi = 0;
  let oi = 0;
  let ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    if (mi < matches.length && matches[mi]!.oldIdx === oi && matches[mi]!.newIdx === ni) {
      ops.push({ kind: "keep", oldLine: oi, newLine: ni });
      oi++;
      ni++;
      mi++;
    } else if (mi < matches.length && matches[mi]!.oldIdx > oi) {
      // Old line was deleted
      ops.push({ kind: "del", oldLine: oi, newLine: ni });
      oi++;
    } else if (mi < matches.length && matches[mi]!.newIdx > ni) {
      // New line was inserted
      ops.push({ kind: "ins", oldLine: oi, newLine: ni });
      ni++;
    } else if (oi < oldLines.length && ni < newLines.length) {
      // No more matches — remaining lines are a replace (del + ins)
      ops.push({ kind: "del", oldLine: oi, newLine: ni });
      oi++;
    } else if (oi < oldLines.length) {
      ops.push({ kind: "del", oldLine: oi, newLine: ni });
      oi++;
    } else {
      ops.push({ kind: "ins", oldLine: oi, newLine: ni });
      ni++;
    }
  }

  return ops;
}

/**
 * Build a LineMapping from edit operations.
 *
 * Lines present in both old and new (matched via LCS) get mapped to their
 * new 1-indexed position. Lines unique to the old file (deleted) return 0.
 *
 * The mapping is stored as an array where index = oldLine (0-indexed)
 * and value = newLine (1-indexed), or 0 for deleted.
 */
function buildLineMapping(
  oldLen: number,
  _newLen: number,
  ops: EditOp[],
): LineMapping {
  // Direct mapping array: oldLine → newLine (1-indexed), 0 = deleted
  const direct: number[] = new Array(oldLen).fill(0);

  for (const op of ops) {
    if (op.kind === "keep") {
      direct[op.oldLine] = op.newLine + 1; // convert to 1-indexed
    }
    // del lines stay 0 (deleted)
  }

  return {
    mapLine(oldLine: number): number {
      const idx = oldLine - 1; // convert to 0-indexed
      if (idx < 0) return 0;
      if (idx >= direct.length) return 0; // past end of old file
      return direct[idx]!; // 0 for deleted, 1+ for kept
    },

    remapRange(range: LineRange): LineRange | undefined {
      const newStart = this.mapLine(range.start);
      if (newStart <= 0) return undefined;
      const newEnd = this.mapLine(range.end);
      if (newEnd <= 0) return undefined;
      return { start: newStart, end: newEnd };
    },
  };
}

function identityMapping(lineCount: number): LineMapping {
  return {
    mapLine(oldLine: number): number {
      if (oldLine < 1 || oldLine > lineCount) return 0;
      return oldLine;
    },
    remapRange(range: LineRange): LineRange | undefined {
      return { ...range };
    },
  };
}

// ── Helpers ───────────────────────────────────────────

function hashLine(line: string): string {
  // Fast content hash for line matching — use trimmed content
  // to be resilient to whitespace-only changes
  const trimmed = line.trim();
  if (trimmed.length <= 40) return trimmed;
  // For long lines, use a simple hash
  let h = 0;
  for (let i = 0; i < trimmed.length; i++) {
    h = ((h << 5) - h + trimmed.charCodeAt(i)) | 0;
  }
  return `h${h.toString(36)}`;
}

// ── High-level integration helpers ────────────────────

/**
 * Given old/new source and a set of line ranges, remap all ranges
 * to their new positions. Ranges that were entirely deleted are dropped.
 */
export function remapLineRanges(
  oldSource: string,
  newSource: string,
  ranges: LineRange[],
): LineRange[] {
  const { mapping } = computeLineDrift(oldSource, newSource);
  const remapped: LineRange[] = [];
  for (const r of ranges) {
    const updated = mapping.remapRange(r);
    if (updated) remapped.push(updated);
  }
  return remapped;
}

/**
 * Given old file content, detect whether a specific line range
 * still exists in the new content (i.e., all its lines were not deleted).
 */
export function rangeStillExists(
  oldSource: string,
  newSource: string,
  range: LineRange,
): boolean {
  const { mapping } = computeLineDrift(oldSource, newSource);
  return mapping.remapRange(range) !== undefined;
}
