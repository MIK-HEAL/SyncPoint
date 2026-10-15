import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { ResourceNotFoundError, ValidationError } from "syncpoint-kernel";
import type { AgentManifestFileFormat, UserAgentProvider } from "syncpoint-adapters";
import type { AgentDeclarationValidationRecord, DeclaredAgentRecord } from "syncpoint-server/application";
import { resolveAgent } from "../connect.js";
export function printDeclaredAgents(records: DeclaredAgentRecord[]): void {
  if (!records.length) {
    console.log("No declared agents found.");
    return;
  }

  console.table(records.map(record => ({
    name: record.name ?? "",
    profile: record.profile ?? "",
    provider: record.provider ?? "",
    role: record.role ?? "",
    status: record.status,
    format: record.sourceFormat ?? "",
    capabilities: record.manifest?.capabilities?.map(c => c.domain).join(", ") ?? "",
    tags: record.manifest?.tags?.join(", ") ?? "",
    availability: record.availability,
    lastSync: record.lastSyncAt,
    agentId: record.agentId ?? "",
    manifestPath: record.manifestPath,
    error: record.errorMessage,
  })));
}

export function printManifestWrites(
  writes: Array<{
    manifestPath: string;
    filePath: string;
    format: string;
    written: boolean;
  }>,
  title: string,
): void {
  console.log(title);
  console.table(writes.map(write => ({
    manifestPath: write.manifestPath,
    format: write.format,
    written: write.written,
    filePath: write.filePath,
  })));
}

export function printAgentCardSummary(cards: Array<{
  agentId: string | null;
  manifestPath: string | null;
  status: string;
  card: {
    name: string;
    role: string;
    provider: string;
  };
}>): void {
  console.table(cards.map(entry => ({
    agentId: entry.agentId ?? "",
    manifestPath: entry.manifestPath ?? "",
    status: entry.status,
    name: entry.card.name,
    role: entry.card.role,
    provider: entry.card.provider,
  })));
}

export function printValidationResults(records: AgentDeclarationValidationRecord[], sourceLabel: string): void {
  console.log(`Validated declarations from ${sourceLabel}`);
  console.table(records.map(record => ({
    filePath: record.filePath ?? "<inline>",
    format: record.format,
    kind: record.kind,
    valid: record.valid,
    name: record.name ?? "",
    members: record.memberCount ?? "",
    error: record.errorMessage,
  })));
}

export function resolveAgentId(value: string): string {
  const agent = resolveAgent(value);
  if (!agent) {
    throw new ResourceNotFoundError(value);
  }
  return agent.id;
}

export function parseStringArrayOption(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item: unknown): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export interface AgentInitAnswers {
  name: string;
  profile: string;
  provider: UserAgentProvider;
  role: string | undefined;
  tags: string;
  capabilities: string;
  notes: string;
  format: AgentManifestFileFormat;
  sync: boolean;
  force: boolean | undefined;
  json: boolean | undefined;
}

export async function promptAgentInitAnswers(opts: AgentInitAnswers): Promise<AgentInitAnswers> {
  if (opts.name) return opts;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("Agent manifest interactive setup");
    console.log("Press Enter to accept defaults.\n");

    const name = await rl.question("Agent name (required): ");
    if (!name.trim()) {
      throw new ValidationError("name", "Agent name is required.");
    }

    const profile = (await rl.question(`Profile [general]: `)).trim() || "general";
    const provider = (await rl.question(`Provider [auto_detect]: `)).trim() || "auto_detect";
    const role = (await rl.question("Role (leave empty to infer from profile): ")).trim() || undefined;
    const notes = (await rl.question("Notes: ")).trim();

    return {
      ...opts,
      name: name.trim(),
      profile,
      provider: provider as UserAgentProvider,
      role,
      notes,
    };
  } finally {
    rl.close();
  }
}

export function writeJsonFile(targetPath: string, value: unknown): string {
  const absolutePath = path.resolve(targetPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return absolutePath;
}
