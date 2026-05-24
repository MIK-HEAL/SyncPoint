import { safeError } from "../errors.js";
import { formatToolResult } from "../format.js";

export function ok(data: object) {
  return { content: [{ type: "text" as const, text: formatToolResult(data as Record<string, unknown>) }] };
}

export function fail(err: unknown) {
  return { content: [{ type: "text" as const, text: safeError(err) }], isError: true as const };
}
