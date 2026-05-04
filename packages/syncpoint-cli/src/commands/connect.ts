/**
 * CLI Connect — simplified agent registration + MCP config generation.
 *
 * Inspired by Multica's `multica setup` one-command approach.
 * These commands reduce the multi-step manual process to:
 *   syncpoint connect --name architect --provider cursor --role manager
 *   syncpoint setup
 *   syncpoint doctor
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { RuntimeKind } from "syncpoint-core";
import { initSyncpointDir, getSyncpointDir, isProjectLocal } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";

// ── Helpers ──────────────────────────────────────────────

const PROVIDERS = ["codex", "claude-code", "cursor", "cline", "copilot", "human", "other"] as const;
const ROLES = ["manager", "frontend", "backend", "tester", "reviewer", "other"] as const;
const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve an agent by name or ID. Returns the agent or null.
 */
export function resolveAgent(nameOrId: string): ReturnType<typeof repo.getAgent> | null {
  // Try by ID first
  try {
    return repo.getAgent(nameOrId);
  } catch { /* not found by id */ }
  // Try by name
  return repo.getAgentByName(nameOrId);
}

function getMcpDistPath(): string {
  // Walk up from CLI dist to find syncpoint-mcp/dist/main.js
  const cliSrc = path.resolve(currentDir);
  // packages/syncpoint-cli/src/commands -> packages/syncpoint-mcp/dist/main.js
  const mcpDist = path.resolve(cliSrc, "..", "..", "..", "syncpoint-mcp", "dist", "main.js");
  if (fs.existsSync(mcpDist)) return mcpDist;
  // Fallback: try from dist directory
  const mcpDist2 = path.resolve(cliSrc, "..", "..", "..", "..", "syncpoint-mcp", "dist", "main.js");
  if (fs.existsSync(mcpDist2)) return mcpDist2;
  return "<SYNCPOINT_ROOT>/packages/syncpoint-mcp/dist/main.js";
}

function prepareProject(projectRoot: string): string {
  const syncDir = initSyncpointDir(projectRoot);
  process.env.SYNCPOINT_DB_DIR = syncDir;
  return syncDir;
}

function bindRuntime(agent: { id: string; name: string }, provider: string, projectRoot: string): ReturnType<typeof repo.updateAgentRuntime> {
  const runtime = repo.createRuntime({
    name: `${agent.name}-runtime`,
    kind: RuntimeKind.LOCAL_MCP,
    provider,
    host: os.hostname(),
    workspaceRoot: projectRoot,
    agentId: agent.id,
  });
  return repo.updateAgentRuntime(agent.id, runtime.id);
}

function buildEnv(agent: { id: string; runtimeId?: string | null }, projectRoot: string): Record<string, string> {
  return {
    SYNCPOINT_AGENT_ID: agent.id,
    ...(agent.runtimeId ? { SYNCPOINT_RUNTIME_ID: agent.runtimeId } : {}),
    SYNCPOINT_PROJECT_ROOT: projectRoot,
  };
}

function generateMcpConfig(agent: { id: string; name: string; runtimeId?: string | null }, projectRoot: string): object {
  return {
    servers: {
      syncpoint: {
        type: "stdio",
        command: "node",
        args: [getMcpDistPath()],
        env: buildEnv(agent, projectRoot),
      },
    },
  };
}

function generateCursorMcpConfig(agent: { id: string; name: string; runtimeId?: string | null }, projectRoot: string): object {
  return {
    mcpServers: {
      syncpoint: {
        command: "node",
        args: [getMcpDistPath()],
        env: buildEnv(agent, projectRoot),
      },
    },
  };
}

// ── syncpoint connect ────────────────────────────────────

export function registerConnectCommands(program: Command): void {
  program
    .command("connect")
    .description(
      "Register an agent and generate ready-to-paste MCP config.\n" +
      "One command replaces: agent add → copy ID → edit JSON config."
    )
    .requiredOption("--name <name>", "Agent name (e.g. architect, worker-a)")
    .addOption(new Option("--provider <provider>", "AI provider").choices([...PROVIDERS]).default("cursor"))
    .addOption(new Option("--role <role>", "Agent role").choices([...ROLES]).default("backend"))
    .addOption(new Option("--editor <editor>", "Target editor for config format").choices(["vscode", "cursor", "copilot"]).default("cursor"))
    .option("--project <dir>", "Project root (defaults to cwd)")
    .option("--json", "Output raw JSON only")
    .action((opts) => {
      const projectRoot = path.resolve(opts.project || process.cwd());
      prepareProject(projectRoot);

      // Check if agent already exists by name
      const existing = repo.getAgentByName(opts.name);
      if (existing) {
        const agent = existing.runtimeId ? existing : bindRuntime(existing, opts.provider, projectRoot);
        if (!opts.json) {
          console.log(`Agent "${opts.name}" already registered (${agent.id}).`);
          console.log("Generating config for existing agent.\n");
        }
        outputConfig(agent, projectRoot, opts.editor, opts.json);
        return;
      }

      // Register agent
      const agent = repo.createAgent({
        name: opts.name,
        provider: opts.provider,
        role: opts.role,
      });

      const boundAgent = bindRuntime(agent, opts.provider, projectRoot);

      if (!opts.json) {
        console.log(`✓ Agent registered: ${agent.name} (${agent.id})`);
        console.log(`✓ Runtime bound:    ${boundAgent.runtimeId}`);
        console.log("");
      }

      outputConfig(boundAgent, projectRoot, opts.editor, opts.json);
    });

  // ── syncpoint setup ──────────────────────────────────

  program
    .command("setup")
    .description(
      "One-command project setup: init + register agents + generate configs.\n" +
      "Like Multica's `multica setup` but for SyncPoint's local-first model."
    )
    .option("--project <dir>", "Project root (defaults to cwd)")
    .addOption(new Option("--editor <editor>", "Target editor").choices(["vscode", "cursor", "copilot"]).default("cursor"))
    .option("--agents <n>", "Number of agent windows to set up", "2")
    .option("--json", "Output raw JSON only")
    .action((opts) => {
      const projectRoot = path.resolve(opts.project || process.cwd());
      const agentCount = Math.max(1, Math.min(parseInt(opts.agents, 10) || 2, 10));

      // Step 1: Init
      const syncDir = prepareProject(projectRoot);
      if (!opts.json) {
        console.log(`✓ SyncPoint initialized: ${syncDir}`);
        console.log("");
      }

      // Step 2: Default agent plan
      const plan: Array<{ name: string; provider: string; role: string }> = [];
      // First agent is always the architect/manager
      plan.push({ name: "architect", provider: opts.editor === "copilot" ? "copilot" : opts.editor, role: "manager" });
      // Remaining agents are executors
      for (let i = 1; i < agentCount; i++) {
        const suffix = agentCount > 2 ? `-${String.fromCharCode(96 + i)}` : "";
        plan.push({
          name: `executor${suffix}`,
          provider: opts.editor === "copilot" ? "copilot" : opts.editor,
          role: "backend",
        });
      }

      if (!opts.json) {
        console.log(`Setting up ${agentCount} agent(s):`);
        console.log("");
      }

      const results: Array<{ agent: ReturnType<typeof repo.createAgent>; runtime: ReturnType<typeof repo.createRuntime> | null }> = [];

      for (const p of plan) {
        // Skip if already exists
        const existing = repo.getAgentByName(p.name);
        if (existing) {
          const agent = existing.runtimeId ? existing : bindRuntime(existing, p.provider, projectRoot);
          if (!opts.json) {
            console.log(`  • ${p.name}: already registered (${agent.id})`);
          }
          results.push({ agent, runtime: null });
          continue;
        }

        const agent = repo.createAgent({
          name: p.name,
          provider: p.provider as any,
          role: p.role as any,
        });

        const boundAgent = bindRuntime(agent, p.provider, projectRoot);
        const runtime = boundAgent.runtimeId ? repo.getRuntime(boundAgent.runtimeId) : null;

        results.push({ agent: boundAgent, runtime });

        if (!opts.json) {
          console.log(`  ✓ ${agent.name} (${agent.id}) — ${p.role}`);
        }
      }

      if (!opts.json) {
        console.log("");
        console.log("─".repeat(50));
        console.log("");
        console.log("MCP configs — paste into each editor window:\n");
      }

      if (opts.json) {
        const configs = results.map(r => ({
          agent: { id: r.agent.id, name: r.agent.name, role: r.agent.role },
          config: opts.editor === "cursor"
            ? generateCursorMcpConfig(r.agent, projectRoot)
            : generateMcpConfig(r.agent, projectRoot),
        }));
        console.log(JSON.stringify(configs, null, 2));
        return;
      }

      for (const r of results) {
        console.log(`── ${r.agent.name} (${r.agent.role}) ──`);
        console.log("");
        const config = opts.editor === "cursor"
          ? generateCursorMcpConfig(r.agent, projectRoot)
          : generateMcpConfig(r.agent, projectRoot);
        console.log(JSON.stringify(config, null, 2));
        console.log("");
      }

      console.log("─".repeat(50));
      console.log("");
      console.log("Next steps:");
      console.log("  1. Paste each config into the corresponding editor window's MCP settings");
      console.log("  2. Restart the MCP connection in each window");
      console.log("  3. Call syncpoint_whoami in each window to verify");
      console.log("  4. Run: syncpoint doctor");
      console.log("");
    });

  // ── syncpoint doctor ─────────────────────────────────

  program
    .command("doctor")
    .description(
      "Verify SyncPoint connection health.\n" +
      "Checks: database, agents, runtimes, and binding status."
    )
    .option("--json", "Machine-readable JSON output")
    .action((opts) => {
      const checks: Array<{ check: string; status: "ok" | "warn" | "fail"; detail: string }> = [];

      // Check 1: .syncpoint/ directory
      let syncDir: string | null = null;
      try {
        if (!isProjectLocal()) throw new Error("No project-local .syncpoint directory");
        syncDir = getSyncpointDir();
        const dbPath = path.join(syncDir, "syncpoint.db");
        if (fs.existsSync(dbPath)) {
          checks.push({ check: "database", status: "ok", detail: dbPath });
        } else {
          checks.push({ check: "database", status: "fail", detail: `${dbPath} not found` });
        }
      } catch {
        checks.push({ check: "database", status: "fail", detail: "No .syncpoint/ directory found. Run: syncpoint init" });
      }

      // Check 2: Registered agents
      let agents: ReturnType<typeof repo.listAgents> = [];
      try {
        agents = repo.listAgents();
        if (agents.length === 0) {
          checks.push({ check: "agents", status: "warn", detail: "No agents registered. Run: syncpoint connect --name <name>" });
        } else {
          checks.push({ check: "agents", status: "ok", detail: `${agents.length} agent(s) registered` });
        }
      } catch {
        checks.push({ check: "agents", status: "fail", detail: "Cannot read agents table" });
      }

      // Check 3: Runtimes
      let runtimes: ReturnType<typeof repo.listRuntimes> = [];
      try {
        runtimes = repo.listRuntimes();
        const active = runtimes.filter(r => r.status === "ACTIVE");
        if (runtimes.length === 0) {
          checks.push({ check: "runtimes", status: "warn", detail: "No runtimes registered. Run: syncpoint connect --name <name>" });
        } else {
          checks.push({ check: "runtimes", status: "ok", detail: `${runtimes.length} runtime(s) (${active.length} active)` });
        }
      } catch {
        checks.push({ check: "runtimes", status: "fail", detail: "Cannot read runtimes table" });
      }

      // Check 4: Agent-runtime bindings
      const unbound = agents.filter(a => !a.runtimeId);
      if (agents.length > 0 && unbound.length > 0) {
        checks.push({
          check: "bindings",
          status: "warn",
          detail: `${unbound.length} agent(s) without runtime binding: ${unbound.map(a => a.name).join(", ")}`,
        });
      } else if (agents.length > 0) {
        checks.push({ check: "bindings", status: "ok", detail: "All agents have runtime bindings" });
      }

      // Check 5: MCP dist exists
      const mcpPath = getMcpDistPath();
      if (mcpPath.includes("<SYNCPOINT_ROOT>")) {
        checks.push({ check: "mcp-server", status: "warn", detail: "Cannot locate syncpoint-mcp/dist/main.js. Run: pnpm build" });
      } else if (fs.existsSync(mcpPath)) {
        checks.push({ check: "mcp-server", status: "ok", detail: mcpPath });
      } else {
        checks.push({ check: "mcp-server", status: "warn", detail: `${mcpPath} not found. Run: pnpm --filter syncpoint-mcp build` });
      }

      // Output
      if (opts.json) {
        const allOk = checks.every(c => c.status === "ok");
        console.log(JSON.stringify({ healthy: allOk, checks }, null, 2));
        return;
      }

      console.log("SyncPoint Doctor");
      console.log("─".repeat(40));
      console.log("");

      for (const c of checks) {
        const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "✗";
        const prefix = c.status === "ok" ? "  " : c.status === "warn" ? "  " : "  ";
        console.log(`${prefix}${icon} ${c.check}: ${c.detail}`);
      }

      console.log("");

      // Agent detail table
      if (agents.length > 0) {
        console.log("Agents:");
        console.log("");
        for (const a of agents) {
          const rt = a.runtimeId ? runtimes.find(r => r.id === a.runtimeId) : null;
          const bindStatus = rt ? `bound → ${rt.name}` : "unbound";
          console.log(`  ${a.name}`);
          console.log(`    ID:       ${a.id}`);
          console.log(`    Provider: ${a.provider}`);
          console.log(`    Role:     ${a.role}`);
          console.log(`    Status:   ${a.status}`);
          console.log(`    Binding:  ${bindStatus}`);
          console.log("");
        }
      }

      const allOk = checks.every(c => c.status === "ok");
      if (allOk) {
        console.log("All checks passed. Each editor window should call syncpoint_whoami to verify.");
      } else {
        const fails = checks.filter(c => c.status === "fail");
        const warns = checks.filter(c => c.status === "warn");
        if (fails.length > 0) {
          console.log(`${fails.length} issue(s) need attention.`);
        }
        if (warns.length > 0) {
          console.log(`${warns.length} warning(s).`);
        }
      }
    });
}

function outputConfig(
  agent: { id: string; name: string; runtimeId?: string | null },
  projectRoot: string,
  editor: string,
  json: boolean,
): void {
  const config = editor === "cursor"
    ? generateCursorMcpConfig(agent, projectRoot)
    : generateMcpConfig(agent, projectRoot);

  if (json) {
    console.log(JSON.stringify({ agent: { id: agent.id, name: agent.name }, config }, null, 2));
    return;
  }

  console.log(`MCP config for ${editor} — paste into your MCP settings:`);
  console.log("");
  console.log(JSON.stringify(config, null, 2));
  console.log("");
  console.log("After pasting:");
  console.log("  1. Restart the MCP connection");
  console.log("  2. Call syncpoint_whoami to verify identity");
  console.log("");
}
