/**
 * CLI: entity CRUD commands (agent, task, checkpoint, report, handoff, contract).
 */

import { Command } from "commander";
import * as repo from "syncpoint-server/repositories";
import { TaskStatus, ContractStatus, DiaryEntryType } from "syncpoint-core";

export function registerPrimitiveCommands(program: Command): void {
  // ── Agent ──────────────────────────────────────────────

  program
    .command("agent")
    .description("Manage agents")
    .addCommand(
      new Command("add")
        .description("Register a new agent")
        .requiredOption("--name <name>", "Agent name")
        .requiredOption("--provider <provider>", "Provider: codex|claude-code|cursor|cline|copilot|human|other")
        .requiredOption("--role <role>", "Role: manager|frontend|backend|tester|reviewer|other")
        .action(async (opts) => {
          const agent = repo.createAgent({ name: opts.name, provider: opts.provider, role: opts.role });
          console.log(JSON.stringify(agent, null, 2));
        })
    )
    .addCommand(
      new Command("list")
        .description("List all agents")
        .action(() => {
          const agents = repo.listAgents();
          console.table(agents);
        })
    );

  // ── Task ───────────────────────────────────────────────

  program
    .command("task")
    .description("Manage tasks")
    .addCommand(
      new Command("create")
        .description("Create a new task")
        .argument("<title>", "Task title")
        .option("-d, --description <desc>", "Description", "")
        .action(async (title, opts) => {
          const task = repo.createTask({ title, description: opts.description });
          console.log(JSON.stringify(task, null, 2));
        })
    )
    .addCommand(
      new Command("assign")
        .description("Assign a task to an agent")
        .argument("<taskId>", "Task ID")
        .requiredOption("--agent <agentId>", "Agent ID")
        .action(async (taskId, opts) => {
          const task = repo.assignTask(taskId, opts.agent);
          console.log(JSON.stringify(task, null, 2));
        })
    )
    .addCommand(
      new Command("list")
        .description("List all tasks")
        .action(() => {
          const tasks = repo.listTasks();
          console.table(tasks);
        })
    )
    .addCommand(
      new Command("status")
        .description("Update task status")
        .argument("<taskId>", "Task ID")
        .argument("<status>", "New status")
        .action(async (taskId, status) => {
          const task = repo.updateTaskStatus(taskId, status as TaskStatus);
          console.log(JSON.stringify(task, null, 2));
        })
    );

  // ── Checkpoint ─────────────────────────────────────────

  program
    .command("checkpoint")
    .description("Manage checkpoints")
    .addCommand(
      new Command("create")
        .description("Create a checkpoint")
        .requiredOption("--task <taskId>", "Task ID")
        .requiredOption("--agent <agentId>", "Agent ID")
        .requiredOption("--summary <summary>", "Summary")
        .option("--progress <progress>", "Progress", "")
        .option("--understanding <understanding>", "Current understanding", "")
        .option("--changed-files <files>", "Changed files (JSON)", "")
        .option("--risks <risks>", "Risks", "")
        .option("--blockers <blockers>", "Blockers", "")
        .option("--next-steps <steps>", "Next steps", "")
        .option("--need-sync", "Flag for sync needed", false)
        .action(async (opts) => {
          const cp = repo.createCheckpoint({
            taskId: opts.task,
            agentId: opts.agent,
            summary: opts.summary,
            progress: opts.progress,
            currentUnderstanding: opts.understanding,
            changedFiles: opts.changedFiles,
            risks: opts.risks,
            blockers: opts.blockers,
            nextSteps: opts.nextSteps,
            needSync: opts.needSync,
          });
          console.log(JSON.stringify(cp, null, 2));
        })
    );

  // ── Report (diary) ─────────────────────────────────────

  program
    .command("report")
    .description("Write a diary entry / report")
    .requiredOption("--task <taskId>", "Task ID")
    .requiredOption("--agent <agentId>", "Agent ID")
    .requiredOption("--content <content>", "Report content")
    .option("--type <type>", "Entry type: NOTE|REPORT|DECISION|RISK", "REPORT")
    .action(async (opts) => {
      const entry = repo.createDiaryEntry({
        taskId: opts.task,
        agentId: opts.agent,
        content: opts.content,
        entryType: opts.type as DiaryEntryType,
      });
      console.log(JSON.stringify(entry, null, 2));
    });

  // ── Handoff ────────────────────────────────────────────

  program
    .command("handoff")
    .description("Manage handoffs")
    .addCommand(
      new Command("create")
        .description("Initiate a handoff")
        .requiredOption("--task <taskId>", "Task ID")
        .requiredOption("--from <fromAgentId>", "From agent ID")
        .requiredOption("--to <toAgentId>", "To agent ID")
        .requiredOption("--context <summary>", "Context summary")
        .action(async (opts) => {
          const h = repo.createHandoff({
            taskId: opts.task,
            fromAgentId: opts.from,
            toAgentId: opts.to,
            contextSummary: opts.context,
          });
          console.log(JSON.stringify(h, null, 2));
        })
    )
    .addCommand(
      new Command("accept")
        .description("Accept a handoff")
        .argument("<handoffId>", "Handoff ID")
        .action(async (handoffId) => {
          const h = repo.acceptHandoff(handoffId);
          console.log(JSON.stringify(h, null, 2));
        })
    )
    .addCommand(
      new Command("reject")
        .description("Reject a handoff")
        .argument("<handoffId>", "Handoff ID")
        .action(async (handoffId) => {
          const h = repo.rejectHandoff(handoffId);
          console.log(JSON.stringify(h, null, 2));
        })
    );

  // ── Contract ───────────────────────────────────────────

  program
    .command("contract")
    .description("Manage peer contracts")
    .addCommand(
      new Command("draft")
        .description("Draft a peer contract")
        .requiredOption("--task <taskId>", "Task ID")
        .option("--title <title>", "Contract title", "")
        .option("--participants <json>", "Participants (JSON array)", "")
        .option("--scope <scope>", "Scope", "")
        .option("--interface <json>", "Interface spec (JSON)", "")
        .option("--boundaries <json>", "File boundaries (JSON)", "")
        .action(async (opts) => {
          const c = repo.createContract({
            taskId: opts.task,
            title: opts.title,
            participants: opts.participants,
            scope: opts.scope,
            interfaceSpec: opts.interface,
            fileBoundaries: opts.boundaries,
            responsibilities: "",
            dependencies: "",
            testPlan: "",
            risks: "",
          });
          console.log(JSON.stringify(c, null, 2));
        })
    )
    .addCommand(
      new Command("show")
        .description("Show contract for a task")
        .argument("<taskId>", "Task ID")
        .action(async (taskId) => {
          const c = repo.getContractForTask(taskId);
          if (!c) { console.log("No contract found for task", taskId); return; }
          console.log(JSON.stringify(c, null, 2));
        })
    )
    .addCommand(
      new Command("approve")
        .description("Approve a contract")
        .argument("<contractId>", "Contract ID")
        .action(async (contractId) => {
          const c = repo.updateContractStatus(contractId, ContractStatus.APPROVED);
          console.log(JSON.stringify(c, null, 2));
        })
    )
    .addCommand(
      new Command("review")
        .description("Move a contract into review")
        .argument("<contractId>", "Contract ID")
        .action(async (contractId) => {
          const c = repo.updateContractStatus(contractId, ContractStatus.REVIEWING);
          console.log(JSON.stringify(c, null, 2));
        })
    )
    .addCommand(
      new Command("reject")
        .description("Reject a contract")
        .argument("<contractId>", "Contract ID")
        .action(async (contractId) => {
          const c = repo.updateContractStatus(contractId, ContractStatus.REJECTED);
          console.log(JSON.stringify(c, null, 2));
        })
    );

}
