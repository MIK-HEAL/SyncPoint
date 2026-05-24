# P2 结构债务清理任务单

## 目标

在不保留旧 schema 兼容层的前提下，完成 P2 剩余结构债务清理，使核心业务关系尽量由数据库结构直接表达，并降低 `loop`、`orchestration`、`sync-gate`、`projection` 之间的直接扇出。

## 当前判断

- `project_memory` 数据模型重写：已完成
- schema 中 CSV / 原始 JSON 业务字段清理：部分完成
- 服务边界协作层收敛：尚未系统落地

## 已完成基础

### 已完成的结构归一化

- `sync_gate`
  - `sync_gate_required_agent`
  - `sync_gate_resource`
  - `sync_gate_related_claim`
  - `sync_gate_ack`
  - `sync_gate_vote`

- `checkpoint_review`
  - `checkpoint_review_approver`

- `operation`
  - `operation_resource`

### 已完成的验证基础

- typed surface 相关测试已补齐并通过
- explicit bootstrap 已恢复为显式初始化路径
- `pnpm -r typecheck` 已通过
- `pnpm -r test` 已通过

## P2 剩余任务

### 任务 A：清理 schema 中残留的 CSV / JSON 业务字段

#### A1. 优先清理 contract / snapshot / review / checkpoint 相关字段

- `packages/syncpoint-server/src/schema.ts`
  - `peer_contract.participants`
  - `peer_contract.responsibilities`
  - `peer_contract.interface_spec`
  - `peer_contract.file_boundaries`
  - `peer_contract.dependencies`
  - `checkpoint.changed_files`

- 配套 repository
  - `packages/syncpoint-server/src/repositories/contract-repository.ts`
  - `packages/syncpoint-server/src/repositories/resume-context-repository.ts`
  - `packages/syncpoint-server/src/repositories/checkpoint-repository.ts`

#### A2. 清理 review / permit / status 相关旧领域形状

- `packages/syncpoint-server/src/repositories/checkpoint-review-repository.ts`
  - 去掉领域上的 CSV 形状：
    - `requiredApproverIds`
    - `approvedByIds`
    - `rejectedByIds`
  - 直接改为 typed array / typed relation 输出

- `packages/syncpoint-server/src/schema.ts`
  - `write_permit.decision_json`
  - `operation.check_result`

- 配套 repository / service
  - `packages/syncpoint-server/src/repositories/write-permit-repository.ts`
  - `packages/syncpoint-server/src/application/checkpoint-review-service.ts`
  - `packages/syncpoint-server/src/application/write-permit-service.ts`
  - `packages/syncpoint-server/src/application/sync-status-service.ts`

#### A3. 评估哪些 JSON 字段属于“内部存储”而非本轮目标

以下字段需要逐个判断是否纳入本轮 breaking reset：

- `context_snapshot.payload_json`
- `sync_gate.policy_json`
- `agent_manifest.capabilities_json`
- `agent_manifest.escalation_preference_json`
- `agent_manifest.tags_json`
- `negotiation_session.config_json`
- `project_memory_fragment.metadata_json`

判定原则：

- 如果它只是 DB 内部持久化容器，且 public typed surface 已经稳定，可暂不处理
- 如果它仍在 repository / service 层形成业务依赖或阻碍约束表达，应纳入本轮拆分

### 任务 B：建立更清晰的服务协作层

#### B1. 先抽一层轻量 facade / coordinator

目标不是一次引入复杂事件总线，而是先把主流程中重复出现的跨服务编排收口。

优先考虑的切入点：

- `loop-service`
- `orchestration-service`
- `sync-gate-service`
- `reality-projection-service`
- `protocol-gate-service`
- `sync-status-service`

建议先抽一个轻量协作层，例如：

- `packages/syncpoint-server/src/application/collaboration-coordinator.ts`
- 或 `packages/syncpoint-server/src/application/workflow-facade.ts`

首批可收口的编排职责：

- 进入执行前的 blocker / gate / constraint 统一检查
- projection 构建与上下文准备的统一入口
- review / gate / wake 相关读模型组合
- loop / orchestration 对 protocol gate 的统一调用入口

#### B2. 降低核心服务之间的直接扇出

当前重点减少这些直接依赖：

- `loop -> sync-gate / protocol-gate / projection`
- `orchestration -> wake-engine / context-policy / sync-gate / projection`
- `sync-status -> sync-gate / resource-claim / checkpoint-review / operation / projection`

验收方向：

- 关键主流程不再在多个 service 中重复拼装依赖
- 调用链更短，单点更容易测试
- 后续协议扩展优先改 coordinator，而不是散落修改多个 service

## 建议执行顺序

### 阶段 1：先完成结构字段清理

1. `peer_contract` 相关字段去 JSON/列表串化
2. `checkpoint.changed_files` 去 JSON 字段依赖
3. `checkpoint_review` 领域输出改成 typed relation / array
4. `write_permit.decision` / `operation.check_result` 评估并改 typed 存储表达

### 阶段 2：补验证矩阵

1. repository 层定向测试
2. `sync-status-service` 聚合读模型回归
3. `checkpoint-review` / `write-permit` / `resource-claim` 联动回归
4. workspace `typecheck` + `test`

### 阶段 3：再做协作层收敛

1. 抽 `facade` / `coordinator`
2. 先迁移 `loop` 和 `orchestration` 主流程
3. 再迁移 `sync-status` / `protocol-gate` 等聚合调用点
4. 保持 public API 不变，只收口内部协作链路

## 验收标准

### Schema / Repository

- 核心业务关系不再依赖 CSV string 表达
- 关键业务数组 / 关联关系优先由 join table 或 typed table 表达
- repository 不再承担“把业务关系从 CSV 反序列化回来”的兼容职责

### Application 协作层

- `loop` / `orchestration` / `sync-gate` / `projection` 的主流程调用链更短
- 至少有一个明确的 facade / coordinator 成为主要编排入口
- 新增协议或主流程扩展时，不再需要同时改多个核心 service

### 验证

- 定向 Vitest 测试通过
- `pnpm -r typecheck` 通过
- `pnpm -r test` 通过

## 风险与边界

### 不在本轮默认处理

- 纯内部存储字段但不影响 public typed surface 的列名债务
- 与当前 P2 无关的 CLI / MCP / VS Code extension 功能扩展
- 为兼容旧 schema 引入额外过渡层

### 处理原则

- 优先做 breaking reset，不保留旧形状兼容
- 先收敛 public/domain typed shape，再处理底层存储表达
- 先做高耦合、高收益节点，不平均用力

## 建议的首个实施批次

建议从以下组合开始：

1. `peer_contract` schema + repository typed 化
2. `checkpoint_review` 领域输出去 CSV 化
3. 对应测试补齐
4. 再进入 coordinator 抽取
