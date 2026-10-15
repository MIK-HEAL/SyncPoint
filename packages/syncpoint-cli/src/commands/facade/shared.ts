import { ResourceNotFoundError } from "syncpoint-kernel";
import {
  buildSnapshot,
} from "syncpoint-server/application";
import { formatStatusOutput } from "../formatter.js";
import type { Snapshot } from "../formatter.js";
import { resolveAgent } from "../connect.js";

export interface StatusOptions {
  session?: string;
  agent?: string;
  json?: boolean;
  watch?: boolean;
  interval?: string;
  events?: string;
  clear?: boolean;
}

export function requireAgentId(nameOrId: string): string {
  const agent = resolveAgent(nameOrId);
  if (!agent) throw new ResourceNotFoundError(nameOrId);
  return agent.id;
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildStatusSnapshot(opts: StatusOptions): Snapshot {
  const agentId = opts.agent ? requireAgentId(opts.agent) : undefined;
  return buildSnapshot({
    sessionId: opts.session,
    agentId,
    eventsLimit: parsePositiveInt(opts.events, 5),
  }) as Snapshot;
}

export function renderStatus(opts: StatusOptions): void {
  const snapshot = buildStatusSnapshot(opts);
  if (opts.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  if (opts.clear !== false) process.stdout.write("\x1B[2J\x1B[0f");
  console.log(formatStatusOutput(snapshot));
}

export function watchStatus(opts: StatusOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const render = () => {
      try {
        renderStatus(opts);
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    };
    const timer = setInterval(render, parsePositiveInt(opts.interval, 1000));
    process.once("SIGINT", () => {
      clearInterval(timer);
      resolve();
    });
    render();
  });
}
