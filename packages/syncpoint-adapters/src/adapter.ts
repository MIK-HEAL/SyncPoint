/**
 * Agent Adapter Protocol — standardized interface for AI editor integration.
 *
 * Each adapter defines how a specific AI editor (Codex, Claude Code, Cursor, Cline)
 * should consume SyncPoint's resume context at key lifecycle moments:
 *
 *   onBoot    — agent starts fresh or is assigned a task
 *   onResume  — agent resumes after pause / context switch
 *   onHandoff — agent receives a task handoff from another agent
 *
 * The adapter protocol does NOT control the editor directly.
 * It produces the correct files and instructions so that the editor's native
 * mechanism picks up the narrowed context.
 */

import { z } from "zod";
import type { ResumeContext } from "syncpoint-context";
import type { PromptFormat } from "syncpoint-context";

// ── Provider enum ────────────────────────────────────

export const AgentProvider = z.enum([
  "codex",
  "claude-code",
  "cursor",
  "cline",
  "copilot",
  "human",
  "other",
]);
export type AgentProvider = z.infer<typeof AgentProvider>;

// ── Lifecycle events ─────────────────────────────────

export const AdapterLifecycleEvent = z.enum([
  "boot",
  "resume",
  "handoff",
  "checkpoint",
]);
export type AdapterLifecycleEvent = z.infer<typeof AdapterLifecycleEvent>;

// ── Adapter instruction ──────────────────────────────

export const AdapterInstructionSchema = z.object({
  /** Lifecycle event that triggered this instruction */
  event: AdapterLifecycleEvent,
  /** Provider this instruction targets */
  provider: AgentProvider,
  /** Files to write (relative path → content) */
  files: z.record(z.string()),
  /** Formatted prompt text for clipboard / system prompt injection */
  promptText: z.string(),
  /** Format used for the primary rules file */
  primaryFormat: z.string(),
  /** Human-readable summary of what the adapter did */
  summary: z.string(),
  /** Warnings from resume context */
  warnings: z.array(z.string()),
  /** Whether the context is ready */
  ready: z.boolean(),
});

export type AdapterInstruction = z.infer<typeof AdapterInstructionSchema>;

// ── Adapter config per provider ──────────────────────

export interface AdapterConfig {
  /** Which provider this adapter serves */
  provider: AgentProvider;
  /** Primary rules file format */
  rulesFormat: PromptFormat;
  /** File path for the primary rules file (relative to project root) */
  rulesFile: string;
  /** Additional files to generate */
  extraFiles: { path: string; format: PromptFormat }[];
  /** System prompt preamble injected before resume context */
  preamble: string;
  /** Instructions shown to the user about how to configure the editor */
  setupInstructions: string;
}

// ── Built-in adapter configs ─────────────────────────

export const ADAPTER_CONFIGS: Record<string, AdapterConfig> = {
  cursor: {
    provider: "cursor",
    rulesFormat: "cursorrules",
    rulesFile: ".cursorrules",
    extraFiles: [],
    preamble:
      "You are working on a SyncPoint-managed project. " +
      "The rules below are your ONLY source of task context. " +
      "Do NOT use previous conversation history.",
    setupInstructions:
      "Cursor reads .cursorrules automatically from the project root.\n" +
      "Run `syncpoint adapter boot` after each resume or handoff.\n" +
      "The .cursorrules file will be overwritten with the latest context.",
  },

  "claude-code": {
    provider: "claude-code",
    rulesFormat: "agents-md",
    rulesFile: "AGENTS.md",
    extraFiles: [
      { path: ".syncpoint/resume-prompt.md", format: "system-prompt" },
    ],
    preamble:
      "You are working on a SyncPoint-managed project. " +
      "Read AGENTS.md for your current task context. " +
      "Do NOT carry over previous conversation history.",
    setupInstructions:
      "Claude Code reads AGENTS.md as project knowledge.\n" +
      "Run `syncpoint adapter boot` after each resume or handoff.\n" +
      "Start new conversations with: /read AGENTS.md",
  },

  codex: {
    provider: "codex",
    rulesFormat: "agents-md",
    rulesFile: "AGENTS.md",
    extraFiles: [
      { path: ".syncpoint/resume-prompt.md", format: "system-prompt" },
    ],
    preamble:
      "You are working on a SyncPoint-managed project. " +
      "Read AGENTS.md for your current task context. " +
      "Do NOT carry over previous conversation history.",
    setupInstructions:
      "Codex reads AGENTS.md as project context.\n" +
      "Run `syncpoint adapter boot` after each resume or handoff.\n" +
      "Pass --system-prompt from .syncpoint/resume-prompt.md when using API.",
  },

  cline: {
    provider: "cline",
    rulesFormat: "system-prompt",
    rulesFile: ".syncpoint/resume-prompt.md",
    extraFiles: [
      { path: ".cursorrules", format: "cursorrules" },
    ],
    preamble:
      "You are working on a SyncPoint-managed project. " +
      "The system prompt below is your ONLY source of task context. " +
      "Do NOT use previous conversation history.",
    setupInstructions:
      "Cline uses system prompts from its settings.\n" +
      "Run `syncpoint adapter boot` after each resume or handoff.\n" +
      "Copy .syncpoint/resume-prompt.md into Cline's custom system prompt field.",
  },

  copilot: {
    provider: "copilot",
    rulesFormat: "agents-md",
    rulesFile: "AGENTS.md",
    extraFiles: [],
    preamble:
      "You are working on a SyncPoint-managed project. " +
      "Read AGENTS.md for context.",
    setupInstructions:
      "GitHub Copilot reads AGENTS.md for project context.\n" +
      "Run `syncpoint adapter boot` after each resume or handoff.",
  },
};

// ── Build adapter instruction ────────────────────────

import { formatResumePrompt } from "syncpoint-context";
import type { RealityProjection } from "syncpoint-context";

/**
 * Build an AdapterInstruction for a given provider and lifecycle event.
 * This produces the file contents and prompt text that should be written
 * to the project directory so the editor picks up the narrowed context.
 */
export function buildAdapterInstruction(
  ctx: ResumeContext,
  provider: AgentProvider,
  event: AdapterLifecycleEvent = "resume",
  projection?: RealityProjection | null,
): AdapterInstruction {
  const config = ADAPTER_CONFIGS[provider] ?? ADAPTER_CONFIGS["cursor"]!;

  const files: Record<string, string> = {};

  // Primary rules file — P2: pass projection to all formats
  const primaryContent = formatResumePrompt(ctx, config.rulesFormat, projection);
  files[config.rulesFile] = primaryContent;

  // Extra files
  for (const extra of config.extraFiles) {
    files[extra.path] = formatResumePrompt(ctx, extra.format, projection);
  }

  // Prompt text for clipboard / API injection
  const promptText = config.preamble + "\n\n" + formatResumePrompt(ctx, "system-prompt", projection);

  const fileList = Object.keys(files).join(", ");
  const summary = `[${event}] ${config.provider}: wrote ${fileList}`;

  return {
    event,
    provider: config.provider,
    files,
    promptText,
    primaryFormat: config.rulesFormat,
    summary,
    warnings: ctx.warnings,
    ready: ctx.ready,
  };
}

/**
 * Get adapter config for a provider. Returns undefined if not found.
 */
export function getAdapterConfig(provider: string): AdapterConfig | undefined {
  return ADAPTER_CONFIGS[provider];
}

/**
 * List all known adapter provider names.
 */
export function listAdapterProviders(): string[] {
  return Object.keys(ADAPTER_CONFIGS);
}
