import { Command } from "commander";
import { renderStatus, watchStatus } from "./shared.js";
import type { StatusOptions } from "./shared.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show current synchronization state — who is blocked, why, and what to do")
    .option("--session <sessionId>", "Scope to a specific session")
    .option("--agent <nameOrId>", "Agent name or ID for agent-specific gate actions")
    .option("-w, --watch", "Refresh status until Ctrl+C", false)
    .option("--interval <ms>", "Refresh interval for --watch", "1000")
    .option("--events <n>", "Number of recent events to show", "5")
    .option("--no-clear", "Do not clear the terminal between refreshes")
    .option("--json", "Machine-readable JSON output")
    .action(async (opts: StatusOptions) => {
      if (opts.watch) {
        await watchStatus(opts);
        return;
      }
      renderStatus({ ...opts, clear: false });
    });
}
