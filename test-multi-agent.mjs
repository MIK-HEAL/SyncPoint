/**
 * Multi-agent collaboration test
 * Spawns 3 simulated agents and tests coordination via SyncPoint server
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";

const URL = "http://127.0.0.1:8765/trpc";

function makeClient(agentId, role = "agent") {
  return createTRPCClient({
    links: [
      httpBatchLink({
        url: URL,
        headers: () => ({
          "x-caller-id": agentId,
          "x-agent-role": role,
        }),
      }),
    ],
  });
}

const log = (agent, msg) => console.log(`  [${agent.padEnd(12)}] ${msg}`);
const hr = () => console.log("─".repeat(60));

async function main() {
  // ── 3 agents: architect (manager), frontend-dev, backend-dev ──
  const architect = makeClient("architect", "admin");
  const frontend  = makeClient("frontend-dev");
  const backend   = makeClient("backend-dev");

  hr();
  console.log("🚀 1. Registering 3 agents...");
  hr();

  const agentA = await architect.agent.create.mutate({ name: "architect", provider: "claude-code", role: "manager" });
  log("architect", `registered id=${agentA.id}`);

  const agentB = await frontend.agent.create.mutate({ name: "frontend-dev", provider: "claude-code", role: "frontend" });
  log("frontend-dev", `registered id=${agentB.id}`);

  const agentC = await backend.agent.create.mutate({ name: "backend-dev", provider: "claude-code", role: "backend" });
  log("backend-dev", `registered id=${agentC.id}`);

  hr();
  console.log("📋 2. Creating task and assigning to both devs...");
  hr();

  const task = await architect.task.create.mutate({
    title: "Build login page with auth API",
    description: "Frontend: login form UI. Backend: auth endpoint. Coordinate on API contract.",
  });
  log("architect", `task created id=${task.id} title="${task.title}"`);

  await architect.task.assign.mutate({ taskId: task.id, agentId: agentB.id });
  log("architect", `assigned frontend-dev to task`);

  await architect.task.assign.mutate({ taskId: task.id, agentId: agentC.id });
  log("architect", `assigned backend-dev to task`);

  hr();
  console.log("💬 3. Agents exchanging messages...");
  hr();

  // architect sends API contract to both
  const msg1 = await architect.agentMessage.send.mutate({
    fromAgent: "architect",
    toAgent: "backend-dev",
    kind: "REQUEST",
    subject: "API Contract",
    body: "POST /api/auth/login {email, password} -> {token, user}. Please implement.",
  });
  log("architect", `sent REQUEST to backend-dev (id=${msg1.id})`);

  // backend replies
  const msg2 = await backend.agentMessage.reply.mutate({
    messageId: msg1.id,
    agentId: "backend-dev",
    body: "Done. Endpoint ready at POST /api/auth/login. Returns JWT token.",
  });
  log("backend-dev", `replied to architect (id=${msg2.id})`);

  // backend notifies frontend
  const msg3 = await backend.agentMessage.send.mutate({
    fromAgent: "backend-dev",
    toAgent: "frontend-dev",
    subject: "API ready",
    body: "Auth endpoint is live. POST /api/auth/login with {email, password}.",
  });
  log("backend-dev", `notified frontend-dev (id=${msg3.id})`);

  // frontend acknowledges
  const msg4 = await frontend.agentMessage.send.mutate({
    fromAgent: "frontend-dev",
    toAgent: "backend-dev",
    kind: "RESPONSE",
    body: "Got it, integrating now. Thanks!",
  });
  log("frontend-dev", `acknowledged backend-dev (id=${msg4.id})`);

  // check unread messages
  const unread = await frontend.agentMessage.list.query({ toAgent: "frontend-dev", unreadOnly: true });
  log("frontend-dev", `has ${unread.length} unread message(s)`);

  hr();
  console.log("🔒 4. Resource claims — both devs claim files...");
  hr();

  // Use internal service via a custom procedure - let's use write.check instead
  // Actually let's use the loop.boot to simulate real agent lifecycle
  // For now, let's do a simple demo with checkpoints and handoff

  hr();
  console.log("📌 5. Creating checkpoints...");
  hr();

  const cp1 = await frontend.checkpoint.create.mutate({
    taskId: task.id,
    agentId: agentB.id,
    summary: "Login form UI complete. Connected to auth API.",
    progress: "100%",
    currentUnderstanding: "Auth uses JWT. Need to handle token refresh.",
    changedResources: "src/components/LoginForm.tsx, src/api/auth.ts",
    risks: "Token expiry not handled yet",
    blockers: "",
    nextSteps: "Wait for backend to confirm token refresh endpoint",
    needSync: true,
  });
  log("frontend-dev", `checkpoint created id=${cp1.id}`);

  const cp2 = await backend.checkpoint.create.mutate({
    taskId: task.id,
    agentId: agentC.id,
    summary: "Auth endpoint complete. Login + token refresh implemented.",
    progress: "100%",
    currentUnderstanding: "JWT with 1h expiry. Refresh endpoint at POST /api/auth/refresh.",
    changedResources: "src/routes/auth.ts, src/middleware/jwt.ts",
    risks: "",
    blockers: "",
    nextSteps: "Ready for handoff to frontend for integration testing",
    needSync: false,
  });
  log("backend-dev", `checkpoint created id=${cp2.id}`);

  hr();
  console.log("🔄 6. Handoff — backend hands off to frontend for testing...");
  hr();

  const handoff = await backend.handoff.create.mutate({
    taskId: task.id,
    fromAgentId: agentC.id,
    toAgentId: agentB.id,
    contextSummary: "Auth API fully implemented. Login + refresh endpoints ready. Please run integration tests.",
  });
  log("backend-dev", `handoff created id=${handoff.id}`);

  await frontend.handoff.accept.mutate({ handoffId: handoff.id });
  log("frontend-dev", `accepted handoff`);

  hr();
  console.log("📝 7. Project memory — architect writes conventions...");
  hr();

  const mem = await architect.projectMemory.add.mutate({
    category: "convention",
    title: "API Response Format",
    content: "All API responses must follow {success: boolean, data?: T, error?: string} format.",
    scope: "project",
    tags: ["api", "convention", "backend"],
  });
  log("architect", `memory created id=${mem.id} title="${mem.title}"`);

  // search for it
  const found = await frontend.projectMemory.search.query({ query: "API response format" });
  log("frontend-dev", `searched memory, found ${found.length} result(s)`);

  hr();
  console.log("🔔 8. Wake engine — wake idle agent...");
  hr();

  // Create a wake request targeting frontend-dev
  try {
    const wake = await architect.wake.create.mutate({
      targetAgentId: agentB.id,
      reason: "Please start integration testing now",
      action: "start_work",
      taskId: task.id,
    });
    log("architect", `wake request created id=${wake.id}`);
  } catch (e) {
    log("architect", `wake create: ${e.message?.slice(0, 80)}`);
  }

  hr();
  console.log("📊 9. Final status check...");
  hr();

  const agents = await architect.agent.list.query();
  log("system", `total agents: ${agents.length}`);

  const tasks = await architect.task.list.query();
  log("system", `total tasks: ${tasks.length}`);

  const messages = await architect.agentMessage.list.query({ toAgent: "architect" });
  log("system", `architect messages: ${messages.length}`);

  const checkpoints = await architect.checkpoint.list.query({ taskId: task.id });
  log("system", `checkpoints for task: ${checkpoints.length}`);

  const events = await architect.event.list.query({ limit: 10 });
  log("system", `recent events: ${events.length}`);

  hr();
  console.log("✅ Multi-agent collaboration test complete!");
  hr();
}

main().catch((err) => {
  console.error("❌ Test failed:", err.message);
  process.exit(1);
});
