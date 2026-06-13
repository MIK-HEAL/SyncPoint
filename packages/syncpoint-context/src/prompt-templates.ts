/**
 * Prompt Template Engine — format ResumeContext for different AI editors.
 *
 * Supported formats:
 *   - system-prompt:  Plain text for system prompt injection
 *   - cursorrules:    .cursorrules / .windsurfrules file format
 *   - agents-md:      AGENTS.md project knowledge file
 *   - checkpoint-md:  Standalone markdown checkpoint document
 *   - clipboard:      Compact text for clipboard paste
 */

import type { ResumeContext } from "./memory.js";
import type { RealityProjection } from "./reality-projection.js";
import {
  formatSystemPrompt,
  formatCursorRules,
  formatAgentsMd,
  formatCheckpointMd,
  formatClipboard,
} from "./prompt-templates-formats.js";

// Re-export formatRealityProjection for backward compatibility
export { formatRealityProjection } from "./prompt-templates-formats.js";

export type PromptFormat =
  | "system-prompt"
  | "cursorrules"
  | "agents-md"
  | "checkpoint-md"
  | "clipboard";

/**
 * Format a ResumeContext into a specific prompt template.
 * P2: Accepts optional RealityProjection to inject compiled projection into all formats.
 */
export function formatResumePrompt(
  ctx: ResumeContext,
  format: PromptFormat = "system-prompt",
  projection?: RealityProjection | null,
): string {
  switch (format) {
    case "system-prompt":
      return formatSystemPrompt(ctx, projection);
    case "cursorrules":
      return formatCursorRules(ctx, projection);
    case "agents-md":
      return formatAgentsMd(ctx, projection);
    case "checkpoint-md":
      return formatCheckpointMd(ctx, projection);
    case "clipboard":
      return formatClipboard(ctx, projection);
    default:
      return formatSystemPrompt(ctx, projection);
  }
}
