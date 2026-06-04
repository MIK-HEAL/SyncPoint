/**
 * SyncPoint structured error hierarchy.
 *
 * Every SyncPoint error has a machine-readable code, a user-facing
 * message, an HTTP status code for API responses, and a retryability
 * flag for automatic recovery logic.
 *
 * Usage:
 *   throw new ResourceConflictError("src/auth.ts", "agent-3");
 *
 * In tRPC error formatter:
 *   if (err instanceof SyncPointError) {
 *     return { code: err.code, message: err.userMessage, ... };
 *   }
 */

// ── Base ───────────────────────────────────────────────

export abstract class SyncPointError extends Error {
  /** Stable machine-readable error code (e.g. "RESOURCE_CONFLICT"). */
  abstract readonly code: string;
  /** HTTP status code for API responses. */
  abstract readonly httpStatus: number;
  /** Human-readable message for end users (non-technical). */
  abstract readonly userMessage: string;
  /** Optional suggestion for how to resolve the issue. */
  abstract readonly suggestion: string | undefined;
  /** Whether the operation can be retried. */
  abstract readonly retryable: boolean;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// ── Resource errors (4xx) ──────────────────────────────

export class ResourceConflictError extends SyncPointError {
  readonly code = "RESOURCE_CONFLICT";
  readonly httpStatus = 409;
  readonly retryable = true;
  readonly suggestion: string;

  constructor(
    readonly resourcePath: string,
    readonly claimedBy: string,
  ) {
    super(`Resource "${resourcePath}" is already claimed by ${claimedBy}`);
    this.suggestion = "Try narrowing your claim scope (e.g., from file to function) or wait for the other agent to release.";
  }
  get userMessage(): string {
    return `Resource "${this.resourcePath}" is already locked by ${this.claimedBy}`;
  }
}

export class ResourceNotFoundError extends SyncPointError {
  readonly code = "RESOURCE_NOT_FOUND";
  readonly httpStatus = 404;
  readonly retryable = false;
  readonly suggestion = "Check the resource identifier and try again.";

  constructor(readonly resourceId: string) {
    super(`Resource "${resourceId}" not found`);
  }
  get userMessage(): string {
    return `Resource "${this.resourceId}" was not found`;
  }
}

// ── Constraint errors (4xx) ────────────────────────────

export class ConstraintViolationError extends SyncPointError {
  readonly code = "CONSTRAINT_VIOLATION";
  readonly httpStatus = 403;
  readonly retryable = false;
  readonly suggestion: string;

  constructor(
    readonly violatedRules: string[],
    readonly resourcePath: string,
  ) {
    const rules = violatedRules.join(", ");
    super(`Constraint violation: ${rules} for "${resourcePath}"`);
    this.suggestion = "Review the constraint rules and adjust your changes, or request a constraint exemption.";
  }
  get userMessage(): string {
    return `Operation blocked by constraints: ${this.violatedRules.join(", ")}`;
  }
}

// ── Authentication / Authorization errors (4xx) ────────

export class UnauthorizedError extends SyncPointError {
  readonly code = "UNAUTHORIZED";
  readonly httpStatus = 401;
  readonly retryable = false;
  readonly suggestion = "Provide a valid x-caller-id header or agent token.";

  constructor() {
    super("Authentication required");
  }
  get userMessage(): string {
    return "Authentication required — please provide your agent identity";
  }
}

export class ForbiddenError extends SyncPointError {
  readonly code = "FORBIDDEN";
  readonly httpStatus = 403;
  readonly retryable = false;
  readonly suggestion: string;

  constructor(readonly operation: string, readonly reason?: string) {
    super(`Forbidden: ${operation}${reason ? ` — ${reason}` : ""}`);
    this.suggestion = "You do not have permission for this operation. Contact the project admin.";
  }
  get userMessage(): string {
    return `Operation "${this.operation}" is not allowed for your role`;
  }
}

// ── State errors (4xx) ─────────────────────────────────

export class InvalidStateTransitionError extends SyncPointError {
  readonly code = "INVALID_STATE_TRANSITION";
  readonly httpStatus = 409;
  readonly retryable = false;
  readonly suggestion: string;

  constructor(
    readonly entity: string,
    readonly fromState: string,
    readonly toState: string,
  ) {
    super(`Invalid ${entity} transition: ${fromState} → ${toState}`);
    this.suggestion = `Check if the entity has already been transitioned by another operation. Refresh the current state and retry.`;
  }
  get userMessage(): string {
    return `Cannot change "${this.entity}" from ${this.fromState} to ${this.toState}`;
  }
}

// ── Validation errors (4xx) ────────────────────────────

export class ValidationError extends SyncPointError {
  readonly code = "VALIDATION_ERROR";
  readonly httpStatus = 400;
  readonly retryable = false;
  readonly suggestion: string;

  constructor(
    readonly field: string,
    readonly issue: string,
  ) {
    super(`Validation error: ${field} — ${issue}`);
    this.suggestion = `Fix the "${this.field}" field and retry.`;
  }
  get userMessage(): string {
    return `Invalid value for "${this.field}": ${this.issue}`;
  }
}

// ── Database errors (5xx) ──────────────────────────────

export class DatabaseError extends SyncPointError {
  readonly code = "DATABASE_ERROR";
  readonly httpStatus = 500;
  readonly retryable = true;
  readonly suggestion = "The operation may succeed if retried. If the problem persists, check the database integrity.";

  constructor(
    readonly operation: string,
    readonly cause?: unknown,
  ) {
    const msg = cause instanceof Error ? cause.message : String(cause ?? "unknown error");
    super(`Database error during ${operation}: ${msg}`);
  }
  get userMessage(): string {
    return "An internal database error occurred. The operation may be retried.";
  }
}

// ── Timeout errors (5xx) ───────────────────────────────

export class OperationTimeoutError extends SyncPointError {
  readonly code = "OPERATION_TIMEOUT";
  readonly httpStatus = 504;
  readonly retryable = true;
  readonly suggestion: string;

  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`Operation "${operation}" timed out after ${timeoutMs}ms`);
    this.suggestion = "Increase the timeout or split the operation into smaller steps.";
  }
  get userMessage(): string {
    return `Operation "${this.operation}" timed out`;
  }
}

// ── Internal errors (5xx) ──────────────────────────────

export class InternalError extends SyncPointError {
  readonly code = "INTERNAL_ERROR";
  readonly httpStatus = 500;
  readonly retryable = false;
  readonly suggestion = "Please report this error to the SyncPoint maintainers.";

  constructor(readonly cause?: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause ?? "unknown error");
    super(`Internal error: ${msg}`);
  }
  get userMessage(): string {
    return "An unexpected internal error occurred";
  }
}
