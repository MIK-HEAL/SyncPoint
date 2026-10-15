import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import type { ResourceRef } from "syncpoint-kernel";
import { rcClaim, rcRelease, rcList } from "syncpoint-server/application";
import { requireAgentId } from "./shared.js";

export function registerResourceCommands(program: Command): void {  program
    .command("claim")
    .description("Declare resource ownership for the current task")
    .argument("<locators>", "Comma-separated resource locators (file paths, asset names, etc.)")
    .requiredOption("--agent <nameOrId>", "Agent name or ID")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--type <type>", "Resource type (file, binary_asset, db_table, ...)", "file")
    .option("--scope <scope>", "Claim granularity: file, function, or line_range", "file")
    .option("--function <name>", "Function name when --scope function")
    .option("--lines <start>-<end>", "Line range when --scope line_range (e.g. 10-30)")
    .option("--session <sessionId>", "Session ID")
    .option("--mode <mode>", "Claim mode: exclusive or shared", "exclusive")
    .option("--batch <file>", "Batch claim from a JSON or YAML file (one claim per line or array)")
    .option("--json", "Machine-readable JSON output")
    .action((locators, opts) => {
      if (opts.batch) {
        // Batch claim from file
        const batchPath = path.resolve(opts.batch);
        if (!fs.existsSync(batchPath)) {
          console.error(`Batch file not found: ${batchPath}`);
          process.exitCode = 1;
          return;
        }
        const raw = fs.readFileSync(batchPath, "utf-8");
        let entries: Array<{ locator: string; type?: string; scope?: string; functionName?: string; lineRange?: { start: number; end: number } }>;
        try {
          entries = JSON.parse(raw);
          if (!Array.isArray(entries)) entries = [entries];
        } catch {
          // Try line-by-line: each line is "locator [type] [scope]"
          entries = raw.split("\n").filter(line => line.trim() && !line.trim().startsWith("#")).map(line => {
            const parts = line.trim().split(/\s+/);
            return { locator: parts[0] ?? line.trim(), type: parts[1], scope: parts[2] };
          });
        }
        let successCount = 0;
        let conflictCount = 0;
        for (const entry of entries) {
          try {
            const result = rcClaim({
              actorId: requireAgentId(opts.agent),
              taskId: opts.task,
              sessionId: opts.session,
              resources: [{
                type: entry.type ?? opts.type ?? "file",
                locator: entry.locator,
                scope: (entry.scope ?? "file") as "file" | "function" | "line_range",
                metadata: "",
                ...(entry.functionName ? { functionName: entry.functionName } : {}),
                ...(entry.lineRange ? { lineRange: entry.lineRange } : {}),
              }],
              mode: opts.mode,
            });
            successCount++;
            if (result.conflicts.length > 0) conflictCount++;
          } catch (e) {
            if (opts.json) {
              console.log(JSON.stringify({ locator: entry.locator, error: (e as Error).message }));
            } else {
              console.error(`  Failed: ${entry.locator} — ${(e as Error).message}`);
            }
          }
        }
        if (opts.json) {
          console.log(JSON.stringify({ status: "batch_complete", total: entries.length, succeeded: successCount, conflicts: conflictCount }));
        } else {
          console.log(`Batch claim complete: ${successCount}/${entries.length} succeeded, ${conflictCount} conflict(s)`);
        }
        return;
      }

      const agentId = requireAgentId(opts.agent);
      let lineRange: { start: number; end: number } | undefined;
      if (opts.scope === "line_range" && opts.lines) {
        const parts = String(opts.lines).split("-").map(Number);
        if (parts.length === 2 && parts[0]! > 0 && parts[1]! >= parts[0]!) {
          lineRange = { start: parts[0]!, end: parts[1]! };
        } else {
          console.error(`Invalid --lines format: ${opts.lines}. Expected <start>-<end> (e.g. 10-30).`);
          process.exitCode = 1;
          return;
        }
      }
      const resources: ResourceRef[] = locators.split(",").map((p: string) => ({
        type: opts.type as string,
        locator: p.trim(),
        metadata: "",
        ...(opts.scope && opts.scope !== "file" ? { scope: opts.scope } : {}),
        ...(opts.scope === "function" && opts.function ? { functionName: opts.function } : {}),
        ...(lineRange ? { lineRange } : {}),
      }));
      const result = rcClaim({
        actorId: agentId,
        taskId: opts.task,
        sessionId: opts.session,
        resources,
        mode: opts.mode,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const scopeDesc = opts.scope !== "file" ? `, scope=${opts.scope}${opts.function ? `:${opts.function}` : ""}${lineRange ? `:${lineRange.start}-${lineRange.end}` : ""}` : "";
      const resourceList = resources.map((r) => {
        let desc = r.locator;
        if (r.scope === "function" && r.functionName) desc += ` [function:${r.functionName}]`;
        if (r.scope === "line_range" && r.lineRange) desc += ` [lines:${r.lineRange.start}-${r.lineRange.end}]`;
        return desc;
      }).join(", ");
      console.log(`✅ Claimed: ${resourceList}`);
      console.log(`   Agent: ${agentId} | Task: ${opts.task} | Mode: ${opts.mode}${scopeDesc}`);
      console.log(`   Claim ID: ${result.claim.id}`);
      if (result.conflicts.length > 0) {
        console.log("");
        console.log(`⚠️  ${result.conflicts.length} conflict(s) detected:`);
        for (const c of result.conflicts) {
          const isHard = c.isHardConflict ? "🔒 HARD" : "ℹ️  SOFT";
          console.log(`   ${isHard} ${c.overlappingLocator}`);
        }
      }
      if (result.gateId) {
        console.log("");
        console.log(`🚧 SyncGate created: ${result.gateId}`);
        console.log("   Both agents must acknowledge and resolve before continuing.");
      }
    });

  // ── syncpoint release ────────────────────────────────
  program
    .command("release")
    .description("Release resource claims")
    .option("--claim <claimId>", "Release a specific claim by ID")
    .option("--all", "Release all claims for the specified agent")
    .option("--agent <nameOrId>", "Agent name or ID (required for --all)")
    .option("--task <taskId>", "Filter --all by task")
    .option("--session <sessionId>", "Session ID")
    .option("--json", "Machine-readable JSON output")
    .action((opts) => {
      try {
        if (opts.claim) {
          // Release specific claim
          const released = rcRelease(opts.claim);
          if (opts.json) {
            console.log(JSON.stringify(released, null, 2));
          } else {
            console.log(`✅ Released: ${released.id}`);
            const resources = released.resources?.map((r: any) => r.locator).join(", ") ?? "";
            console.log(`   Resources: ${resources}`);
            console.log(`   Status: ${released.status}`);
          }
          return;
        }

        if (opts.all) {
          if (!opts.agent) {
            console.error("--all requires --agent to be specified.");
            process.exitCode = 1;
            return;
          }
          const agentId = requireAgentId(opts.agent);
          const claims = rcList({
            actorId: agentId,
            taskId: opts.task,
            sessionId: opts.session,
            status: "ACTIVE",
          });
          const releasedIds: string[] = [];
          const errors: string[] = [];
          for (const claim of claims) {
            try {
              rcRelease(claim.id);
              releasedIds.push(claim.id);
            } catch (e) {
              errors.push(`${claim.id}: ${(e as Error).message}`);
            }
          }
          if (opts.json) {
            console.log(JSON.stringify({ released: releasedIds.length, errors: errors.length, releasedIds }));
          } else {
            console.log(`✅ Released ${releasedIds.length} claim(s) for agent ${agentId}`);
            if (errors.length > 0) {
              console.log(`⚠️  ${errors.length} error(s):`);
              for (const e of errors) console.log(`   ${e}`);
            }
          }
          return;
        }

        console.error("Please specify --claim <claimId> or --all --agent <agent>.");
        console.error("Run 'syncpoint release --help' for usage.");
        process.exitCode = 1;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1;
      }
    });

}

