import fs from "node:fs";
import { Command } from "commander";
import { WriteIntent } from "syncpoint-core";
import { writeApply, writeCheck, writePrepare } from "syncpoint-server/application";
import type { ResourceRef } from "syncpoint-core";
import { resolveAgent } from "./connect.js";

interface WriteOptions {
  agent?: string;
  task?: string;
  session?: string;
  type?: string;
  intent?: WriteIntent;
  operation?: string;
  json?: boolean;
}

interface ApplyOptions extends WriteOptions {
  permit?: string;
  content?: string;
  contentFile?: string;
  contentBase64?: string;
  delete?: boolean;
}

export function registerWriteCommands(program: Command): void {
  const write = new Command("write")
    .description("Controlled write API: check, prepare, and apply permit-backed file mutations");

  write
    .command("check")
    .description("Dry-run whether a write would be permitted")
    .argument("<locators...>", "Resource locators to write")
    .requiredOption("--agent <nameOrId>", "Actor name or ID")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--session <sessionId>", "Session ID")
    .option("--type <type>", "Resource type", "file")
    .option("--intent <intent>", "create|modify|delete|rename|bulk", WriteIntent.MODIFY)
    .option("--operation <operationId>", "Approved operation authorizing the write")
    .option("--json", "Output JSON", false)
    .action((locators: string[], opts: WriteOptions) => {
      const input = writeInput(locators, opts);
      const result = writeCheck(input);
      print(result, opts.json === true);
    });

  write
    .command("prepare")
    .description("Issue a short-lived write permit if the write is allowed")
    .argument("<locators...>", "Resource locators to write")
    .requiredOption("--agent <nameOrId>", "Actor name or ID")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--session <sessionId>", "Session ID")
    .option("--type <type>", "Resource type", "file")
    .option("--intent <intent>", "create|modify|delete|rename|bulk", WriteIntent.MODIFY)
    .option("--operation <operationId>", "Approved operation authorizing the write")
    .option("--ttl <seconds>", "Permit TTL in seconds", parseInt)
    .option("--json", "Output JSON", false)
    .action((locators: string[], opts: WriteOptions & { ttl?: number }) => {
      const input = { ...writeInput(locators, opts), ttlSeconds: opts.ttl };
      const result = writePrepare(input);
      print(result, opts.json === true);
    });

  write
    .command("apply")
    .description("Apply a permit-backed file mutation. If --permit is omitted, prepares a permit first.")
    .argument("<locator>", "File locator to write")
    .option("--permit <permitId>", "Existing write permit ID")
    .option("--agent <nameOrId>", "Actor name or ID, required when --permit is omitted")
    .option("--task <taskId>", "Task ID, required when --permit is omitted")
    .option("--session <sessionId>", "Session ID")
    .option("--operation <operationId>", "Approved operation authorizing the write")
    .option("--content <content>", "Text content to write")
    .option("--content-file <path>", "Read content from a local file")
    .option("--content-base64 <base64>", "Base64 content to write")
    .option("--delete", "Delete the target file", false)
    .option("--json", "Output JSON", false)
    .action((locator: string, opts: ApplyOptions) => {
      const resource = { type: "file", scope: "file" as const, locator, metadata: "" };
      const permitId = opts.permit ?? prepareForApply(resource, opts);
      const result = writeApply({
        permitId,
        mutations: [{
          resource,
          content: opts.contentFile ? fs.readFileSync(opts.contentFile, "utf8") : opts.content,
          contentBase64: opts.contentBase64,
          delete: opts.delete,
        }],
      });
      print(result, opts.json === true);
    });

  program.addCommand(write);
}

function writeInput(locators: string[], opts: WriteOptions) {
  const agent = opts.agent ? resolveAgent(opts.agent) : undefined;
  const actorId = agent?.id ?? opts.agent;
  if (!actorId) throw new Error("--agent is required");
  if (!opts.task) throw new Error("--task is required");
  return {
    actorId,
    taskId: opts.task,
    sessionId: opts.session,
    resources: locators.map(locator => ({ type: opts.type ?? "file", scope: "file" as const, locator, metadata: "" })),
    intent: opts.intent ?? WriteIntent.MODIFY,
    operationId: opts.operation,
  };
}

function prepareForApply(resource: ResourceRef, opts: ApplyOptions): string {
  if (!opts.agent) throw new Error("--agent is required when --permit is omitted");
  if (!opts.task) throw new Error("--task is required when --permit is omitted");
  const result = writePrepare({
    actorId: resolveAgent(opts.agent)?.id ?? opts.agent,
    taskId: opts.task,
    sessionId: opts.session,
    resources: [resource],
    intent: opts.delete ? WriteIntent.DELETE : WriteIntent.MODIFY,
    operationId: opts.operation,
  });
  if (!result.decision.permitted) {
    throw new Error(`Write denied: ${result.decision.blockers.map(blocker => blocker.message).join("; ")}`);
  }
  return result.permit.id;
}

function print(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}
