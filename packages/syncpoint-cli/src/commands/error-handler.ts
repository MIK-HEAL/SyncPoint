/**
 * User-friendly error handling for SyncPoint CLI.
 *
 * Translates raw errors into actionable, human-readable messages
 * with suggestions for resolution.
 */

import {
  SyncPointError,
  ResourceConflictError,
  ResourceNotFoundError,
  ConstraintViolationError,
  UnauthorizedError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
  DatabaseError,
  OperationTimeoutError,
  InternalError,
} from "syncpoint-kernel";

// ── Error formatting ──────────────────────────────────

export interface FormattedError {
  icon: string;
  title: string;
  message: string;
  suggestion: string;
  details?: string;
  /** Link to relevant docs or GitHub issues. */
  helpUrl?: string;
}

const ISSUES_URL = "https://github.com/MIK-HEAL/SyncPoint/issues";

/**
 * Format any error into a user-friendly structure.
 */
export function formatError(err: unknown): FormattedError {
  // ── Known SyncPoint errors ──
  if (err instanceof ResourceConflictError) {
    return {
      icon: "🔒",
      title: "Resource Conflict",
      message: err.message,
      suggestion: "Try narrowing your claim scope (e.g. --scope function) or wait for the other agent to release.",
      details: err.message,
    };
  }

  if (err instanceof ResourceNotFoundError) {
    return {
      icon: "🔍",
      title: "Resource Not Found",
      message: err.message,
      suggestion: "Check the resource locator. Use 'syncpoint status' to see active resources.",
    };
  }

  if (err instanceof ConstraintViolationError) {
    return {
      icon: "🚫",
      title: "Constraint Violation",
      message: err.message,
      suggestion: "Review constraints with 'syncpoint constraint list'. Consider requesting an exemption if this is intentional.",
    };
  }

  if (err instanceof UnauthorizedError) {
    return {
      icon: "🔑",
      title: "Unauthorized",
      message: err.message,
      suggestion: "Check your agent token. Run 'syncpoint connect --status' to verify your session.",
    };
  }

  if (err instanceof ForbiddenError) {
    return {
      icon: "⛔",
      title: "Forbidden",
      message: err.message,
      suggestion: "Your agent does not have permission for this action. Contact the session owner.",
    };
  }

  if (err instanceof InvalidStateTransitionError) {
    return {
      icon: "⚠️",
      title: "Invalid State Transition",
      message: err.message,
      suggestion: "Check the current status with 'syncpoint status'. The requested action is not valid from the current state.",
    };
  }

  if (err instanceof ValidationError) {
    return {
      icon: "📝",
      title: "Validation Error",
      message: err.message,
      suggestion: "Run the command with --help to see valid parameters.",
    };
  }

  if (err instanceof DatabaseError) {
    return {
      icon: "💾",
      title: "Database Error",
      message: err.message,
      suggestion: "Check that .syncpoint/syncpoint.db is accessible and not corrupted. Try 'syncpoint doctor'.",
      helpUrl: ISSUES_URL,
    };
  }

  if (err instanceof OperationTimeoutError) {
    return {
      icon: "⏰",
      title: "Operation Timeout",
      message: err.message,
      suggestion: "The operation took too long. Check your network connection and retry.",
    };
  }

  if (err instanceof InternalError) {
    return {
      icon: "🔥",
      title: "Internal Error",
      message: err.message,
      suggestion: `This is unexpected. Please report it at ${ISSUES_URL}`,
      helpUrl: ISSUES_URL,
    };
  }

  if (err instanceof SyncPointError) {
    return {
      icon: "❌",
      title: "SyncPoint Error",
      message: err.message,
      suggestion: "See above for details.",
    };
  }

  // ── Generic / unknown errors ──
  if (err instanceof Error) {
    const msg = err.message;

    // Detect common patterns
    if (msg.includes("ECONNREFUSED") || msg.includes("connect")) {
      return {
        icon: "🔌",
        title: "Connection Failed",
        message: "Could not connect to the SyncPoint server.",
        suggestion: "Is the server running? Start it with 'syncpoint server start'.",
      };
    }

    if (msg.includes("ENOENT") || msg.includes("not found")) {
      return {
        icon: "📁",
        title: "File Not Found",
        message: msg,
        suggestion: "Check that the file path is correct and the file exists.",
      };
    }

    if (msg.includes("EACCES") || msg.includes("permission")) {
      return {
        icon: "🔐",
        title: "Permission Denied",
        message: msg,
        suggestion: "Check file permissions or run with appropriate privileges.",
      };
    }

    // Unknown error — encourage bug report
    return {
      icon: "❌",
      title: "Unexpected Error",
      message: err.message,
      suggestion: `Please report this issue at ${ISSUES_URL} with the details below.`,
      details: err.stack ?? err.message,
      helpUrl: ISSUES_URL,
    };
  }

  return {
    icon: "❌",
    title: "Error",
    message: String(err),
    suggestion: "An unknown error occurred.",
  };
}

/**
 * Print a formatted error to stderr and set the process exit code.
 */
export function printError(err: unknown, exitCode = 1): void {
  const formatted = formatError(err);
  const lines = [`${formatted.icon} ${formatted.title}: ${formatted.message}`];
  if (formatted.suggestion) {
    lines.push(`   💡 ${formatted.suggestion}`);
  }
  if (formatted.details && formatted.title !== "Unexpected Error") {
    lines.push(`   Details: ${formatted.details}`);
  }
  if (formatted.helpUrl) {
    lines.push(`   🔗 ${formatted.helpUrl}`);
  }
  console.error(lines.join("\n"));
  process.exitCode = exitCode;
}

/**
 * Wrap an async action with error handling.
 * Catches any error, prints it nicely, and sets exit code.
 *
 * Usage:
 *   .action((opts) => handleError(() => doWork(opts)))
 */
export function handleError(fn: () => void | Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (err: unknown) {
      printError(err);
    }
  };
}
