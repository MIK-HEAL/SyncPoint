/**
 * CLI: project memory commands — long-lived project knowledge management.
 * Delegates to application/project-memory-service for path-guarded use cases.
 */

import { Command } from "commander";
import {
  pmAdd, pmGet, pmUpdate, pmApprove, pmDeprecate,
  pmList, pmSearch, pmExport, pmSupersede, pmGetVersion,
} from "syncpoint-server/application";

function catchPm(err: unknown): void {
  if (err instanceof Error && (err.name === "ProjectMemoryPathError" || err.name === "CallerIdentityError" || err.name === "DuplicateMemoryError" || err.name === "InvalidProjectionError")) {
    console.error(`⚠ ${err.message}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}

export function registerProjectMemoryCommands(program: Command): void {
  program
    .command("knowledge")
    .description("Manage project knowledge (Project Memory Layer)")
    .addCommand(
      new Command("add")
        .description("Add a project memory note (status: draft)")
        .requiredOption("--category <category>", "Category: overview|architecture|decision|convention|risk|gotcha|glossary|file-map|integration")
        .requiredOption("--title <title>", "Memory title")
        .requiredOption("--content <content>", "Memory content")
        .option("--scope <scope>", "Scope: project|domain|task|file", "project")
        .option("--tags <tags>", "Comma-separated tags", "")
        .option("--source <type>", "Source type: human|agent|checkpoint|handoff|doc", "human")
        .option("--source-ref <ref>", "Source reference", "")
        .option("--confidence <level>", "Confidence: low|medium|high", "medium")
        .option("--task <taskId>", "Task ID (for task-scoped memories)")
        .requiredOption("--by <who>", "Created by (agent name or human)")
        .option("--global", "Allow writing to fallback (~/.syncpoint) location")
        .action(async (opts) => {
          try {
            const mem = pmAdd({
              category: opts.category,
              title: opts.title,
              content: opts.content,
              scope: opts.scope,
              tags: opts.tags,
              sourceType: opts.source,
              sourceRef: opts.sourceRef ?? "",
              confidence: opts.confidence,
              taskId: opts.task ?? null,
              createdBy: opts.by,
              global: opts.global,
            });
            console.log(JSON.stringify(mem, null, 2));
          } catch (err: unknown) { catchPm(err); }
        })
    )
    .addCommand(
      new Command("approve")
        .description("Approve a draft project memory (makes it available to agents)")
        .argument("<id>", "Memory ID")
        .requiredOption("--by <who>", "Approved by")
        .action(async (id, opts) => {
          try {
          const mem = pmApprove(id, opts.by);
          console.log(JSON.stringify(mem, null, 2));
          } catch (err: unknown) { catchPm(err); }
        })
    )
    .addCommand(
      new Command("deprecate")
        .description("Deprecate a project memory (removes from active context)")
        .argument("<id>", "Memory ID")
        .requiredOption("--by <who>", "Deprecated by")
        .action(async (id, opts) => {
          try {
          const mem = pmDeprecate(id, opts.by);
          console.log(JSON.stringify(mem, null, 2));
          } catch (err: unknown) { catchPm(err); }
        })
    )
    .addCommand(
      new Command("update")
        .description("Update a project memory")
        .argument("<id>", "Memory ID")
        .option("--title <title>", "New title")
        .option("--content <content>", "New content")
        .option("--tags <tags>", "New tags")
        .option("--confidence <level>", "New confidence")
        .requiredOption("--by <who>", "Updated by")
        .action(async (id, opts) => {
          try {
          const mem = pmUpdate(id, {
            title: opts.title,
            content: opts.content,
            tags: opts.tags,
            confidence: opts.confidence,
            updatedBy: opts.by,
          });
          console.log(JSON.stringify(mem, null, 2));
          } catch (err: unknown) { catchPm(err); }
        })
    )
    .addCommand(
      new Command("list")
        .description("List project memories")
        .option("--status <status>", "Filter: draft|approved|deprecated")
        .option("--category <category>", "Filter by category")
        .option("--scope <scope>", "Filter by scope")
        .option("--task <taskId>", "Filter by task ID")
        .action(async (opts) => {
          const mems = pmList({
            status: opts.status,
            category: opts.category,
            scope: opts.scope,
            taskId: opts.task,
          });
          if (mems.length === 0) {
            console.log("No project memories found.");
            return;
          }
          console.table(mems.map((m: any) => ({
            id: m.id,
            status: m.status,
            category: m.category,
            title: m.title,
            scope: m.scope,
            confidence: m.confidence,
          })));
        })
    )
    .addCommand(
      new Command("show")
        .description("Show a project memory by ID")
        .argument("<id>", "Memory ID")
        .action(async (id) => {
          const mem = pmGet(id);
          console.log(JSON.stringify(mem, null, 2));
        })
    )
    .addCommand(
      new Command("search")
        .description("Search approved project memories")
        .argument("<query>", "Search query")
        .action(async (query) => {
          const mems = pmSearch(query);
          if (mems.length === 0) {
            console.log("No matching project memories found.");
            return;
          }
          console.table(mems.map((m: any) => ({
            id: m.id,
            category: m.category,
            title: m.title,
            content: m.content.slice(0, 80),
          })));
        })
    )
    .addCommand(
      new Command("export")
        .description("Export approved project memories to .syncpoint/project-memory.md")
        .option("--output <path>", "Custom output path (also: SYNCPOINT_MEMORY_PATH env)")
        .requiredOption("--by <who>", "Caller identity")
        .action(async (opts) => {
          try {
          const result = pmExport(opts.output, opts.by);
          console.log(`Exported ${result.count} approved memories to ${result.path}`);
          } catch (err: unknown) { catchPm(err); }
        })
    )
    .addCommand(
      new Command("supersede")
        .description("Mark a new memory as replacing an old one (old is deprecated)")
        .requiredOption("--new <newId>", "New memory ID")
        .requiredOption("--old <oldId>", "Old memory ID to supersede")
        .requiredOption("--by <who>", "Updated by")
        .action(async (opts) => {
          try {
          const { newMem, oldMem } = pmSupersede(opts.new, opts.old, opts.by);
          console.log(`Superseded: ${oldMem.id} (deprecated) -> ${newMem.id}`);
          } catch (err: unknown) { catchPm(err); }
        })
    )
    .addCommand(
      new Command("version")
        .description("Show the current approved memory set version")
        .action(async () => {
          console.log(`Memory version: ${pmGetVersion()}`);
        })
    );
}
