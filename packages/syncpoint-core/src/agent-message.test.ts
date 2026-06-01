import { describe, it, expect } from "vitest";
import {
  AgentMessageKind,
  AgentMessageReadStatus,
  AgentMessageRequestStatus,
  AGENT_MESSAGE_REQUEST_TRANSITIONS,
  validateAgentMessageRequestTransition,
  AgentMessageSchema,
  AgentMessageCreateSchema,
  isRequestPending,
  isRequestExpired,
  isRequestEscalated,
  isRequestTimedOut,
  shouldRetry,
} from "./agent-message.js";

describe("AgentMessageKind", () => {
  it("has message / request / response", () => {
    expect(AgentMessageKind.MESSAGE).toBe("message");
    expect(AgentMessageKind.REQUEST).toBe("request");
    expect(AgentMessageKind.RESPONSE).toBe("response");
  });
});

describe("AgentMessageReadStatus", () => {
  it("has unread / read", () => {
    expect(AgentMessageReadStatus.UNREAD).toBe("unread");
    expect(AgentMessageReadStatus.READ).toBe("read");
  });
});

describe("AgentMessageRequestStatus", () => {
  it("has none / pending / responded / expired / escalated", () => {
    expect(AgentMessageRequestStatus.NONE).toBe("none");
    expect(AgentMessageRequestStatus.PENDING).toBe("pending");
    expect(AgentMessageRequestStatus.RESPONDED).toBe("responded");
    expect(AgentMessageRequestStatus.EXPIRED).toBe("expired");
    expect(AgentMessageRequestStatus.ESCALATED).toBe("escalated");
  });
});

describe("validateAgentMessageRequestTransition", () => {
  it("allows pending → responded", () => {
    expect(validateAgentMessageRequestTransition(
      AgentMessageRequestStatus.PENDING,
      AgentMessageRequestStatus.RESPONDED,
    )).toBe(true);
  });

  it("allows pending → expired", () => {
    expect(validateAgentMessageRequestTransition(
      AgentMessageRequestStatus.PENDING,
      AgentMessageRequestStatus.EXPIRED,
    )).toBe(true);
  });

  it("allows expired → pending (retry)", () => {
    expect(validateAgentMessageRequestTransition(
      AgentMessageRequestStatus.EXPIRED,
      AgentMessageRequestStatus.PENDING,
    )).toBe(true);
  });

  it("allows expired → escalated", () => {
    expect(validateAgentMessageRequestTransition(
      AgentMessageRequestStatus.EXPIRED,
      AgentMessageRequestStatus.ESCALATED,
    )).toBe(true);
  });

  it("rejects none as source", () => {
    expect(validateAgentMessageRequestTransition(
      AgentMessageRequestStatus.NONE,
      AgentMessageRequestStatus.PENDING,
    )).toBe(false);
  });

  it("rejects invalid transitions", () => {
    expect(validateAgentMessageRequestTransition(
      AgentMessageRequestStatus.RESPONDED,
      AgentMessageRequestStatus.PENDING,
    )).toBe(false);
    expect(validateAgentMessageRequestTransition(
      AgentMessageRequestStatus.ESCALATED,
      AgentMessageRequestStatus.PENDING,
    )).toBe(false);
  });

  it("transition table keys match non-NONE statuses", () => {
    const nonNone = Object.values(AgentMessageRequestStatus).filter(s => s !== AgentMessageRequestStatus.NONE);
    expect(Object.keys(AGENT_MESSAGE_REQUEST_TRANSITIONS).sort()).toEqual(nonNone.sort());
  });
});

describe("AgentMessageSchema", () => {
  const now = new Date().toISOString();

  it("parses a plain message with defaults", () => {
    const msg = AgentMessageSchema.parse({
      id: "m1",
      fromAgent: "agent-a",
      toAgent: "agent-b",
      createdAt: now,
    });
    expect(msg.kind).toBe(AgentMessageKind.MESSAGE);
    expect(msg.readStatus).toBe(AgentMessageReadStatus.UNREAD);
    expect(msg.requestStatus).toBe(AgentMessageRequestStatus.NONE);
    expect(msg.subject).toBe("");
    expect(msg.body).toBe("");
    expect(msg.threadRootId).toBeNull();
    expect(msg.replyToMessageId).toBeNull();
    expect(msg.retryCount).toBe(0);
  });

  it("parses a request message with expiresAt", () => {
    const expires = new Date(Date.now() + 60_000).toISOString();
    const msg = AgentMessageSchema.parse({
      id: "m2",
      fromAgent: "agent-a",
      toAgent: "agent-b",
      kind: AgentMessageKind.REQUEST,
      requestStatus: AgentMessageRequestStatus.PENDING,
      expiresAt: expires,
      createdAt: now,
    });
    expect(msg.kind).toBe(AgentMessageKind.REQUEST);
    expect(msg.requestStatus).toBe(AgentMessageRequestStatus.PENDING);
    expect(msg.expiresAt).toBe(expires);
  });

  it("parses a response message with replyToMessageId", () => {
    const msg = AgentMessageSchema.parse({
      id: "m3",
      fromAgent: "agent-b",
      toAgent: "agent-a",
      kind: AgentMessageKind.RESPONSE,
      replyToMessageId: "m2",
      threadRootId: "m2",
      createdAt: now,
    });
    expect(msg.kind).toBe(AgentMessageKind.RESPONSE);
    expect(msg.replyToMessageId).toBe("m2");
    expect(msg.threadRootId).toBe("m2");
  });
});

describe("AgentMessageCreateSchema", () => {
  it("accepts minimal plain message input", () => {
    const input = AgentMessageCreateSchema.parse({
      fromAgent: "agent-a",
      toAgent: "agent-b",
    });
    expect(input.kind).toBe(AgentMessageKind.MESSAGE);
    expect(input.expiresAt).toBeNull();
  });

  it("accepts request input with expiresAt", () => {
    const expires = new Date(Date.now() + 60_000).toISOString();
    const input = AgentMessageCreateSchema.parse({
      fromAgent: "agent-a",
      toAgent: "agent-b",
      kind: AgentMessageKind.REQUEST,
      expiresAt: expires,
    });
    expect(input.kind).toBe(AgentMessageKind.REQUEST);
    expect(input.expiresAt).toBe(expires);
  });
});

describe("isRequestPending", () => {
  it("returns true for pending request", () => {
    expect(isRequestPending({ kind: AgentMessageKind.REQUEST, requestStatus: AgentMessageRequestStatus.PENDING })).toBe(true);
  });

  it("returns false for non-request kind", () => {
    expect(isRequestPending({ kind: AgentMessageKind.MESSAGE, requestStatus: AgentMessageRequestStatus.NONE })).toBe(false);
  });

  it("returns false for non-pending request", () => {
    expect(isRequestPending({ kind: AgentMessageKind.REQUEST, requestStatus: AgentMessageRequestStatus.RESPONDED })).toBe(false);
  });
});

describe("isRequestExpired", () => {
  it("returns true for expired request", () => {
    expect(isRequestExpired({ kind: AgentMessageKind.REQUEST, requestStatus: AgentMessageRequestStatus.EXPIRED })).toBe(true);
  });

  it("returns false for pending request", () => {
    expect(isRequestExpired({ kind: AgentMessageKind.REQUEST, requestStatus: AgentMessageRequestStatus.PENDING })).toBe(false);
  });
});

describe("isRequestEscalated", () => {
  it("returns true for escalated request", () => {
    expect(isRequestEscalated({ kind: AgentMessageKind.REQUEST, requestStatus: AgentMessageRequestStatus.ESCALATED })).toBe(true);
  });

  it("returns false for expired request", () => {
    expect(isRequestEscalated({ kind: AgentMessageKind.REQUEST, requestStatus: AgentMessageRequestStatus.EXPIRED })).toBe(false);
  });
});

describe("isRequestTimedOut", () => {
  const past = new Date(Date.now() - 10_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();

  it("returns true when deadline passed and status is pending", () => {
    expect(isRequestTimedOut({
      kind: AgentMessageKind.REQUEST,
      requestStatus: AgentMessageRequestStatus.PENDING,
      expiresAt: past,
    })).toBe(true);
  });

  it("returns true when deadline passed and status is expired", () => {
    expect(isRequestTimedOut({
      kind: AgentMessageKind.REQUEST,
      requestStatus: AgentMessageRequestStatus.EXPIRED,
      expiresAt: past,
    })).toBe(true);
  });

  it("returns false when deadline not passed", () => {
    expect(isRequestTimedOut({
      kind: AgentMessageKind.REQUEST,
      requestStatus: AgentMessageRequestStatus.PENDING,
      expiresAt: future,
    })).toBe(false);
  });

  it("returns false for non-request kind", () => {
    expect(isRequestTimedOut({
      kind: AgentMessageKind.MESSAGE,
      requestStatus: AgentMessageRequestStatus.NONE,
      expiresAt: past,
    })).toBe(false);
  });

  it("returns false when expiresAt is null", () => {
    expect(isRequestTimedOut({
      kind: AgentMessageKind.REQUEST,
      requestStatus: AgentMessageRequestStatus.PENDING,
      expiresAt: null,
    })).toBe(false);
  });

  it("returns false for responded request (already handled)", () => {
    expect(isRequestTimedOut({
      kind: AgentMessageKind.REQUEST,
      requestStatus: AgentMessageRequestStatus.RESPONDED,
      expiresAt: past,
    })).toBe(false);
  });
});

describe("shouldRetry", () => {
  it("returns true when retries remain", () => {
    expect(shouldRetry(0, 3)).toBe(true);
    expect(shouldRetry(2, 3)).toBe(true);
  });

  it("returns false when max reached", () => {
    expect(shouldRetry(3, 3)).toBe(false);
    expect(shouldRetry(5, 3)).toBe(false);
  });
});
