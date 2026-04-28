/**
 * MCP error helpers — wrap internal errors to safe user-facing messages.
 * Never expose stack traces through MCP responses.
 */

export function safeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "NotFoundError") return err.message;
    if (err.name === "ProjectMemoryPathError") return err.message;
    if (err.name === "LoopError") return err.message;
    return `Internal error: ${err.message}`;
  }
  return "Unknown error";
}

export function log(msg: string): void {
  process.stderr.write(`[syncpoint-mcp] ${msg}\n`);
}
