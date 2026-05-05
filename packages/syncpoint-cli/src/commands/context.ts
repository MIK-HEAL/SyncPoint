/**
 * CLI: context-related primitive commands (capsule, status, resume-context, resume-prompt, prompt-file, memory).
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as repo from "syncpoint-server/repositories";
import { formatResumePrompt, ContextIntent, ContextRole } from "syncpoint-core";
import type { PromptFormat } from "syncpoint-core";
import { prepareContext, enforcePreparedContext, getContextPolicyInfo } from "syncpoint-server/application";

export function registerContextCommands(program: Command): void {
  // ── Context Prepare (Role-aware Context Policy) ─────────

  program
    .command("context")
    .description("Role-aware context preparation")
    .addCommand(
      new Command("prepare")
        .description("Prepare context for a given intent and role")
        .requiredOption("--intent <intent>", `Intent: ${ContextIntent.options.join("|")}` )
        .requiredOption("--role <role>", `Role: ${ContextRole.options.join("|")}`)
        .option("--task <taskId>", "Task ID")
        .option("--agent <agentId>", "Agent ID")
        .option("--format <format>", "Output format: json|markdown|prompt", "prompt")
        .option("--strict", "Hard-fail on missing required sections (exit 2)")
        .option("--json", "Output full PreparedContext as JSON")
        .action(async (opts) => {
          const intent = ContextIntent.parse(opts.intent);
          const role = ContextRole.parse(opts.role);
          const prepared = prepareContext({ intent, role, taskId: opts.task, agentId: opts.agent });

          if (opts.json || opts.format === "json") {
            console.log(JSON.stringify(prepared, null, 2));
          } else if (opts.format === "markdown" || opts.format === "prompt") {
            if (prepared.warnings.length > 0) {
              for (const w of prepared.warnings) console.error(`⚠ ${w}`);
              console.error("");
            }
            console.log(prepared.prompt);
          }

          if (opts.strict && !prepared.ready && prepared.gateMode === "hard") {
            process.exitCode = 2;
          }
        })
    )
    .addCommand(
      new Command("policy")
        .description("Show all available context policies")
        .option("--json", "Output as JSON")
        .action(async (opts) => {
          const info = getContextPolicyInfo();
          if (opts.json) {
            console.log(JSON.stringify(info, null, 2));
          } else {
            console.log("Intents:", info.intents.join(", "));
            console.log("Roles:", info.roles.join(", "));
            console.log("");
            for (const p of info.policies) {
              const gate = p.gateMode.toUpperCase();
              console.log(`  ${p.intent} [${gate}]: ${p.description}`);
              if (p.requiredSections.length) console.log(`    required: ${p.requiredSections.join(", ")}`);
              if (p.includeSections.length) console.log(`    includes: ${p.includeSections.join(", ")}`);
            }
          }
        })
    );

  // ── Context Capsule ───────────────────────────────────

  program
    .command("capsule")
    .description("Manage task context capsules")
    .addCommand(
      new Command("create")
        .description("Create a task context capsule")
        .requiredOption("--task <taskId>", "Task ID")
        .requiredOption("--agent <agentId>", "Agent ID")
        .requiredOption("--checkpoint <checkpointId>", "Checkpoint ID")
        .option("--goal <goal>", "Task goal", "")
        .option("--phase <phase>", "Current phase", "")
        .option("--decisions <json>", "Confirmed decisions (JSON)", "")
        .option("--interface <json>", "Interface contract (JSON)", "")
        .option("--working-resources <json>", "Working resources (JSON)", "")
        .option("--completed <text>", "Completed work", "")
        .option("--remaining <text>", "Remaining work", "")
        .option("--risks <text>", "Risks", "")
        .option("--blockers <text>", "Blockers", "")
        .option("--next-steps <text>", "Next steps", "")
        .option("--resume-prompt <text>", "Resume prompt", "")
        .action(async (opts) => {
          const capsule = repo.createCapsule({
            taskId: opts.task,
            agentId: opts.agent,
            checkpointId: opts.checkpoint,
            goal: opts.goal,
            currentPhase: opts.phase,
            confirmedDecisions: opts.decisions,
            interfaceContract: opts.interface,
            workingResources: opts.workingResources,
            completedWork: opts.completed,
            remainingWork: opts.remaining,
            risks: opts.risks,
            blockers: opts.blockers,
            nextSteps: opts.nextSteps,
            resumePrompt: opts.resumePrompt,
          });
          console.log(JSON.stringify(capsule, null, 2));
        })
    )
    .addCommand(
      new Command("latest")
        .description("Show latest context capsule for a task and agent")
        .requiredOption("--task <taskId>", "Task ID")
        .requiredOption("--agent <agentId>", "Agent ID")
        .action(async (opts) => {
          const capsule = repo.getLatestCapsule(opts.task, opts.agent);
          if (!capsule) {
            console.log("No context capsule found");
            return;
          }
          console.log(JSON.stringify(capsule, null, 2));
        })
    )
    .addCommand(
      new Command("list")
        .description("List context capsules for a task")
        .requiredOption("--task <taskId>", "Task ID")
        .action(async (opts) => {
          const capsules = repo.listCapsules(opts.task);
          console.table(capsules);
        })
    );

  // ── Resume Context (Memory Switch Engine) ─────────────

  program
    .command("resume-context")
    .description("Get structured resume context for a task+agent (Memory Switch Engine)")
    .requiredOption("--task <taskId>", "Task ID")
    .requiredOption("--agent <agentId>", "Agent ID")
    .action(async (opts) => {
      const ctx = repo.getResumeContext(opts.task, opts.agent);
      ctx.projectMemories = []; // P3B: no raw PM in resume output
      ctx.resumePrompt = ""; // P3B: pre-built prompt contains baked-in raw PM
      console.log(JSON.stringify(ctx, null, 2));
    });

  program
    .command("resume-prompt")
    .description("Get text resume prompt for a task+agent")
    .requiredOption("--task <taskId>", "Task ID")
    .requiredOption("--agent <agentId>", "Agent ID")
    .option("--format <format>", "Output format: system-prompt|cursorrules|agents-md|checkpoint-md|clipboard", "system-prompt")
    .action(async (opts) => {
      const ctx = repo.getResumeContext(opts.task, opts.agent);
      ctx.projectMemories = []; // P3B: no raw PM in prompt output
      if (!ctx.ready) {
        console.error("⚠ Context not ready:");
        for (const w of ctx.warnings) console.error(`  - ${w}`);
        console.error("");
      }
      console.log(formatResumePrompt(ctx, opts.format as PromptFormat));
    });

  program
    .command("prompt-file")
    .description("Write resume prompt to a file for editor consumption")
    .requiredOption("--task <taskId>", "Task ID")
    .requiredOption("--agent <agentId>", "Agent ID")
    .option("--format <format>", "Output format: system-prompt|cursorrules|agents-md|checkpoint-md|clipboard", "cursorrules")
    .option("--output <path>", "Output file path")
    .action(async (opts) => {
      const ctx = repo.getResumeContext(opts.task, opts.agent);
      ctx.projectMemories = []; // P3B: no raw PM in prompt output
      const content = formatResumePrompt(ctx, opts.format as PromptFormat);
      let outPath = opts.output as string | undefined;
      if (!outPath) {
        const formatFileMap: Record<string, string> = {
          "system-prompt": ".syncpoint/resume-prompt.md",
          "cursorrules": ".cursorrules",
          "agents-md": "AGENTS.md",
          "checkpoint-md": ".syncpoint/checkpoint.md",
          "clipboard": ".syncpoint/resume-prompt.txt",
        };
        outPath = formatFileMap[opts.format] ?? ".syncpoint/resume-prompt.md";
      }
      const dir = path.dirname(outPath);
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outPath, content, "utf-8");
      if (!ctx.ready) {
        console.error("⚠ Context not ready:");
        for (const w of ctx.warnings) console.error(`  - ${w}`);
      }
      console.log(`Written to ${outPath}`);
    });

  // ── Pinned Memory ─────────────────────────────────────

  program
    .command("memory")
    .description("Manage pinned memories")
    .addCommand(
      new Command("set")
        .description("Create or update a pinned memory")
        .requiredOption("--key <key>", "Memory key (unique identifier)")
        .requiredOption("--content <content>", "Memory content")
        .option("--scope <scope>", "Scope: global|project|task", "project")
        .option("--task <taskId>", "Task ID (only for scope=task)")
        .action(async (opts) => {
          const existing = repo.getPinnedMemoryByKey(opts.key);
          if (existing) {
            const updated = repo.updatePinnedMemory(existing.id, opts.content);
            console.log(JSON.stringify(updated, null, 2));
          } else {
            const created = repo.createPinnedMemory({
              key: opts.key,
              content: opts.content,
              scope: opts.scope,
              taskId: opts.task ?? null,
            });
            console.log(JSON.stringify(created, null, 2));
          }
        })
    )
    .addCommand(
      new Command("list")
        .description("List pinned memories")
        .option("--scope <scope>", "Filter by scope")
        .option("--task <taskId>", "Filter by task ID")
        .action(async (opts) => {
          const memories = repo.listPinnedMemories(opts.scope, opts.task);
          console.table(memories.map(m => ({ key: m.key, scope: m.scope, content: m.content.slice(0, 80) })));
        })
    )
    .addCommand(
      new Command("delete")
        .description("Delete a pinned memory")
        .argument("<id>", "Memory ID")
        .action(async (id) => {
          repo.deletePinnedMemory(id);
          console.log("Deleted.");
        })
    );
}
