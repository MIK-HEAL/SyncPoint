import { describe, it, expect } from "vitest";
import {
  AgentStatus,
  TaskStatus,
  ContractStatus,
  HandoffStatus,
  AGENT_TRANSITIONS,
  TASK_TRANSITIONS,
  CONTRACT_TRANSITIONS,
  validateAgentTransition,
  validateTaskTransition,
  validateContractTransition,
  InvalidTransition,
} from "../src/states.js";

describe("AgentStatus transitions", () => {
  it("allows IDLE → RUNNING", () => {
    expect(() => validateAgentTransition(AgentStatus.IDLE, AgentStatus.RUNNING)).not.toThrow();
  });

  it("rejects IDLE → DONE", () => {
    expect(() => validateAgentTransition(AgentStatus.IDLE, AgentStatus.DONE)).toThrow(InvalidTransition);
  });

  it("allows RUNNING → CHECKPOINT", () => {
    expect(() => validateAgentTransition(AgentStatus.RUNNING, AgentStatus.CHECKPOINT)).not.toThrow();
  });

  it("rejects DONE → RUNNING", () => {
    expect(() => validateAgentTransition(AgentStatus.DONE, AgentStatus.RUNNING)).toThrow(InvalidTransition);
  });

  it("every allowed transition passes validation", () => {
    for (const [from, targets] of Object.entries(AGENT_TRANSITIONS)) {
      for (const to of targets) {
        expect(() => validateAgentTransition(from as AgentStatus, to)).not.toThrow();
      }
    }
  });
});

describe("TaskStatus transitions", () => {
  it("allows OPEN → ASSIGNED", () => {
    expect(() => validateTaskTransition(TaskStatus.OPEN, TaskStatus.ASSIGNED)).not.toThrow();
  });

  it("allows OPEN → CANCELLED", () => {
    expect(() => validateTaskTransition(TaskStatus.OPEN, TaskStatus.CANCELLED)).not.toThrow();
  });

  it("allows ASSIGNED → IN_PROGRESS", () => {
    expect(() => validateTaskTransition(TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS)).not.toThrow();
  });

  it("allows ASSIGNED → NEEDS_CONTRACT", () => {
    expect(() => validateTaskTransition(TaskStatus.ASSIGNED, TaskStatus.NEEDS_CONTRACT)).not.toThrow();
  });

  it("rejects OPEN → IN_PROGRESS", () => {
    expect(() => validateTaskTransition(TaskStatus.OPEN, TaskStatus.IN_PROGRESS)).toThrow(InvalidTransition);
  });

  it("allows NEEDS_CONTRACT → CONTRACT_REVIEW", () => {
    expect(() => validateTaskTransition(TaskStatus.NEEDS_CONTRACT, TaskStatus.CONTRACT_REVIEW)).not.toThrow();
  });

  it("allows CONTRACT_REVIEW → READY_TO_WORK", () => {
    expect(() => validateTaskTransition(TaskStatus.CONTRACT_REVIEW, TaskStatus.READY_TO_WORK)).not.toThrow();
  });

  it("allows CONTRACT_REVIEW → NEEDS_CONTRACT (rejected)", () => {
    expect(() => validateTaskTransition(TaskStatus.CONTRACT_REVIEW, TaskStatus.NEEDS_CONTRACT)).not.toThrow();
  });

  it("allows READY_TO_WORK → IN_PROGRESS", () => {
    expect(() => validateTaskTransition(TaskStatus.READY_TO_WORK, TaskStatus.IN_PROGRESS)).not.toThrow();
  });

  it("rejects NEEDS_CONTRACT → IN_PROGRESS", () => {
    expect(() => validateTaskTransition(TaskStatus.NEEDS_CONTRACT, TaskStatus.IN_PROGRESS)).toThrow(InvalidTransition);
  });

  it("rejects CONTRACT_REVIEW → IN_PROGRESS", () => {
    expect(() => validateTaskTransition(TaskStatus.CONTRACT_REVIEW, TaskStatus.IN_PROGRESS)).toThrow(InvalidTransition);
  });

  it("rejects DONE → IN_PROGRESS", () => {
    expect(() => validateTaskTransition(TaskStatus.DONE, TaskStatus.IN_PROGRESS)).toThrow(InvalidTransition);
  });

  it("DONE has no outgoing transitions", () => {
    expect(TASK_TRANSITIONS[TaskStatus.DONE]).toEqual([]);
  });

  it("CANCELLED has no outgoing transitions", () => {
    expect(TASK_TRANSITIONS[TaskStatus.CANCELLED]).toEqual([]);
  });

  it("every allowed transition passes validation", () => {
    for (const [from, targets] of Object.entries(TASK_TRANSITIONS)) {
      for (const to of targets) {
        expect(() => validateTaskTransition(from as TaskStatus, to)).not.toThrow();
      }
    }
  });
});

describe("ContractStatus transitions", () => {
  it("allows DRAFT → REVIEWING", () => {
    expect(() => validateContractTransition(ContractStatus.DRAFT, ContractStatus.REVIEWING)).not.toThrow();
  });

  it("allows DRAFT → REJECTED", () => {
    expect(() => validateContractTransition(ContractStatus.DRAFT, ContractStatus.REJECTED)).not.toThrow();
  });

  it("rejects DRAFT → APPROVED", () => {
    expect(() => validateContractTransition(ContractStatus.DRAFT, ContractStatus.APPROVED)).toThrow(InvalidTransition);
  });

  it("allows REVIEWING → APPROVED", () => {
    expect(() => validateContractTransition(ContractStatus.REVIEWING, ContractStatus.APPROVED)).not.toThrow();
  });

  it("allows REVIEWING → REJECTED", () => {
    expect(() => validateContractTransition(ContractStatus.REVIEWING, ContractStatus.REJECTED)).not.toThrow();
  });

  it("allows REVIEWING → DRAFT", () => {
    expect(() => validateContractTransition(ContractStatus.REVIEWING, ContractStatus.DRAFT)).not.toThrow();
  });

  it("every allowed transition passes validation", () => {
    for (const [from, targets] of Object.entries(CONTRACT_TRANSITIONS)) {
      for (const to of targets) {
        expect(() => validateContractTransition(from as ContractStatus, to)).not.toThrow();
      }
    }
  });
});

describe("InvalidTransition", () => {
  it("has correct message format", () => {
    try {
      validateAgentTransition(AgentStatus.IDLE, AgentStatus.DONE);
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransition);
      expect((e as InvalidTransition).message).toContain("IDLE");
      expect((e as InvalidTransition).message).toContain("DONE");
    }
  });
});
