/**
 * Admin commands: uninstall, export, import, history, doctor.
 *
 * These provide system management capabilities for SyncPoint.
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as repo from "syncpoint-server/repositories";
import { getDbPath, getRawDb } from "syncpoint-server";
import { EventType } from "syncpoint-kernel";
import { unlockAllGuards } from "syncpoint-server/application";
import { handleError, printError } from "./error-handler.js";

// ── Helpers ───────────────────────────────────────────

function findSyncpointDir(startDir?: string): string {
  let dir = startDir ?? process.cwd();
  for (let i = 0; i < 10; i++) {
    const sp = path.join(dir, ".syncpoint");
    if (fs.existsSync(sp)) return sp;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(startDir ?? process.cwd(), ".syncpoint");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTimestamp(iso: string): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Export / Import types ──────────────────────────────

interface ExportData {
  version: number;
  exportedAt: string;
  platform: string;
  hostname: string;
  agents: unknown[];
  tasks: unknown[];
  resourceClaims: unknown[];
  syncGates: unknown[];
  checkpoints: unknown[];
  contextSnapshots: unknown[];
  events: unknown[];
}

// ── Command registration ──────────────────────────────

export function registerAdminCommands(program: Command): void {
  // ── syncpoint uninstall ─────────────────────────────
  program
    .command("uninstall")
    .description("Clean up .syncpoint/ directory and restore file permissions")
    .option("--dir <path>", "Project directory (defaults to cwd)")
    .option("--keep-db", "Keep the database file", false)
    .option("--dry-run", "Show what would be removed without removing", false)
    .option("--yes", "Skip confirmation prompt", false)
    .option("--json", "Machine-readable JSON output", false)
    .action((opts) => {
      try {
        const spDir = findSyncpointDir(opts.dir);
        const projectDir = path.dirname(spDir);

        if (!fs.existsSync(spDir)) {
          if (opts.json) {
            console.log(JSON.stringify({ status: "not_initialized", message: "No .syncpoint directory found." }));
          } else {
            console.log("No .syncpoint directory found. Nothing to uninstall.");
          }
          return;
        }

        // Collect info
        const dbPath = path.join(spDir, "syncpoint.db");
        const files = walkDir(spDir);
        const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
        const totalSize = files.reduce((sum, f) => sum + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0);

        if (opts.dryRun) {
          if (opts.json) {
            console.log(JSON.stringify({ status: "dry_run", dir: spDir, files, totalSize, dbSize }));
          } else {
            console.log(`Would remove .syncpoint/ at ${spDir}`);
            console.log(`  ${files.length} file(s), ${formatBytes(totalSize)}`);
            if (dbSize > 0) console.log(`  Database: ${formatBytes(dbSize)}`);
          }
          return;
        }

        // Confirmation
        if (!opts.yes) {
          console.log(`This will permanently delete:`);
          console.log(`  Directory: ${spDir}`);
          console.log(`  Files: ${files.length} (${formatBytes(totalSize)})`);
          if (!opts.keepDb && dbSize > 0) console.log(`  Database: ${formatBytes(dbSize)}`);
          console.log("");
          console.log("This action cannot be undone. Are you sure? (y/N)");

          // Non-interactive mode — require --yes
          if (!process.stdin.isTTY) {
            console.log("Run with --yes to confirm in non-interactive mode.");
            process.exitCode = 1;
            return;
          }
          // In TTY mode, read confirmation
          const response = prompt("> ");
          if (!response || !response.toLowerCase().startsWith("y")) {
            console.log("Cancelled.");
            return;
          }
        }

        // Restore file permissions
        console.log("Restoring file permissions...");
        const unlockResult = unlockAllGuards(projectDir);
        if (!opts.json) {
          console.log(`  Unlocked: ${unlockResult.unlocked.length} file(s)`);
          if (unlockResult.errors.length) {
            console.log(`  Errors: ${unlockResult.errors.length}`);
          }
        }

        // Remove files
        if (opts.keepDb && fs.existsSync(dbPath)) {
          // Keep only the DB, remove everything else
          for (const f of files) {
            if (f === dbPath) continue;
            try { fs.unlinkSync(f); } catch { /* best-effort */ }
          }
          if (!opts.json) console.log(`Kept database: ${dbPath}`);
        } else {
          // Remove everything
          fs.rmSync(spDir, { recursive: true, force: true });
          if (!opts.json) console.log(`Removed: ${spDir}`);
        }

        if (opts.json) {
          console.log(JSON.stringify({
            status: "uninstalled",
            dir: spDir,
            removedFiles: files.length,
            totalSize,
            unlockedFiles: unlockResult.unlocked.length,
            keptDb: opts.keepDb,
          }));
        } else {
          console.log("SyncPoint uninstalled successfully.");
        }
      } catch (err: unknown) {
        printError(err);
      }
    });

  // ── syncpoint export ────────────────────────────────
  program
    .command("export")
    .description("Export sync state as JSON")
    .option("--output <path>", "Output file path (defaults to stdout)")
    .option("--format <fmt>", "Output format: json or yaml", "json")
    .option("--session <sessionId>", "Export a specific session only")
    .option("--minimal", "Exclude events and large payloads for compact export", false)
    .action((opts) => {
      try {
        const data: ExportData = {
          version: 1,
          exportedAt: new Date().toISOString(),
          platform: os.platform(),
          hostname: os.hostname(),
          agents: [],
          tasks: [],
          resourceClaims: [],
          syncGates: [],
          checkpoints: [],
          contextSnapshots: [],
          events: [],
        };

        // Collect data
        try { data.agents = repo.listAgents(); } catch {}
        try {
          const rawTasks = repo.listTasks();
          data.tasks = rawTasks.map((t: any) => {
            const { payload, ...rest } = t;
            return opts.minimal ? rest : t;
          });
        } catch {}
        try {
          const claims = repo.listResourceClaims({});
          data.resourceClaims = claims.map((c: any) => {
            const { resourcesJson, ...rest } = c;
            return { ...rest, resources: c.resources ?? [] };
          });
        } catch {}
        try { data.syncGates = repo.listSyncGates({}); } catch {}
        try { data.events = opts.minimal ? [] : repo.listEvents(500); } catch {}

        const output = opts.format === "yaml"
          ? jsonToYaml(data)
          : JSON.stringify(data, null, 2);

        if (opts.output) {
          fs.writeFileSync(path.resolve(opts.output), output, "utf-8");
          console.log(`Exported to ${opts.output} (${formatBytes(Buffer.byteLength(output))})`);
        } else {
          console.log(output);
        }
      } catch (err: unknown) {
        printError(err);
      }
    });

  // ── syncpoint import ─────────────────────────────────
  program
    .command("import")
    .description("Import sync state from a JSON/YAML export file")
    .argument("<file>", "Path to the export file")
    .option("--dry-run", "Validate without importing", false)
    .option("--overwrite", "Overwrite existing data (dangerous!)", false)
    .option("--json", "Machine-readable JSON output", false)
    .action((file, opts) => {
      try {
        const absPath = path.resolve(file);
        if (!fs.existsSync(absPath)) {
          throw new Error(`File not found: ${absPath}`);
        }

        const raw = fs.readFileSync(absPath, "utf-8");
        let data: ExportData;
        try {
          data = JSON.parse(raw);
        } catch {
          // Try YAML
          try {
            data = parseSimpleYaml(raw) as unknown as ExportData;
          } catch {
            throw new Error("Failed to parse export file. Expected JSON or YAML format.");
          }
        }

        if (!data.version) {
          throw new Error("Invalid export file: missing version field.");
        }

        const stats = {
          agents: data.agents?.length ?? 0,
          tasks: data.tasks?.length ?? 0,
          resourceClaims: data.resourceClaims?.length ?? 0,
          syncGates: data.syncGates?.length ?? 0,
          checkpoints: data.checkpoints?.length ?? 0,
          contextSnapshots: data.contextSnapshots?.length ?? 0,
        };

        if (opts.dryRun) {
          if (opts.json) {
            console.log(JSON.stringify({ status: "validated", stats, exportedAt: data.exportedAt }));
          } else {
            console.log("Export file is valid.");
            console.log(`Exported at: ${data.exportedAt}`);
            console.log(`Contents: ${stats.agents} agents, ${stats.tasks} tasks, ${stats.resourceClaims} claims`);
            console.log("Run without --dry-run to import.");
          }
          return;
        }

        // Import agents
        let imported = 0;
        for (const agent of data.agents ?? []) {
          try {
            repo.createAgent(agent as any);
            imported++;
          } catch { /* skip duplicates */ }
        }

        // Import tasks
        for (const task of data.tasks ?? []) {
          try {
            repo.createTask(task as any);
            imported++;
          } catch { /* skip duplicates */ }
        }

        if (opts.json) {
          console.log(JSON.stringify({ status: "imported", imported, stats }));
        } else {
          console.log(`Import complete: ${imported} entities imported.`);
          console.log(`  Agents: ${stats.agents}, Tasks: ${stats.tasks}, Claims: ${stats.resourceClaims}`);
          console.log(`  Gates: ${stats.syncGates}, Snapshots: ${stats.contextSnapshots}`);
        }
      } catch (err: unknown) {
        printError(err);
      }
    });

  // ── syncpoint history ────────────────────────────────
  program
    .command("history")
    .description("View operation history with filtering")
    .option("--agent <nameOrId>", "Filter by agent")
    .option("--task <taskId>", "Filter by task")
    .option("--since <iso-date>", "Show events since this date (ISO format)")
    .option("--limit <n>", "Maximum events to show", "50")
    .option("--type <eventType>", "Filter by event type (e.g. RESOURCE_CLAIMED)")
    .option("--json", "Machine-readable JSON output", false)
    .action((opts) => {
      try {
        const limit = parseInt(opts.limit ?? "50", 10) || 50;
        const events = repo.listEvents(limit * 2); // fetch more for client-side filtering

        // Apply filters
        let filtered = events;
        if (opts.agent) {
          const agentLower = opts.agent.toLowerCase();
          filtered = filtered.filter((e: any) =>
            (e.detail ?? "").toLowerCase().includes(agentLower) ||
            (e.entityId ?? "").toLowerCase().includes(agentLower)
          );
        }
        if (opts.task) {
          filtered = filtered.filter((e: any) =>
            (e.detail ?? "").includes(opts.task) ||
            (e.entityId ?? "").includes(opts.task)
          );
        }
        if (opts.type) {
          filtered = filtered.filter((e: any) =>
            (e.eventType ?? e.type ?? "") === opts.type
          );
        }
        if (opts.since) {
          const sinceDate = new Date(opts.since).getTime();
          filtered = filtered.filter((e: any) => {
            const d = new Date(e.createdAt ?? e.timestamp ?? 0).getTime();
            return d >= sinceDate;
          });
        }

        if (opts.json) {
          console.log(JSON.stringify(filtered.slice(0, limit), null, 2));
          return;
        }

        if (filtered.length === 0) {
          console.log("No events found matching the criteria.");
          return;
        }

        console.log(`${Math.min(filtered.length, limit)} event(s):`);
        for (const event of filtered.slice(0, limit)) {
          const e = event as any;
          const ts = formatTimestamp(e.createdAt ?? e.timestamp ?? "");
          const typeLabel = (e.eventType ?? e.type ?? "unknown").padEnd(30);
          const entity = `${e.entityType ?? ""}:${e.entityId ?? e.id ?? ""}`.padEnd(25);
          console.log(`  ${ts}  ${typeLabel}  ${entity}`);
          if (e.detail) {
            const detail = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
            if (detail.length > 100) {
              console.log(`           ${detail.slice(0, 100)}...`);
            } else if (detail) {
              console.log(`           ${detail}`);
            }
          }
        }
        if (filtered.length > limit) {
          console.log(`  ... and ${filtered.length - limit} more. Use --limit to increase.`);
        }
      } catch (err: unknown) {
        printError(err);
      }
    });

  // NOTE: `syncpoint doctor` is registered in connect.ts (which runs first).
  // The deeper DB integrity / WAL / orphan checks from admin.ts are merged there.
}

// ── Helpers ───────────────────────────────────────────

function walkDir(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDir(full));
      } else {
        results.push(full);
      }
    }
  } catch { /* best-effort */ }
  return results;
}

function dirSize(dir: string): number {
  return walkDir(dir).reduce((sum, f) => {
    try { return sum + fs.statSync(f).size; } catch { return sum; }
  }, 0);
}

function jsonToYaml(obj: unknown, indent = ""): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean" || typeof obj === "number") return String(obj);
  if (typeof obj === "string") {
    if (obj.includes("\n") || obj.includes(":") || obj.includes("#")) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((item: unknown) => `${indent}- ${jsonToYaml(item, indent + "  ")}`).join("\n");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries.map(([key, value]) => `${indent}${key}: ${jsonToYaml(value, indent + "  ")}`).join("\n");
  }
  return String(obj);
}

function parseSimpleYaml(raw: string): Record<string, unknown> {
  // Reuse the config parser approach
  const result: Record<string, unknown> = {};
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const valuePart = trimmed.slice(colonIdx + 1).trim();
    if (valuePart === "" || valuePart === "{}") {
      result[key] = {};
    } else if (valuePart === "true") {
      result[key] = true;
    } else if (valuePart === "false") {
      result[key] = false;
    } else if (/^-?\d+$/.test(valuePart)) {
      result[key] = parseInt(valuePart, 10);
    } else {
      result[key] = valuePart.replace(/^["']|["']$/g, "");
    }
  }
  return result;
}
