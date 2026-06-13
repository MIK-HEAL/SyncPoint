import { describe, it, expect } from "vitest";
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
} from "../src/errors.js";

// ── Inheritance chain ────────────────────────────────────

describe("SyncPointError hierarchy", () => {
  it("SyncPointError extends Error", () => {
    const base = new (class extends SyncPointError {
      readonly code = "TEST";
      readonly httpStatus = 418;
      readonly retryable = false;
      readonly suggestion: string | undefined;
      get userMessage(): string { return "test"; }
      constructor() { super("test"); this.name = "TestError"; this.suggestion = "try again"; }
    })();
    expect(base).toBeInstanceOf(Error);
    expect(base).toBeInstanceOf(SyncPointError);
    expect(base.name).toBe("TestError");
  });

  const errorClasses = [
    { name: "ResourceConflictError", Ctor: ResourceConflictError, args: ["src/a.ts", "agent-1"], code: "RESOURCE_CONFLICT", httpStatus: 409, retryable: true },
    { name: "ResourceNotFoundError", Ctor: ResourceNotFoundError, args: ["agent-42"], code: "RESOURCE_NOT_FOUND", httpStatus: 404, retryable: false },
    { name: "ConstraintViolationError", Ctor: ConstraintViolationError, args: [["no-delete"], "src/a.ts"], code: "CONSTRAINT_VIOLATION", httpStatus: 403, retryable: false },
    { name: "UnauthorizedError", Ctor: UnauthorizedError, args: [], code: "UNAUTHORIZED", httpStatus: 401, retryable: false },
    { name: "ForbiddenError", Ctor: ForbiddenError, args: ["write", "not allowed"], code: "FORBIDDEN", httpStatus: 403, retryable: false },
    { name: "InvalidStateTransitionError", Ctor: InvalidStateTransitionError, args: ["Task", "DRAFT", "APPROVED"], code: "INVALID_STATE_TRANSITION", httpStatus: 409, retryable: false },
    { name: "ValidationError", Ctor: ValidationError, args: ["name", "required"], code: "VALIDATION_ERROR", httpStatus: 400, retryable: false },
    { name: "DatabaseError", Ctor: DatabaseError, args: ["insert"], code: "DATABASE_ERROR", httpStatus: 500, retryable: true },
    { name: "OperationTimeoutError", Ctor: OperationTimeoutError, args: ["sync", 5000], code: "OPERATION_TIMEOUT", httpStatus: 504, retryable: true },
    { name: "InternalError", Ctor: InternalError, args: ["oops"], code: "INTERNAL_ERROR", httpStatus: 500, retryable: false },
  ] as const;

  for (const { name, Ctor, args, code, httpStatus, retryable } of errorClasses) {
    describe(name, () => {
      const instance = new (Ctor as any)(...(args as any[]));

      it("extends SyncPointError", () => {
        expect(instance).toBeInstanceOf(SyncPointError);
      });

      it("has correct code", () => {
        expect(instance.code).toBe(code);
      });

      it("has correct httpStatus", () => {
        expect(instance.httpStatus).toBe(httpStatus);
      });

      it("has correct retryable", () => {
        expect(instance.retryable).toBe(retryable);
      });

      it("has a non-empty userMessage", () => {
        expect(instance.userMessage).toBeTruthy();
        expect(typeof instance.userMessage).toBe("string");
      });

      it("has suggestion (string or undefined)", () => {
        expect(
          instance.suggestion === undefined || typeof instance.suggestion === "string"
        ).toBe(true);
      });

      it("has message that is a string", () => {
        expect(typeof instance.message).toBe("string");
        expect(instance.message.length).toBeGreaterThan(0);
      });

      it("has name matching constructor name", () => {
        expect(instance.name).toBe(name);
      });
    });
  }
});

// ── Specific error property tests ─────────────────────────

describe("ResourceConflictError properties", () => {
  it("stores resourcePath and claimedBy", () => {
    const err = new ResourceConflictError("src/app.ts", "agent-7");
    expect(err.resourcePath).toBe("src/app.ts");
    expect(err.claimedBy).toBe("agent-7");
    expect(err.userMessage).toContain("src/app.ts");
    expect(err.userMessage).toContain("agent-7");
  });
});

describe("ResourceNotFoundError properties", () => {
  it("stores resourceId", () => {
    const err = new ResourceNotFoundError("task-123");
    expect(err.resourceId).toBe("task-123");
  });
});

describe("ConstraintViolationError properties", () => {
  it("stores violatedRules and resourcePath", () => {
    const err = new ConstraintViolationError(["no-delete", "size-limit"], "src/foo.ts");
    expect(err.violatedRules).toEqual(["no-delete", "size-limit"]);
    expect(err.resourcePath).toBe("src/foo.ts");
    expect(err.userMessage).toContain("no-delete");
  });
});

describe("ForbiddenError properties", () => {
  it("stores operation and reason", () => {
    const err = new ForbiddenError("delete", "read-only mode");
    expect(err.operation).toBe("delete");
    expect(err.reason).toBe("read-only mode");
  });
});

describe("InvalidStateTransitionError properties", () => {
  it("stores entity, fromState, toState", () => {
    const err = new InvalidStateTransitionError("Operation", "DRAFT", "APPLIED");
    expect(err.entity).toBe("Operation");
    expect(err.fromState).toBe("DRAFT");
    expect(err.toState).toBe("APPLIED");
  });
});

describe("ValidationError properties", () => {
  it("stores field and issue", () => {
    const err = new ValidationError("email", "invalid format");
    expect(err.field).toBe("email");
    expect(err.issue).toBe("invalid format");
  });
});

describe("DatabaseError properties", () => {
  it("stores operation name", () => {
    const err = new DatabaseError("migration");
    expect(err.operation).toBe("migration");
  });

  it("handles Error cause", () => {
    const cause = new Error("table locked");
    const err = new DatabaseError("query", cause);
    expect(err.message).toContain("table locked");
  });

  it("handles string cause", () => {
    const err = new DatabaseError("query", "disk full");
    expect(err.message).toContain("disk full");
  });
});

describe("OperationTimeoutError properties", () => {
  it("stores operation and timeoutMs", () => {
    const err = new OperationTimeoutError("sync-gate", 30000);
    expect(err.operation).toBe("sync-gate");
    expect(err.timeoutMs).toBe(30000);
  });
});

describe("InternalError properties", () => {
  it("stores cause", () => {
    const cause = new Error("boom");
    const err = new InternalError(cause);
    expect(err.cause).toBe(cause);
  });

  it("handles undefined cause", () => {
    const err = new InternalError();
    expect(err.message).toContain("unknown error");
  });
});
