import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { auditFileChange, fileAuditListActiveFileClaims } from "syncpoint-server/application";
import type { AuditFileChangeResult } from "syncpoint-server/application";
import { FileAuditDecisionKind } from "syncpoint-core";
import { resolveAgent } from "./connect.js";

interface FileBaseline {
  exists: boolean;
  mtimeMs: number;
  hash: string;
}

interface WatchOptions {
  agent: string;
  task: string;
  session?: string;
  auditOnly?: boolean;
  json?: boolean;
}

const IGNORED_SEGMENTS = new Set([".git", "node_modules", ".syncpoint"]);
const DEBOUNCE_MS = 300;

export function registerWatchCommands(program: Command): void {
  program
    .command("watch")
    .description("Audit local file writes after they happen and raise SyncGates for claimed-file pollution")
    .argument("<dir>", "Directory to watch")
    .requiredOption("--agent <nameOrId>", "Watching agent name or ID")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--session <sessionId>", "Session ID")
    .option("--audit-only", "Log audit events but do not create SyncGates", false)
    .option("--json", "Emit newline-delimited JSON events", false)
    .action(async (dir: string, opts: WatchOptions) => {
      const root = path.resolve(dir);
      const agent = resolveAgent(opts.agent);
      const agentId = agent?.id ?? opts.agent;
      const baseline = buildBaseline(root, opts.task, opts.session);
      const pending = new Map<string, NodeJS.Timeout>();

      printStartup({ root, agentId, opts, baselineCount: baseline.size });

      const watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
        const locator = normalizeWatchedLocator(root, filename);
        if (!locator || shouldIgnore(locator)) return;

        const existing = pending.get(locator);
        if (existing) clearTimeout(existing);
        pending.set(locator, setTimeout(() => {
          pending.delete(locator);
          processChange(root, locator, baseline, agentId, opts);
        }, DEBOUNCE_MS));
      });

      watcher.on("error", error => {
        if (opts.json) {
          console.log(JSON.stringify({ type: "watch_error", message: error.message }));
          return;
        }
        console.error(`Watch error: ${error.message}`);
      });

      await new Promise<void>(resolve => {
        process.once("SIGINT", () => {
          watcher.close();
          for (const timer of pending.values()) clearTimeout(timer);
          if (!opts.json) console.log("\nStopped SyncPoint file audit watcher.");
          resolve();
        });
      });
    });
}

function buildBaseline(root: string, taskId: string, sessionId?: string): Map<string, FileBaseline> {
  const baseline = new Map<string, FileBaseline>();
  const claims = fileAuditListActiveFileClaims({ taskId, sessionId });
  const locators = new Set<string>();

  for (const claim of claims) {
    for (const resource of claim.resources) {
      if (resource.type === "file") locators.add(normalizeLocator(resource.locator));
    }
  }

  for (const locator of locators) {
    baseline.set(locator, readBaseline(root, locator));
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
      capability: "post_write_audit_only",
    }));
    return;
  }

  console.log(`SyncPoint file audit watcher started: ${input.root}`);
  console.log(`Agent: ${input.agentId}`);
  console.log(`Task: ${input.opts.task}`);
  if (input.opts.session) console.log(`Session: ${input.opts.session}`);
  console.log(`Baseline: ${input.baselineCount} active claimed file(s) in scope`);
  console.log("Capability: post-write audit only; fs.watch cannot pre-block native writes.");
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

function normalizeWatchedLocator(root: string, filename: string | Buffer | null): string | undefined {
  if (!filename) return undefined;
  const raw = filename.toString();
  if (!raw) return undefined;
  const absolute = path.isAbsolute(raw) ? raw : path.join(root, raw);
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
