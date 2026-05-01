/**
 * P4D — CLI commands for Constraint Runtime visibility.
 * Read-only: queries the runtime decision without changing state.
 */

import { Command, Option } from "commander";
import { constraintCheck } from "syncpoint-server/application";

export const constraintCmd = new Command("constraint")
  .description("Constraint Runtime visibility (P4D)");

constraintCmd
  .command("check")
  .description("Query the Constraint Runtime to check if an action is permitted")
  .addOption(
    new Option("--action <action>", "Action to evaluate")
      .choices(["resume", "start_assignment", "wake_start", "patch_submit", "patch_apply"])
      .makeOptionMandatory()
  )
  .option("--task <id>", "Task ID")
  .option("--agent <id>", "Agent ID")
  .option("--session <id>", "Session ID")
  .option("--assignment <id>", "Assignment ID")
  .option("--wake <id>", "Wake request ID")
  .option("--patch <id>", "Patch proposal ID")
  .option("--files <paths>", "Comma-separated touched files (debug/preview override)")
  .option("--json", "JSON output")
  .action((opts) => {
    try {
      const touchedFiles = opts.files
        ? opts.files.split(",").map((f: string) => f.trim()).filter(Boolean)
        : undefined;

      const result = constraintCheck({
        action: opts.action,
        taskId: opts.task,
        agentId: opts.agent,
        sessionId: opts.session,
        assignmentId: opts.assignment,
        wakeRequestId: opts.wake,
        patchId: opts.patch,
        touchedFiles,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Human-readable output
      console.log(`Constraint Runtime: ${result.permitted ? "PERMITTED" : "BLOCKED"}`);
      console.log(`Action: ${result.action}`);
      console.log(`Projection: ${result.projection.projectionId || "(unavailable)"}`);
      console.log(`Validity: ${result.projection.validity}`);

      if (result.runtimeUnavailable) {
        console.log(`\nRuntime Unavailable: ${result.runtimeUnavailable.message}`);
      }

      if (result.blockers.length > 0) {
        console.log("\nBlockers:");
        for (const b of result.blockers) {
          console.log(`- ${b.rule}`);
          if (b.sourceMemoryId) console.log(`  Source: ${b.sourceMemoryId}`);
          console.log(`  Message: ${b.message}`);
          if (b.evidence?.length) console.log(`  Evidence: ${b.evidence.join(", ")}`);
        }
      }

      if (result.warnings.length > 0) {
        console.log("\nWarnings:");
        for (const w of result.warnings) {
          console.log(`- ${w.rule}`);
          if (w.sourceMemoryId) console.log(`  Source: ${w.sourceMemoryId}`);
          console.log(`  Message: ${w.message}`);
        }
      }

      if (result.blockers.length === 0 && result.warnings.length === 0 && !result.runtimeUnavailable) {
        console.log("\nNo blockers or warnings.");
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });
