import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { Command, Option } from "commander";
import {
  AGENT_PROVIDER_VALUES,
  AGENT_ROLE_VALUES,
  USER_AGENT_PROVIDER_VALUES,
} from "syncpoint-core";
import type { AgentManifestFileFormat, UserAgentProvider } from "syncpoint-core";
import {
  diagnoseAgentRegistry,
  exportAgentCards,
  importAgentDeclarations,
  initAgentManifest,
  listDeclaredAgents,
  migrateRuntimeAgentsToDeclaredManifests,
  syncDeclaredAgents,
  validateAgentDeclarations,
} from "syncpoint-server/application";
import type {
  AgentDeclarationValidationRecord,
  DeclaredAgentRecord,
} from "syncpoint-server/application";
import * as repo from "syncpoint-server/repositories";
import { resolveAgent } from "./connect.js";

export function registerAgentCommands(program: Command): void {
  program
    .command("agent")
    .description("Manage declared and runtime agents — creating a manifest file registers the agent")
    .addCommand(
      new Command("init")
        .description("Interactively generate a single agent manifest file (creating a file registers the agent)")
        .option("--name <name>", "Agent name (prompts if omitted)")
        .addOption(new Option("--profile <profile>", "Agent profile (e.g. executor, reviewer, manager)").default("general"))
        .addOption(new Option("--provider <provider>", "AI provider").choices([...USER_AGENT_PROVIDER_VALUES]).default("auto_detect"))
        .option("--role <role>", "Explicit role override")
        .option("--tags <json>", "Tags (JSON array)", "[]")
        .option("--capabilities <json>", "Capability domains (JSON array)", "[]")
        .option("--notes <notes>", "Freeform notes", "")
        .addOption(new Option("--format <format>", "Manifest format").choices(["yaml", "json"]).default("yaml"))
        .option("--no-sync", "Skip syncing the manifest into runtime state")
        .option("--force", "Overwrite existing manifest file")
        .option("--json", "Output JSON")
        .action(async (opts) => {
          const answers = await promptAgentInitAnswers(opts);
          const tags = parseStringArrayOption(answers.tags);
          const capabilities = parseStringArrayOption(answers.capabilities);
          const result = initAgentManifest({
            name: answers.name,
            profile: answers.profile,
            provider: answers.provider,
            role: answers.role,
            tags,
            capabilities,
            notes: answers.notes,
            format: answers.format,
            sync: answers.sync,
            force: answers.force === true,
          });
          if (answers.json) {
            console.log(JSON.stringify({ write: result.write, manifest: result.manifest }, null, 2));
            return;
          }
          console.log(`Created manifest: ${result.write.filePath}`);
          console.log(`  Name:      ${result.manifest.name}`);
          console.log(`  Profile:   ${result.manifest.profile}`);
          console.log(`  Provider:  ${result.manifest.provider}`);
          console.log(`  Role:      ${result.manifest.role}`);
          if (result.manifest.tags.length) console.log(`  Tags:      ${result.manifest.tags.join(", ")}`);
          console.log(`\nEdit the file to customize, then run \`syncpoint agent sync\` to refresh.`);
        })
    )
    .addCommand(
      new Command("add")
        .description("Register a new runtime agent")
        .requiredOption("--name <name>", "Agent name")
        .addOption(new Option("--provider <provider>", "Provider").choices([...AGENT_PROVIDER_VALUES]).makeOptionMandatory())
        .addOption(new Option("--role <role>", "Role").choices([...AGENT_ROLE_VALUES]).makeOptionMandatory())
        .action((opts) => {
          const agent = repo.createAgent({ name: opts.name, provider: opts.provider, role: opts.role });
          console.log(JSON.stringify(agent, null, 2));
        })
    )
    .addCommand(
      new Command("list")
        .description("List declared agents with manifest source, status, capabilities, and sync time")
        .option("--runtime", "List runtime agent rows instead of declared manifest agents")
        .option("--no-sync", "Skip syncing manifest files before listing declared agents")
        .option("--removed", "Include removed manifest entries")
        .option("--json", "Output JSON")
        .action((opts) => {
          if (opts.runtime) {
            const agents = repo.listAgents();
            if (opts.json) {
              console.log(JSON.stringify(agents, null, 2));
              return;
            }
            console.table(agents);
            return;
          }

          if (opts.sync !== false) syncDeclaredAgents();
          const declaredAgents = listDeclaredAgents({ includeRemoved: opts.removed === true });
          if (opts.json) {
            console.log(JSON.stringify(declaredAgents, null, 2));
            return;
          }
          printDeclaredAgents(declaredAgents);
        })
    )
    .addCommand(
      new Command("import")
        .description("Import agent manifests or team templates into the registry")
        .argument("<source>", "File or directory containing YAML/JSON declarations")
        .addOption(new Option("--provider <provider>", "Default provider for imported team templates").choices([...USER_AGENT_PROVIDER_VALUES]))
        .addOption(new Option("--format <format>", "Target manifest format").choices(["yaml", "json"]))
        .option("--prefix <prefix>", "Name prefix for imported team members")
        .option("--no-sync", "Skip syncing imported declarations into runtime state")
        .option("--force", "Overwrite preferred target paths where possible")
        .option("--json", "Output JSON")
        .action((source, opts) => {
          const result = importAgentDeclarations({
            sourcePath: source,
            defaultProvider: opts.provider,
            format: opts.format,
            namePrefix: opts.prefix,
            sync: opts.sync,
            force: opts.force === true,
          });
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          printManifestWrites(result.writes, "Imported declarations");
        })
    )
    .addCommand(
      new Command("validate")
        .description("Validate agent manifest or team template files against the shared schema")
        .argument("<source>", "File or directory containing YAML/JSON declarations")
        .addOption(new Option("--format <format>", "Document format for inline validation").choices(["yaml", "json"]))
        .option("--json", "Output JSON")
        .action((source, opts) => {
          const result = validateAgentDeclarations({
            sourcePath: source,
            format: opts.format,
          });
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          printValidationResults(result.results, result.sourcePath ?? source);
        })
    )
    .addCommand(
      new Command("sync")
        .description("Manually rescan declared agent manifest files")
        .option("--removed", "Include removed manifest entries")
        .option("--json", "Output JSON")
        .action((opts) => {
          const records = syncDeclaredAgents()
            .filter(record => opts.removed === true || record.status !== "removed");
          if (opts.json) {
            console.log(JSON.stringify(records, null, 2));
            return;
          }
          printDeclaredAgents(records);
        })
    )
    .addCommand(
      new Command("diagnose")
        .description("Diagnose agent registry issues and suggest fixes")
        .option("--no-sync", "Skip syncing before diagnosis")
        .option("--json", "Output JSON")
        .action((opts) => {
          const result = diagnoseAgentRegistry({ sync: opts.sync });
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          console.log(`Agent Registry Diagnosis`);
          console.log(`  Total:   ${result.total}`);
          console.log(`  Healthy: ${result.healthy}`);
          console.log(`  Errors:  ${result.errors}`);
          console.log(`  Removed: ${result.removed}`);
          if (result.entries.length) {
            const problemEntries = result.entries.filter((e: { availability: string }) => e.availability !== "running" && e.availability !== "available");
            if (problemEntries.length) {
              console.log(`\nIssues:`);
              for (const entry of problemEntries) {
                console.log(`  ${entry.manifestPath}: ${entry.availability}`);
                if (entry.errorMessage) console.log(`    Error: ${entry.errorMessage}`);
                for (const fix of entry.fixSuggestions) {
                  console.log(`    Fix:   ${fix}`);
                }
              }
            } else {
              console.log(`\nAll agents healthy.`);
            }
          } else {
            console.log(`\nNo agents registered. Run \`syncpoint init\` to get started.`);
          }
        })
    )
    .addCommand(
      new Command("migrate")
        .description("Migrate runtime agents into declared manifest files")
        .option("--agent <nameOrId>", "Only migrate one runtime agent")
        .addOption(new Option("--format <format>", "Target manifest format").choices(["yaml", "json"]))
        .option("--no-sync", "Skip syncing migrated declarations into runtime state")
        .option("--force", "Rewrite existing declaration files")
        .option("--json", "Output JSON")
        .action((opts) => {
          const agentIds = opts.agent ? [resolveAgentId(opts.agent)] : undefined;
          const result = migrateRuntimeAgentsToDeclaredManifests({
            agentIds,
            format: opts.format,
            sync: opts.sync,
            force: opts.force === true,
          });
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          console.table(result.items.map((item: {
            agentId: string;
            agentName: string;
            manifestPath: string;
            format: string;
            written: boolean;
            skipped: boolean;
          }) => ({
            agentId: item.agentId,
            agentName: item.agentName,
            manifestPath: item.manifestPath,
            format: item.format,
            written: item.written,
            skipped: item.skipped,
          })));
        })
    )
    .addCommand(
      new Command("card")
        .description("Export A2A-style agent cards")
        .argument("[agents...]", "Agent names or IDs")
        .option("--all", "Export cards for all declared agents")
        .option("--removed", "Include removed declarations")
        .option("--no-sync", "Skip syncing declarations before export")
        .option("--output <path>", "Write card JSON to a file")
        .option("--json", "Output JSON to stdout")
        .action((agents: string[], opts) => {
          if (!opts.all && (!agents || agents.length === 0)) {
            throw new Error("Use --all or provide at least one agent name/ID.");
          }
          const agentIds = opts.all ? undefined : agents.map(resolveAgentId);
          const result = exportAgentCards({
            agentIds,
            includeRemoved: opts.removed === true,
            sync: opts.sync,
          });
          const payload = opts.all || result.cards.length !== 1
            ? result.cards.map((entry: { card: unknown }) => entry.card)
            : result.cards[0]?.card ?? null;

          if (opts.output) {
            const outputPath = writeJsonFile(opts.output, payload);
            if (!opts.json) {
              console.log(`Wrote ${result.cards.length} agent card(s) to ${outputPath}`);
            }
          }

          if (opts.json || !opts.output) {
            console.log(JSON.stringify(payload, null, 2));
            return;
          }

          printAgentCardSummary(result.cards);
        })
    );
}

function printDeclaredAgents(records: DeclaredAgentRecord[]): void {
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

function printManifestWrites(
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

function printAgentCardSummary(cards: Array<{
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

function printValidationResults(records: AgentDeclarationValidationRecord[], sourceLabel: string): void {
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

function resolveAgentId(value: string): string {
  const agent = resolveAgent(value);
  if (!agent) {
    throw new Error(`Agent not found: ${value}`);
  }
  return agent.id;
}

function parseStringArrayOption(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item: unknown): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

interface AgentInitAnswers {
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

async function promptAgentInitAnswers(opts: AgentInitAnswers): Promise<AgentInitAnswers> {
  if (opts.name) return opts;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("Agent manifest interactive setup");
    console.log("Press Enter to accept defaults.\n");

    const name = await rl.question("Agent name (required): ");
    if (!name.trim()) {
      throw new Error("Agent name is required.");
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

function writeJsonFile(targetPath: string, value: unknown): string {
  const absolutePath = path.resolve(targetPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return absolutePath;
}
