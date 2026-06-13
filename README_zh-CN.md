<div align="center">

# SyncPoint

**在 agent 偏移变成合并冲突之前，将其拦截。**

面向共享资源的 AI agent 本地协调协议。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A59-orange?logo=pnpm)](https://pnpm.io/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![MCP](https://img.shields.io/badge/MCP-editor--agent%20ready-purple)](packages/syncpoint-mcp)

**[English](README.md)** · 中文

</div>

---

## 问题

AI 编码 agent 失败，不是因为它们写出了糟糕的代码——而是因为它们**基于不同的现实继续工作**。

- Agent A 持有 `shared-config.ts`。Agent B 照改不误。双方互不知情。
- 一个 checkpoint 过期了。另一个 agent 从过期的上下文恢复，基于已经不存在的假设写代码。
- 交接时丢失了前一个 agent 积累的阻塞项、风险和审查状态。
- 硬约束说"不要碰 auth 模块"。agent 照碰不误。没有任何东西能阻止它。

等你发现时，损害已经是一个合并冲突——或者更糟，是生产环境中静默的错误代码。

## SyncPoint 做什么

SyncPoint 在 agent 继续工作**之前**检查其继续路径是否安全。如果不安全，SyncPoint **阻断**——不是在 prompt 里加一个警告，而是创建一个 agent 无法跳过的硬协议门。

---

## 四个体验

### 1. 碰撞检测

两个 agent 声明要改同一个文件。SyncPoint 创建一个 SyncGate——一个双方都无法忽略的硬阻断。

```bash
# 启动服务
pnpm build && pnpm --filter syncpoint-server dev

# 终端 A — agent-a 独占声明一个文件
syncpoint claim src/shared-config.ts --agent agent-a --mode exclusive

# 终端 B — agent-b 也想声明同一个文件
syncpoint claim src/shared-config.ts --agent agent-b --mode exclusive
# → 被拦住。agent-b 能看到谁持有锁、为什么冲突。

# 查看状态
syncpoint status
# → 显示：agent-b 被阻塞，原因是 agent-a 独占了该文件
```

被阻塞的 agent 不只是收到一条错误消息。SyncPoint 创建了一个 **SyncGate**——一个双方都能看到的同步屏障。门保持打开状态，直到冲突被显式解决。任何一方都不能静默地继续。

### 2. 过期恢复检测

Agent-a 在任务中途做了 checkpoint。与此同时，agent-b 修改了相关依赖。当 agent-a 尝试恢复时，SyncPoint 检测到上下文已过期。

```bash
# agent-a 保存进度
syncpoint checkpoint --agent agent-a --summary "Auth 模块写了一半"

# ... 时间流逝，其他 agent 做了修改 ...

# agent-a 尝试恢复
syncpoint resume --agent agent-a

# SyncPoint 检查：
#   - checkpoint 是否仍然新鲜？
#   - 其他 agent 是否动了相关资源？
#   - 是否有新的约束或阻塞项？
#
# 如果过期 → 警告和阻塞项被注入恢复输出中。
# agent 看到："你之前的假设可能已经不成立了。"
```

没有 SyncPoint，agent 从过期的快照恢复，静默地产出基于已失效假设的代码。有 SyncPoint，过期问题在恢复边界就被捕获。

### 3. 结构化交接

Agent-a 完成了前端工作，交接给 agent-b 做后端。SyncPoint 传递的不只是一段文字摘要，而是一个完整的结构化状态。

```bash
# agent-a 交接给 agent-b
syncpoint loop handoff \
  --task <taskId> \
  --from agent-a \
  --to agent-b \
  --context "登录页面完成。API 用的是 JWT，token 过期时间 1h"

# agent-b 恢复时，收到：
#   ✓ 上下文快照（工作资源、已完成工作、阻塞项）
#   ✓ 约束状态（活跃规则、不可触碰范围）
#   ✓ 资源所有权（agent-a 声明了什么、释放了什么）
#   ✓ 未解决的门（待处理的同步义务）
```

交接不是"发个消息告诉你做了啥"。它是一个**结构化状态转移**——任务上下文、资源所有权、活跃约束、未解决的阻塞项，全部打包传递。接收方 agent 拿到的是一个完整的现实投影，而不是一段可能遗漏关键信息的自然语言摘要。

### 4. 硬约束

设置一个约束：任何 agent 都不准触碰受保护的范围。SyncPoint 在执行边界强制检查——不在 agent 的 prompt 里。

```bash
# 通过项目记忆添加硬约束
syncpoint project-memory add \
  --content "Auth 模块正在审计，禁止修改" \
  --kind hard_constraint \
  --applies-to '{"files":["src/auth/**"]}' \
  --severity blocking \
  --validator-type resource_forbidden

# 任何尝试声明或修改 src/auth/ 下文件的 agent 都会被拦住
syncpoint claim src/auth/middleware.ts --agent rogue-agent
# → 被 Constraint Evaluation 拦住

# 验证约束
syncpoint constraint check --action resume --task <taskId> --agent <agentId>
```

关键区别：约束存在于 SyncPoint 的执行层，而不是 agent 的 prompt 中。prompt 可以被忽略。SyncPoint 的约束**不能**。这就是"请不要碰这个"和"你在物理上无法碰这个"之间的区别。

---

## 快速开始

```bash
# 安装依赖并构建
pnpm install
pnpm build

# 在项目中初始化 SyncPoint
syncpoint init

# 运行演示——展示碰撞检测
syncpoint demo

# 停在阻塞状态以便检查
syncpoint demo --stage blocked
syncpoint status
```

不全局安装：

```bash
node packages/syncpoint-cli/dist/main.js demo
node packages/syncpoint-cli/dist/main.js status
```

## 声明 Agent

在 `.syncpoint/agents/` 中创建一个 manifest 文件即可自动注册 agent：

```yaml
# .syncpoint/agents/my-agent.yml
version: 1
name: my-agent
provider: auto_detect
profile: general
role: executor
```

```bash
syncpoint agent list       # 查看所有已声明的 agent
syncpoint agent diagnose   # 检查问题
```

## 编辑器集成

SyncPoint 通过 MCP 向编辑器 agent 暴露相同的协议。

### Cursor `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "syncpoint": {
      "command": "node",
      "args": ["<SYNCPOINT_REPO>/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_PROJECT_ROOT": "<YOUR_PROJECT_ROOT>"
      }
    }
  }
}
```

### VS Code `.vscode/mcp.json`

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["<SYNCPOINT_REPO>/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

## 工作原理

SyncPoint 通过五个协议原语强制执行边界：

| 原语 | 作用 |
|---|---|
| **ResourceClaim** | Agent 声明"我要动这些资源"——重叠的声明自动创建阻塞项 |
| **SyncGate** | 硬阻断——在门被解决之前不能继续 |
| **CheckpointReview** | 需要审批的 checkpoint——在另一个 agent 恢复之前必须通过 |
| **Operation** | 被跟踪的变更——在应用前检查所有权、冲突和约束 |
| **Wake** | 同步义务——通知 agent 去审查、批准或确认 |

核心循环：**暂停 → 同步 → 恢复**。

当 agent 尝试继续时，SyncPoint 检查：

- 工作资源是否与受保护范围重叠？→ 阻断
- 是否有未解决的所有权冲突？→ 阻断
- 是否有未关闭的门或待处理的审查？→ 阻断
- checkpoint 是否过期？→ 阻断

如果一切干净，agent 继续。否则，具体的阻塞项会被呈现，附带原因和解除阻塞的方法。

## SyncPoint 不是什么

| 它不是 | 原因 |
|---|---|
| Agent 运行器 | 不调用模型 API，不运行自主循环 |
| 工作流构建器 | 不构建 DAG 或可视化流程 |
| 文件锁守护进程 | 协议级强制，非操作系统级（参见[强制设计](docs/system-file-lock-design.md)） |
| 记忆产品 | 项目记忆服务于同步，不是通用召回 |

**SyncPoint 是 agent 在继续工作之前调用的那一层。**

## 仓库结构

```text
packages/
├── syncpoint-kernel         # 纯类型、验证器、状态机、错误定义
├── syncpoint-context        # 记忆、现实投影、上下文策略
├── syncpoint-governance     # 约束评估、checkpoint 审查、唤醒引擎
├── syncpoint-adapters       # Agent manifest、协商、编排、运行时
├── syncpoint-core           # 门面——重新导出 kernel、context、governance、adapters
├── syncpoint-server         # 应用服务、SQLite、tRPC、SSE
├── syncpoint-cli            # 运维 CLI
├── syncpoint-mcp            # 面向编辑器 AI agent 的 MCP 适配器
├── syncpoint-sdk            # 用于集成的类型化客户端
├── syncpoint-plugin-generic-agent  # 通用资源插件
└── vscode-extension         # Sync View 面板
```

依赖顺序：`kernel → context → governance → adapters → core → server → cli, mcp, sdk`

## 技术栈

| 层 | 技术 |
|---|---|
| 语言 | TypeScript |
| 运行时 | Node.js |
| 包管理 | pnpm workspaces |
| 数据库 | SQLite + Drizzle ORM |
| API | tRPC |
| 验证 | Zod |
| 测试 | Vitest |
| 编辑器集成 | MCP + VS Code 扩展 |

## 文档

| 文档 | 适用场景 |
|---|---|
| [`docs/core-synchronization.md`](docs/core-synchronization.md) | 协议原语和不变量 |
| [`docs/reality-runtime.md`](docs/reality-runtime.md) | 分层现实架构 |
| [`docs/constraint-runtime.md`](docs/constraint-runtime.md) | 约束评估规则和强制机制 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 层边界和代码放置指南 |
| [`docs/beyond-code.md`](docs/beyond-code.md) | SyncPoint 用于非代码资源 |
| [`docs/local-operations-guide.md`](docs/local-operations-guide.md) | 使用 CLI、MCP、服务器运维 SyncPoint |
| [`docs/migration-guide.md`](docs/migration-guide.md) | 迁移到基于 manifest 的 agent 注册 |

## 示例

| 场景 | 目录 | 展示内容 |
|---|---|---|
| 文件冲突 | [`examples/conflict`](examples/conflict) | 两个 agent 声明同一文件——被阻断 |
| 过期恢复 | [`examples/stale-resume`](examples/stale-resume) | 从过期 checkpoint 恢复——收到警告 |
| 交接 | [`examples/handoff`](examples/handoff) | agent 间的结构化上下文传递 |
| 审查门 | [`examples/review-gate`](examples/review-gate) | checkpoint 需要审批——被阻断 |

交互式版本：运行 `syncpoint demo`。

---

<div align="center">

**SyncPoint 帮助多个 AI agent 停下来、对齐、然后安全地继续。**

</div>
