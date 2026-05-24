export interface WakeEngineOptions {
  enabled?: boolean;
  defaultRunnerMode?: "manual" | "mcp";
}

export interface WakeEngineStats {
  eventsProcessed: number;
  wakeRequestsCreated: number;
  wakeRequestsSkipped: number;
  running: boolean;
}

export interface WakeListInput {
  sessionId?: string;
  agentId?: string;
  status?: string;
}
