export function buildScopeFilter(input?: { sessionId?: string; taskId?: string }) {
  return input?.sessionId || input?.taskId
    ? { sessionId: input?.sessionId, taskId: input?.taskId }
    : undefined;
}

export function agentNameFromList(agents: Array<{ id: string; name: string }>, id: string): string {
  return agents.find(a => a.id === id)?.name ?? id.slice(0, 8);
}

export function taskTitleFromList(tasks: Array<{ id: string; title: string }>, id: string): string {
  return tasks.find(t => t.id === id)?.title ?? id.slice(0, 8);
}
