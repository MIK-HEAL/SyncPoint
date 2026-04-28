<div align="center">

# 🔄 SyncPoint

**Local Multi-Agent Collaboration Protocol**

*让多个 AI Agent 在本地项目中有序协作 — 共享状态、检查点、交接、审批，全部离线运行。*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥20-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-≥9-orange?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

</div>

---

## 💡 What is SyncPoint?

> **SyncPoint 不是一个运行模型的 runtime，而是为多个编辑器 AI Agent 提供统一的协作协议层。**

当你在 VS Code / Cursor 里同时使用多个 AI（Codex、Claude、Copilot…），它们彼此不知道对方在做什么。SyncPoint 解决这个问题：

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Codex      │    │  Claude     │    │  Cursor     │
│  (Architect)│    │  (Executor) │    │  (Reviewer) │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                 ┌────────▼────────┐
                 │   SyncPoint     │
                 │   Protocol      │
                 │                 │
                 │  • 身份注册      │
                 │  • 任务分配      │
                 │  • 进度检查点    │
                 │  • 上下文胶囊    │
                 │  • 交接/审批     │
                 │  • 项目记忆      │
                 └────────┬────────┘
                          │
                 ┌────────▼────────┐
                 │  SQLite (local) │
                 └─────────────────┘
```

---

## 🏗️ Architecture

```
packages/
├── syncpoint-core       # 协议类型、状态机、Zod schemas
├── syncpoint-server     # tRPC + Drizzle ORM + SQLite + SSE
├── syncpoint-cli        # Commander CLI 命令行工具
├── syncpoint-sdk        # Typed tRPC client + SSE listener
├── syncpoint-mcp        # MCP stdio adapter（连接编辑器 Agent）
└── vscode-extension     # VS Code/Cursor 侧边栏面板
```

| 模块 | 职责 | 核心技术 |
|------|------|----------|
| **Core** | 定义协议规则 | Zod, TypeScript |
| **Server** | 本地 API + 事件流 | tRPC, Drizzle, SQLite, SSE |
| **CLI** | 人类操作入口 | Commander.js |
| **SDK** | Agent 程序调用 | tRPC Client |
| **MCP** | 编辑器 AI 调用 | Model Context Protocol |
| **VS Code** | 可视化面板 | VS Code Extension API |

---

## 🚀 Quick Start

### 1. 安装与构建

```bash
git clone <repo-url> && cd syncpoint
pnpm install
pnpm build
pnpm typecheck && pnpm test   # 验证一切正常
```

### 2. 初始化项目

```bash
cd <your-project>
syncpoint init                 # 创建 .syncpoint/syncpoint.db
```

### 3. 注册 Agent

```bash
syncpoint agent add --name codex-arch --provider codex --role manager
syncpoint agent add --name claude-exec --provider claude-code --role backend
syncpoint agent add --name cursor-rev --provider cursor --role reviewer
```

### 4. 创建 Session 并分配角色

```bash
syncpoint session create --title "Build Auth Module" --architect <archId>
syncpoint session assign-role --session <sid> --agent <execId> --role executor
syncpoint session assign-role --session <sid> --agent <revId> --role reviewer
```

### 5. 一键体验完整流程

```bash
syncpoint demo mvp             # 生成完整的 session 示例到 .syncpoint/mvp-demo.md
```

---

## 🧠 Core Concepts

### 协作生命周期

```
注册 Agent → 创建 Session → 分配角色 → 拆分任务
    → Executor 执行 + Checkpoint → Reviewer 审批 → 完成
```

| 概念 | 说明 |
|------|------|
| **Session** | 一次协作会话，绑定多个 Agent 的角色（architect / executor / reviewer / owner） |
| **Task** | 具体工作项，有完整的状态机驱动 |
| **Checkpoint** | 进度快照 — 包含摘要、风险、阻塞点 |
| **Context Capsule** | 压缩的任务上下文，减少 token 消耗和上下文漂移 |
| **Handoff** | Agent 之间的结构化交接，附带上下文摘要 |
| **Peer Contract** | Agent 之间的协作协议（DRAFT → REVIEWING → APPROVED） |
| **Pinned Memory** | 高优先级规则（全局/项目/任务级别） |
| **Project Memory** | 长期项目知识库，可审阅、可导出为 `.md` |
| **Review Workflow** | Checklist + Evidence + Approval Gate |
| **Playbook** | 告诉每个 Agent「下一步该做什么」 |

---

## 🔀 State Machines

### Task 状态流转

```
OPEN → ASSIGNED → NEEDS_CONTRACT → CONTRACT_REVIEW → READY_TO_WORK → IN_PROGRESS
                                   ↘ NEEDS_CONTRACT (rejected)
IN_PROGRESS → NEEDS_SYNC | BLOCKED | REVIEWING → DONE
Any → CANCELLED
```

### Contract 驱动 Task

| Contract 事件 | Task 自动变为 |
|--------------|--------------|
| 创建 Contract | `NEEDS_CONTRACT` |
| 提交审阅 | `CONTRACT_REVIEW` |
| 审批通过 | `READY_TO_WORK` |
| 审批拒绝 | `NEEDS_CONTRACT` |

### Review Workflow

```
ChecklistItem:  OPEN → PASSED | FAILED | WAIVED
ChangeRequest:  OPEN → ADDRESSED | REJECTED | CANCELLED
ApprovalGate:   ✅ PASSED（当必选项完成 + 证据存在 + 无未关闭变更）
```

---

## 🔌 Connecting Editors (MCP)

SyncPoint 通过 **Model Context Protocol (MCP)** 让编辑器内的 AI 直接调用协议。

### Cursor — `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "syncpoint": {
      "command": "node",
      "args": ["<SYNCPOINT_ROOT>/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_PROJECT_ROOT": "<YOUR_PROJECT_ROOT>"
      }
    }
  }
}
```

### VS Code — `.vscode/mcp.json`

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["<SYNCPOINT_ROOT>/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `SYNCPOINT_PROJECT_ROOT` | 目标项目根目录 |
| `SYNCPOINT_DB_DIR` | 自定义数据库目录 |
| `SYNCPOINT_MEMORY_PATH` | 自定义 project-memory.md 导出位置 |

---

## 🖥️ Server

```bash
syncpoint server start --port 8765
```

| Endpoint | 说明 |
|----------|------|
| `http://127.0.0.1:8765/trpc/...` | tRPC API |
| `http://127.0.0.1:8765/events` | SSE 实时事件流 |
| `http://127.0.0.1:8765/status` | 健康检查 |

---

## 📡 API Overview (tRPC)

| Router | Procedures |
|--------|-----------|
| `agent` | `create` · `list` · `get` · `updateStatus` |
| `task` | `create` · `list` · `get` · `assign` · `updateStatus` |
| `checkpoint` | `create` · `list` |
| `handoff` | `create` · `accept` · `reject` |
| `contract` | `create` · `get` · `getForTask` · `updateStatus` |
| `capsule` | `create` · `list` · `getLatest` |
| `pinnedMemory` | `create` · `get` · `list` · `update` · `delete` |
| `resumeContext` | `get` · `enforce` |
| `event` | `list` |

---

## 🧪 Testing

```bash
pnpm test                                # 全部测试

pnpm --filter syncpoint-core test        # 28 state machine tests
pnpm --filter syncpoint-server test      # 51 unit + e2e tests
pnpm --filter syncpoint-vscode test      # 4 extension integration tests
```

---

## 📂 Database Location

SyncPoint 按以下优先级寻找数据库：

| 优先级 | 路径 |
|--------|------|
| 1️⃣ | `SYNCPOINT_DB_DIR` 环境变量 |
| 2️⃣ | 项目本地 `.syncpoint/syncpoint.db`（从 cwd 向上查找） |
| 3️⃣ | `~/.syncpoint/syncpoint.db`（全局 fallback） |

---

## 📚 Documentation

| 文档 | 说明 |
|------|------|
| [Local Operations Guide](docs/local-operations-guide.md) | 本地多模型操作完整指南 |
| [Session Playbook](docs/session-playbook.md) | 端到端 Session 流程 |
| [Review Workflow](docs/review-workflow.md) | 审阅 + 证据 + 审批门 |
| [MVP Showcase](docs/mvp-showcase.md) | 一键演示命令 |
| [CLI Agent Loop](docs/cli-agent-loop.md) | Agent 循环操作详解 |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.5 (strict) |
| API | tRPC v11 |
| Database | better-sqlite3 + Drizzle ORM |
| Validation | Zod |
| Events | Node EventEmitter + SSE |
| Testing | Vitest |
| Package Manager | pnpm workspace |
| Editor Integration | Model Context Protocol (MCP) |

---

## ⚡ TL;DR

```bash
pnpm install && pnpm build        # 构建
syncpoint init                     # 初始化
syncpoint demo mvp                 # 体验完整流程
```

---

<div align="center">

**SyncPoint** — 让你的 AI 军团协同作战，而非各自为政。

</div>
