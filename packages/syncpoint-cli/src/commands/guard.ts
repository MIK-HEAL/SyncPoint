import { Command } from "commander";
import { guardCreateSession, guardRevokeSession, guardStatus, guardValidateToken, reconcileBackingStore, unlockAllGuards, recoverGuardState } from "syncpoint-server/application";
import type { GuardMode, GuardProxyAdapter } from "syncpoint-server/application";
import { resolveAgent } from "./connect.js";

interface GuardSessionOptions {
  agent: string;
  task: string;
  session?: string;
  mode?: GuardMode;
  mount?: string;
  adapter?: GuardProxyAdapter;
  ttl?: number;
  json?: boolean;
}

interface GuardStatusOptions {
  json?: boolean;
}

export function registerGuardCommands(program: Command): void {
  const guard = new Command("guard")
    .description("Guarded workspace controls for editor/proxy file-write enforcement");

  guard
    .command("status")
    .description("Show guarded workspace status and active guard sessions")
    .option("--json", "Output JSON", false)
    .action((opts: GuardStatusOptions) => {
      print(guardStatus(), opts.json === true);
    });

  guard
    .command("session")
    .description("Create a local guard capability token for editor/proxy adapters")
    .requiredOption("--agent <nameOrId>", "Actor name or ID")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--session <sessionId>", "Session ID")
    .option("--mode <mode>", "observe|stage|strict|readonly", "strict")
    .option("--mount <path>", "Guarded mount path inside the project root")
    .option("--adapter <adapter>", "winfsp|fuse|macfuse|manual")
    .option("--ttl <seconds>", "Token TTL in seconds", parseInt)
    .option("--json", "Output JSON", false)
    .action((opts: GuardSessionOptions) => {
      const agent = resolveAgent(opts.agent);
      const result = guardCreateSession({
        actorId: agent?.id ?? opts.agent,
        taskId: opts.task,
        sessionId: opts.session,
        mode: opts.mode,
        mountPath: opts.mount,
        adapter: opts.adapter,
        ttlSeconds: opts.ttl,
      });
      print(result, opts.json === true);
    });

  guard
    .command("mount")
    .description("Create a guard session descriptor for a future WinFsp/FUSE mount")
    .argument("<mountPath>", "Guarded mount path inside the project root")
    .requiredOption("--agent <nameOrId>", "Actor name or ID")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--session <sessionId>", "Session ID")
    .option("--mode <mode>", "observe|stage|strict|readonly", "strict")
    .option("--adapter <adapter>", "winfsp|fuse|macfuse|manual")
    .option("--json", "Output JSON", false)
    .action((mountPath: string, opts: GuardSessionOptions) => {
      const agent = resolveAgent(opts.agent);
      const result = guardCreateSession({
        actorId: agent?.id ?? opts.agent,
        taskId: opts.task,
        sessionId: opts.session,
        mode: opts.mode,
        mountPath,
        adapter: opts.adapter,
      });
      print({ ...result, proxyAvailable: false }, opts.json === true);
    });

  guard
    .command("validate-token")
    .description("Validate a local guard capability token")
    .argument("<token>", "Guard token")
    .option("--json", "Output JSON", false)
    .action((token: string, opts: GuardStatusOptions) => {
      print(guardValidateToken(token), opts.json === true);
    });

  guard
    .command("revoke")
    .description("Revoke a guard session")
    .argument("<sessionId>", "Guard session ID")
    .option("--json", "Output JSON", false)
    .action((sessionId: string, opts: GuardStatusOptions) => {
      print(guardRevokeSession(sessionId), opts.json === true);
    });

  guard
    .command("unlock")
    .description("Emergency: unlock all guarded files and restore original permissions")
    .option("--all", "Unlock all guards across all project roots", false)
    .option("--root <path>", "Project root to recover guard state from")
    .option("--json", "Output JSON", false)
    .action((opts: { all?: boolean; root?: string; json?: boolean }) => {
      try {
        // First try to recover from persisted guard state (crash recovery)
        if (opts.root) {
          const recovery = recoverGuardState(opts.root);
          if (recovery.recovered.length > 0) {
            if (opts.json) {
              console.log(JSON.stringify({ source: "crash_recovery", ...recovery }));
              return;
            }
            console.log(`Crash recovery: restored ${recovery.recovered.length} file(s)`);
            if (recovery.errors.length > 0) console.error(`Errors: ${recovery.errors.join(", ")}`);
            return;
          }
        }

        // Then unlock all active guards
        if (opts.all) {
          const result = unlockAllGuards(opts.root);
          if (opts.json) {
            console.log(JSON.stringify(result));
            return;
          }
          console.log(`Unlocked ${result.unlocked.length} file(s)`);
          if (result.errors.length > 0) console.error(`Errors: ${result.errors.join(", ")}`);
          return;
        }

        console.error("Specify --all to unlock all guards, or --root <path> for crash recovery.");
        process.exitCode = 1;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1;
      }
    });

  guard
    .command("reconcile")
    .description("Scan claimed files for unauthorized direct writes to the backing store and raise blockers")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--session <sessionId>", "Session ID")
    .option("--json", "Output JSON", false)
    .action((opts: { task: string; session?: string; json?: boolean }) => {
      const result = reconcileBackingStore({ taskId: opts.task, sessionId: opts.session });
      if (opts.json) {
        print(result, true);
      } else {
        console.log(`Scanned: ${result.scannedFiles} claimed file(s)`);
        console.log(`Bypasses detected: ${result.bypassesDetected}`);
        if (result.gatesCreated.length > 0) console.log(`Gates created: ${result.gatesCreated.join(", ")}`);
        if (result.gatesReused.length > 0) console.log(`Gates updated: ${result.gatesReused.join(", ")}`);
        if (result.bypassesDetected === 0) console.log("No unauthorized backing store modifications detected.");
      }
    });

  program.addCommand(guard);
}

function print(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}
