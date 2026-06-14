import { spawn } from "node:child_process";
import type { RunnerConfig } from "./config.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Result of a single Claude Code CLI execution
// ---------------------------------------------------------------------------

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

// ---------------------------------------------------------------------------
// ClaudeCodeRunner — wraps `claude` CLI as a subprocess
// ---------------------------------------------------------------------------

export class ClaudeCodeRunner {
  constructor(
    private config: RunnerConfig,
    private logger: Logger,
  ) {}

  /**
   * Run Claude Code CLI with the given prompt as the initial user message.
   * Uses `--print` for non-interactive execution.
   */
  async run(
    prompt: string,
    options?: { cwd?: string; timeout?: number; env?: Record<string, string> },
  ): Promise<RunResult> {
    const timeout = options?.timeout ?? this.config.claudeTimeout;
    const start = Date.now();

    const args: string[] = [];
    if (this.config.claudePrintMode) {
      args.push("--print", "--output-format", "json");
    }
    if (this.config.claudeMaxTokens) {
      args.push("--max-tokens", String(this.config.claudeMaxTokens));
    }

    this.logger.debug("spawning claude", {
      binary: this.config.claudeBinary,
      args,
      cwd: options?.cwd,
      promptLength: prompt.length,
    });

    return new Promise<RunResult>((resolve) => {
      const child = spawn(this.config.claudeBinary, args, {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        stdio: ["pipe", "pipe", "pipe"],
        // On Windows shell:true is needed for .cmd shims; on POSIX it's not.
        shell: process.platform === "win32",
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // Write prompt to stdin then close
      child.stdin.write(prompt);
      child.stdin.end();

      // Timeout guard
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        // Force kill after 5s grace period
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // already dead
          }
        }, 5_000);
      }, timeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        const exitCode = code ?? (timedOut ? 124 : 1);

        this.logger.debug("claude finished", {
          exitCode,
          durationMs,
          timedOut,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });

        resolve({ exitCode, stdout, stderr, durationMs, timedOut });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        this.logger.error("claude process error", { error: err.message });
        resolve({
          exitCode: 1,
          stdout: "",
          stderr: err.message,
          durationMs,
          timedOut: false,
        });
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers to extract structured data from Claude output
// ---------------------------------------------------------------------------

/**
 * Extract a summary from Claude's JSON output.
 * Claude Code --output-format json returns { result: string, ... }.
 */
export function extractSummary(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.result === "string") {
      return parsed.result.slice(0, 200);
    }
  } catch {
    // not JSON — fall back to raw text
  }
  const lines = stdout.trim().split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return "Task executed successfully";
  return nonEmpty.slice(0, 3).join(" ").slice(0, 200);
}

/**
 * Extract progress indicators from output.
 */
export function extractProgress(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.result === "string") {
      // Look for progress-like patterns
      const match = parsed.result.match(/(?:progress|completed|done)[\s:]*(.*)/i);
      return match?.[1]?.trim().slice(0, 200);
    }
  } catch {
    // not JSON
  }
  return undefined;
}

/**
 * Extract next steps from output.
 */
export function extractNextSteps(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.result === "string") {
      const match = parsed.result.match(/(?:next steps?|todo|remaining)[\s:]*(.*)/i);
      return match?.[1]?.trim().slice(0, 200);
    }
  } catch {
    // not JSON
  }
  return undefined;
}
