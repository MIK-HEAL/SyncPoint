import { Command } from "commander";
import { guardCreateSession, guardRevokeSession, guardStatus, guardValidateToken } from "syncpoint-server/application";
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

  program.addCommand(guard);
}

function print(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}
