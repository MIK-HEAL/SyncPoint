import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { auditFileChange, auditListActiveResourceClaims, rcUpdateLineRangesForFile, rcHasLineRangeClaims } from "syncpoint-server/application";
import type { AuditFileChangeResult } from "syncpoint-server/application";
import { FileAuditDecisionKind } from "syncpoint-kernel";
import { resolveAgent } from "./connect.js";
// @parcel/watcher types imported dynamically to avoid hard dep on type declarations

interface FileBaseline {
  exists: boolean;
  mtimeMs: number;
  hash: string;
  /** Cached source content for line-range drift tracking. */
  source?: string;
}

interface WatchOptions {
  agent: string;
  task: string;
  session?: string;
  auditOnly?: boolean;
  json?: boolean;
  debounce?: string;
  maxWatchers?: string;
}

const IGNORED_SEGMENTS = new Set([".git", "node_modules", ".syncpoint"]);
const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MAX_WATCHERS = 5000;

export function registerWatchCommands(program: Command): void {
  program
    .command("watch")
    .description("Audit local file writes after they happen and raise SyncGates for claimed-file pollution")
    .argument("<dir>", "Directory to watch")
    .requiredOption("--agent <nameOrId>", "Watching agent name or ID")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--session <sessionId>", "Session ID")
    .option("--audit-only", "Log audit events but do not create SyncGates", false)
    .option("--debounce <ms>", "Debounce interval in milliseconds", String(DEFAULT_DEBOUNCE_MS))
    .option("--max-watchers <n>", "Maximum number of watched files before alert", String(DEFAULT_MAX_WATCHERS))
    .option("--json", "Emit newline-delimited JSON events", false)
    .action(async (dir: string, opts: WatchOptions) => {
      const root = path.resolve(dir);
      const agent = resolveAgent(opts.agent);
      const agentId = agent?.id ?? opts.agent;
      const debounceMs = parseInt(opts.debounce ?? String(DEFAULT_DEBOUNCE_MS), 10) || DEFAULT_DEBOUNCE_MS;
      const maxWatchers = parseInt(opts.maxWatchers ?? String(DEFAULT_MAX_WATCHERS), 10) || DEFAULT_MAX_WATCHERS;
      const baseline = buildBaseline(root, opts.task, opts.session);
      const pending = new Map<string, NodeJS.Timeout>();
      let fileCount = 0;

      printStartup({ root, agentId, opts, baselineCount: baseline.size, debounceMs, maxWatchers });

      // Use @parcel/watcher for cross-platform reliability
      let watcher: { unsubscribe: () => Promise<void> };
      try {
        const { subscribe } = await import("@parcel/watcher");
        watcher = await subscribe(root, async (err: Error | null, events: Array<{ type: string; path: string }>) => {
          if (err) {
            if (opts.json) {
              console.log(JSON.stringify({ type: "watch_error", message: err.message }));
            } else {
              console.error(`Watch error: ${err.message}`);
            }
            return;
          }

          for (const event of events) {
            const locator = normalizeWatchedLocator(root, event.path);
            if (!locator || shouldIgnore(locator)) continue;

            fileCount++;
            if (fileCount > maxWatchers) {
              if (opts.json) {
                console.log(JSON.stringify({ type: "watcher_limit", fileCount, maxWatchers }));
              } else {
                console.warn(`WARNING: Watched file count (${fileCount}) exceeds max (${maxWatchers}). Consider narrowing watch scope.`);
              }
            }

            const existing = pending.get(locator);
            if (existing) clearTimeout(existing);
            pending.set(locator, setTimeout(() => {
              pending.delete(locator);
              processChange(root, locator, baseline, agentId, opts);
            }, debounceMs));
          }
        });
      } catch (importErr) {
        // Fallback to fs.watch if @parcel/watcher is not available
        if (opts.json) {
          console.log(JSON.stringify({ type: "watcher_fallback", message: "@parcel/watcher unavailable, using fs.watch" }));
        } else {
          console.warn("@parcel/watcher unavailable, falling back to fs.watch (less reliable on some platforms)");
        }

        const fsWatcher = fs.watch(root, { recursive: true }, (_eventType, filename: string | Buffer | null) => {
          const locator = normalizeWatchedLocator(root, filename?.toString() ?? "");
          if (!locator || shouldIgnore(locator)) return;

          fileCount++;
          if (fileCount > maxWatchers) {
            if (opts.json) {
              console.log(JSON.stringify({ type: "watcher_limit", fileCount, maxWatchers }));
            } else {
              console.warn(`WARNING: Watched file count (${fileCount}) exceeds max (${maxWatchers}).`);
            }
          }

          const existing = pending.get(locator);
          if (existing) clearTimeout(existing);
          pending.set(locator, setTimeout(() => {
            pending.delete(locator);
            processChange(root, locator, baseline, agentId, opts);
          }, debounceMs));
        });

        fsWatcher.on("error", error => {
          if (opts.json) {
            console.log(JSON.stringify({ type: "watch_error", message: error.message }));
          } else {
            console.error(`Watch error: ${error.message}`);
          }
        });

        await new Promise<void>(resolve => {
          process.once("SIGINT", () => {
            fsWatcher.close();
            for (const timer of pending.values()) clearTimeout(timer);
            if (!opts.json) console.log("\nStopped SyncPoint file audit watcher.");
            resolve();
          });
        });
        return;
      }

      await new Promise<void>(resolve => {
        process.once("SIGINT", async () => {
          await watcher.unsubscribe();
          for (const timer of pending.values()) clearTimeout(timer);
          if (!opts.json) console.log("\nStopped SyncPoint file audit watcher.");
          resolve();
        });
      });
    });
}

function buildBaseline(root: string, taskId: string, sessionId?: string): Map<string, FileBaseline> {
  const baseline = new Map<string, FileBaseline>();
  const claims = auditListActiveResourceClaims({ taskId, sessionId });
  const locators = new Set<string>();
  /** Locators that have line_range–scoped claims and need source caching. */
  const lineRangeLocators = new Set<string>();

  for (const claim of claims) {
    for (const resource of claim.resources) {
      if (resource.type === "file") {
        const normalized = normalizeLocator(resource.locator);
        locators.add(normalized);
        if (resource.scope === "line_range" && resource.lineRange) {
          lineRangeLocators.add(normalized);
        }
      }
    }
  }

  for (const locator of locators) {
    const baselineEntry = readBaseline(root, locator);
    // Cache source content for files with line_range claims
    if (lineRangeLocators.has(locator) && baselineEntry.exists) {
      const filePath = path.resolve(root, locator);
      try {
        baselineEntry.source = fs.readFileSync(filePath, "utf-8");
      } catch { /* if we can't read source, drift tracking won't apply */ }
    }
    baseline.set(locator, baselineEntry);
  }

  return baseline;
}

function processChange(
  root: string,
  locator: string,
  baseline: Map<string, FileBaseline>,
  agentId: string,
  opts: WatchOptions,
): void {
  const current = readBaseline(root, locator);
  const previous = baseline.get(locator);
  if (previous && baselinesEqual(previous, current)) return;

  // ── Line-range drift tracking ──
  // If we have cached old source and the file has line_range claims,
  // compute the line-number drift and update active claims automatically.
  if (previous?.source && current.exists) {
    try {
      const newSource = fs.readFileSync(path.resolve(root, locator), "utf-8");
      if (newSource !== previous.source) {
        const driftResult = rcUpdateLineRangesForFile(locator, previous.source, newSource);
        if (driftResult.updatedRanges > 0 || driftResult.deletedRanges > 0) {
          if (opts.json) {
            console.log(JSON.stringify({
              type: "line_range_drift",
              timestamp: new Date().toISOString(),
              locator,
              updatedRanges: driftResult.updatedRanges,
              deletedRanges: driftResult.deletedRanges,
              claimIds: driftResult.claimIds,
            }));
          } else {
            console.log(`[drift] ${locator}: ${driftResult.updatedRanges} range(s) remapped, ${driftResult.deletedRanges} deleted (${driftResult.updatedClaims} claim(s))`);
          }
        }
        // Cache the new source for future drift computations
        current.source = newSource;
      } else {
        // Content unchanged — preserve previous source cache
        current.source = previous.source;
      }
    } catch {
      // If drift tracking fails (e.g. file unreadable), proceed with audit
    }
  } else if (current.exists && rcHasLineRangeClaims(locator)) {
    // First time seeing this file with line_range claims — cache its source
    try {
      current.source = fs.readFileSync(path.resolve(root, locator), "utf-8");
    } catch { /* will cache on next change */ }
  }

  baseline.set(locator, current);

  const result = auditFileChange({
    actorId: agentId,
    taskId: opts.task,
    sessionId: opts.session,
    locator,
    auditOnly: opts.auditOnly,
  });

  printAuditResult(locator, result, opts.json === true);
}

function printStartup(input: {
  root: string;
  agentId: string;
  opts: WatchOptions;
  baselineCount: number;
  debounceMs: number;
  maxWatchers: number;
}): void {
  if (input.opts.json) {
    console.log(JSON.stringify({
      type: "watch_started",
      root: input.root,
      agentId: input.agentId,
      taskId: input.opts.task,
      sessionId: input.opts.session ?? "",
      auditOnly: input.opts.auditOnly === true,
      baselineCount: input.baselineCount,
      debounceMs: input.debounceMs,
      maxWatchers: input.maxWatchers,
      capability: "post_write_audit_only",
    }));
    return;
  }

  console.log(`SyncPoint file audit watcher started: ${input.root}`);
  console.log(`Agent: ${input.agentId}`);
  console.log(`Task: ${input.opts.task}`);
  if (input.opts.session) console.log(`Session: ${input.opts.session}`);
  console.log(`Baseline: ${input.baselineCount} active claimed file(s) in scope`);
  console.log(`Debounce: ${input.debounceMs}ms`);
  console.log(`Max watchers: ${input.maxWatchers}`);
  console.log("Capability: post-write audit only; watcher cannot pre-block native writes.");
}

function printAuditResult(locator: string, result: AuditFileChangeResult, json: boolean): void {
  const payload = {
    type: "file_audit",
    timestamp: new Date().toISOString(),
    locator,
    eventType: result.eventType,
    decision: result.decision.kind,
    gateId: result.gateId ?? "",
    reusedGate: result.reusedGate,
    conflictingClaimIds: result.decision.conflictingClaims.map(claim => claim.id),
    relatedBlockingGateIds: result.decision.relatedBlockingGateIds,
  };

  if (json) {
    console.log(JSON.stringify(payload));
    return;
  }

  if (result.decision.kind === FileAuditDecisionKind.FILE_POLLUTION_DETECTED) {
    console.log(`[${payload.timestamp}] POLLUTION ALERT: ${locator}`);
    console.log(`  Conflicting claims: ${payload.conflictingClaimIds.join(", ") || "unknown"}`);
    if (result.gateId) console.log(`  SyncGate: ${result.gateId}${result.reusedGate ? " (updated)" : " (created)"}`);
    return;
  }

  if (result.decision.kind === FileAuditDecisionKind.FILE_AUDIT_ALERT) {
    console.log(`[${payload.timestamp}] AUDIT ALERT: ${locator}`);
    console.log(`  Blocking gates: ${payload.relatedBlockingGateIds.join(", ") || "unknown"}`);
    return;
  }

  console.log(`[${payload.timestamp}] ${result.eventType}: ${locator}`);
}

function normalizeWatchedLocator(root: string, filePath: string): string | undefined {
  if (!filePath) return undefined;
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..")) return undefined;
  return normalizeLocator(relative);
}

function normalizeLocator(locator: string): string {
  return locator.replace(/\\/g, "/").replace(/^\.\//, "");
}

function shouldIgnore(locator: string): boolean {
  return locator.split("/").some(segment => IGNORED_SEGMENTS.has(segment));
}

function readBaseline(root: string, locator: string): FileBaseline {
  const filePath = path.isAbsolute(locator) ? locator : path.join(root, locator);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { exists: false, mtimeMs: 0, hash: "" };
    return {
      exists: true,
      mtimeMs: stat.mtimeMs,
      hash: hashFile(filePath),
    };
  } catch {
    return { exists: false, mtimeMs: 0, hash: "" };
  }
}

function hashFile(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function baselinesEqual(a: FileBaseline, b: FileBaseline): boolean {
  return a.exists === b.exists && a.mtimeMs === b.mtimeMs && a.hash === b.hash;
}
