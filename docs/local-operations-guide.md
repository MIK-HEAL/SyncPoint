# SyncPoint Local Operations Guide

之前可以阅读mvp-showcase.md快速了解启动

这份文档面向“已经本地启动 SyncPoint，并且已经在编辑器里连接了几个模型”的实际使用场景。

SyncPoint 当前不是自动运行模型的 runtime，而是给多个编辑器 Agent / 模型提供同一套协作协议：

```text
Agent identity
Project Memory
Session roles
Task assignment
Checkpoint / Capsule
Review / Evidence / Approval Gate
Next Action Playbook
```

## 0. 命令入口

如果已经把 CLI 链接成 `syncpoint`，可以直接用：

```powershell
syncpoint --help
```

如果没有全局命令，Windows 本地开发时建议先设一个变量：

```powershell
cd <SYNCPOINT_ROOT>
$sp = "node <SYNCPOINT_ROOT>\packages\syncpoint-cli\dist\main.js"
```

后面示例里的：

```powershell
syncpoint xxx
```

都可以替换成：

```powershell
& $sp xxx
```

#### 如果刚刚不行可以用下面的方法
```powershell
$sp = "node"
& $sp "<SYNCPOINT_ROOT>\packages\syncpoint-cli\dist\main.js" init
```

```powershell
& node "<SYNCPOINT_ROOT>\packages\syncpoint-cli\dist\main.js" init
```


后面init替换为相对应的指令即可

也可以用下面的方法
下为设置powershell配置文件

```powershell
function syncpoint { node "<SYNCPOINT_ROOT>\packages\syncpoint-cli\dist\main.js" @args }
```
syncpoint后接指令


第一次在目标项目里使用：

```powershell
cd <YOUR_PROJECT_ROOT>
& $sp init
```

这会创建：

```text
.syncpoint/syncpoint.db
```

Project Memory 导出文件默认在：

```text
.syncpoint/project-memory.md
```

## 1. 现有主要命令

### 基础状态

```powershell
syncpoint init
syncpoint status
syncpoint server start --port 8765
```

本地服务启动后：

```text
http://127.0.0.1:8765/status
http://127.0.0.1:8765/events
```

### Agent / 模型身份

```powershell
syncpoint agent add --name <name> --provider <provider> --role <role>
syncpoint agent list
```

`provider` 常用值：
provider可以是同个。通过创建工作区的方式来区别(Vscode中通过workspace来创建多个独立区，可以参考pic,其中的示例图都是在workspace中实现)

```text
codex
claude-code
cursor
cline
copilot
human
other
```

`agent add --role` 是基础能力标签，常用值：

```text
manager
frontend
backend
tester
reviewer
other
```

注意：这里的 `role` 不是编排里的 Architect / Executor / Reviewer。编排角色在 `session assign-role` 里设置。

### Task

```powershell
syncpoint task create "实现登录模块" --description "包含 API、UI 和测试"
syncpoint task list
syncpoint task assign <taskId> --agent <agentId>
syncpoint task status <taskId> IN_PROGRESS
```

### Project Memory

```powershell
syncpoint knowledge add --category architecture --title "状态存储" --content "状态默认写入项目本地 .syncpoint/syncpoint.db"
syncpoint knowledge list
syncpoint knowledge approve <memoryId> --by user
syncpoint knowledge search "状态存储"
syncpoint knowledge export
```

### Pinned Memory

Pinned Memory 是高优先级规则，适合短小、强约束、当前阶段必须记住的内容。

```powershell
syncpoint memory set --key code-style --content "本项目第一版使用 TypeScript strict mode" --scope project
syncpoint memory list
```

区别：

```text
Project Memory = 长期项目知识，可审阅，可导出 .md
Pinned Memory  = 当前任务/项目的高优先级规则，进入 resume context
```

### Session / Agent 集群编排

```powershell
syncpoint session create --title "MVP 展示闭环" --architect <architectAgentId>
syncpoint session assign-role --session <sessionId> --agent <agentId> --role architect
syncpoint session assign-role --session <sessionId> --agent <agentId> --role executor
syncpoint session assign-role --session <sessionId> --agent <agentId> --role reviewer
syncpoint session assign-role --session <sessionId> --agent <agentId> --role owner
syncpoint session status --session <sessionId>
```

编排角色：

```text
architect = 负责理解用户目标、维护项目记忆、拆任务
executor  = 负责具体执行任务
reviewer  = 负责验收、证据、变更请求
owner     = 用户/产品负责人/最终确认者
```

### Playbook

Playbook 用来告诉每个 Agent 下一步该做什么。

```powershell
syncpoint playbook active-session --agent <agentId>
syncpoint playbook next-action --session <sessionId> --agent <agentId>
```

### Agent Loop

Agent 开始、恢复、保存进度、交接时用：

```powershell
syncpoint loop boot --agent <agentId> --task <taskId> --provider cursor
syncpoint loop resume --agent <agentId> --task <taskId> --provider cursor
syncpoint loop checkpoint --agent <agentId> --task <taskId> --summary "完成登录 API" --completed "..." --next-steps "..."
syncpoint loop handoff --task <taskId> --from <agentA> --to <agentB> --context "API 已完成，前端继续接 UI" --auto-accept
syncpoint loop status --agent <agentId>
```

### Review / Approval

```powershell
syncpoint session review --session <sessionId> --task <taskId> --reviewer <reviewerAgentId>
syncpoint session start-review --review <reviewId>

syncpoint review checklist-add --review <reviewId> --title "pnpm build 通过"
syncpoint review checklist-add --review <reviewId> --title "pnpm test 通过"
syncpoint review evidence-add --review <reviewId> --kind test --title "pnpm test" --content "All tests passed"
syncpoint review gate --review <reviewId>
syncpoint review approve --review <reviewId> --summary "证据完整，批准"
```

如果没通过：

```powershell
syncpoint review block --review <reviewId> --summary "测试未通过" --changes "修复失败用例后重新提交"
syncpoint review changes-address --change <changeRequestId>
```

## 2. 如何添加一个模型

“添加模型”在 SyncPoint 里分两层：

```text
1. 让编辑器模型连接 MCP server
2. 在 SyncPoint 里注册一个 Agent identity
```

### 2.1 连接 MCP server

MCP server 命令：

```powershell
node <SYNCPOINT_ROOT>\packages\syncpoint-mcp\dist\main.js
```

Cursor 示例 `.cursor/mcp.json`：

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

VS Code 示例 `.vscode/mcp.json`：

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

关键环境变量：

```text
SYNCPOINT_PROJECT_ROOT = 目标项目根目录
SYNCPOINT_DB_DIR       = 自定义 .syncpoint 目录位置
SYNCPOINT_MEMORY_PATH  = 自定义 project-memory.md 导出位置
```

### 2.2 注册模型为 Agent

每个模型都应该有独立 Agent ID。

```powershell
syncpoint agent add --name "codex-architect" --provider codex --role manager
syncpoint agent add --name "claude-executor" --provider claude-code --role backend
syncpoint agent add --name "cursor-reviewer" --provider cursor --role reviewer
syncpoint agent list
```

记录输出里的 `id`，后面分配 session role 时使用。

建议命名：

```text
<provider>-<role>
codex-architect
claude-executor
cursor-reviewer
human-owner
```

## 3. 如何修改 Agents 集群结构

当前集群结构不是写死在配置文件里，而是由 session 内的 role binding 决定。

### 3.1 标准三模型结构

```text
Architect  = 规划、项目记忆、任务拆解
Executor   = 执行任务
Reviewer   = 验收、证据、approval gate
```

创建：

```powershell
$session = syncpoint session create --title "登录模块 MVP" --architect <architectAgentId> --json | ConvertFrom-Json

syncpoint session assign-role --session $session.session.id --agent <executorAgentId> --role executor
syncpoint session assign-role --session $session.session.id --agent <reviewerAgentId> --role reviewer
syncpoint session status --session $session.session.id
```

### 3.2 加一个 Owner / 用户确认者

```powershell
syncpoint agent add --name "user-owner" --provider human --role manager
syncpoint session assign-role --session <sessionId> --agent <ownerAgentId> --role owner
```

Owner 适合确认：

```text
需求边界
架构方向
是否 approve project memory
是否接受 reviewer 的最终结论
```

### 3.3 多执行者结构

比如前端、后端两个 Executor：

```powershell
syncpoint agent add --name "frontend-executor" --provider cursor --role frontend
syncpoint agent add --name "backend-executor" --provider claude-code --role backend

syncpoint session assign-role --session <sessionId> --agent <frontendAgentId> --role executor
syncpoint session assign-role --session <sessionId> --agent <backendAgentId> --role executor
```

然后拆两个任务：

```powershell
syncpoint task create "实现登录 API" --description "后端接口、校验、测试"
syncpoint task create "实现登录 UI" --description "页面、表单、错误状态"

syncpoint session plan --session <sessionId> --task <apiTaskId> --assignee <backendAgentId>
syncpoint session plan --session <sessionId> --task <uiTaskId> --assignee <frontendAgentId>
```

### 3.4 替换某个 Agent

当前没有 `unassign-role` 命令。实际操作建议：

```text
小调整：给新 Agent 分配同样 role，并把后续任务 plan 给新 Agent
任务接力：用 loop handoff 从旧 Agent 交接给新 Agent
结构大改：cancel 当前 session，创建新 session
```

任务接力：

```powershell
syncpoint loop handoff --task <taskId> --from <oldAgentId> --to <newAgentId> --context "当前完成到 X，剩余 Y" --auto-accept
```

大改：

```powershell
syncpoint session cancel --session <sessionId>
syncpoint session create --title "新的协作结构" --architect <architectAgentId>
```

## 4. 如何创建 Project Memory

Project Memory 是用户和 Architect 沟通后沉淀的长期项目知识。

推荐流程：

```text
draft -> 用户/Architect 审阅 -> approve -> export markdown
```

### 4.1 新增一条记忆

```powershell
syncpoint knowledge add `
  --category architecture `
  --title "协作协议层优先" `
  --content "本项目核心不是自动 Agent runtime，而是 AI 编辑器里的多 Agent 协作协议层。" `
  --scope project `
  --tags "architecture,protocol" `
  --source human `
  --confidence high `
  --by user
```

这条记忆默认是 `draft`，不会立刻进入执行上下文。

### 4.2 审阅 draft

```powershell
syncpoint knowledge list --status draft
syncpoint knowledge show <memoryId>
```

### 4.3 批准进入上下文

```powershell
syncpoint knowledge approve <memoryId> --by user
```

只有 `approved` Project Memory 会进入 Agent 的项目上下文。

### 4.4 导出给用户查看

```powershell
syncpoint knowledge export
```

默认输出：

```text
.syncpoint/project-memory.md
```

打开：

```powershell
notepad .syncpoint\project-memory.md
```

自定义导出位置：

```powershell
syncpoint knowledge export --output <YOUR_PROJECT_ROOT>\PROJECT_MEMORY.md
```

或者：

```powershell
$env:SYNCPOINT_MEMORY_PATH = "<YOUR_PROJECT_ROOT>\PROJECT_MEMORY.md"
syncpoint knowledge export
```

### 4.5 常用分类

```text
overview      项目概览
architecture  架构原则
decision      已确认决策
convention    代码/协作约定
risk          风险
gotcha        踩坑
glossary      术语
file-map      文件地图
integration   外部集成
```

### 4.6 修改或废弃记忆

```powershell
syncpoint knowledge update <memoryId> --content "新的内容" --by user
syncpoint knowledge deprecate <memoryId> --by user
syncpoint knowledge export
```

## 5. 一次真实协作流程

### 5.1 注册模型

```powershell
syncpoint agent add --name "codex-architect" --provider codex --role manager
syncpoint agent add --name "claude-executor" --provider claude-code --role backend
syncpoint agent add --name "cursor-reviewer" --provider cursor --role reviewer
syncpoint agent list
```

假设得到：

```text
ARCH = <architectAgentId>
EXEC = <executorAgentId>
REV  = <reviewerAgentId>
```

### 5.2 创建项目记忆

```powershell
syncpoint knowledge add --category overview --title "项目定位" --content "SyncPoint 是本地多 Agent 协作协议层。" --confidence high --by user
syncpoint knowledge approve <memoryId> --by user
syncpoint knowledge export
```

### 5.3 创建 session

```powershell
syncpoint session create --title "MVP 操作验证" --architect <ARCH>
syncpoint session assign-role --session <sessionId> --agent <EXEC> --role executor
syncpoint session assign-role --session <sessionId> --agent <REV> --role reviewer
```

### 5.4 Architect 拆任务

```powershell
syncpoint task create "实现本地操作手册" --description "覆盖模型接入、集群结构、项目记忆"
syncpoint session plan --session <sessionId> --task <taskId> --assignee <EXEC>
syncpoint session advance --session <sessionId>
```

### 5.5 Executor 开始工作

```powershell
syncpoint session accept --assignment <assignmentId>
syncpoint session start --assignment <assignmentId>

syncpoint loop boot --agent <EXEC> --task <taskId> --provider claude-code
```

执行中保存进度：

```powershell
syncpoint loop checkpoint `
  --agent <EXEC> `
  --task <taskId> `
  --summary "完成操作手册初稿" `
  --completed "新增 docs/local-operations-guide.md" `
  --next-steps "交给 reviewer 验收"
```

完成 assignment：

```powershell
syncpoint session complete --assignment <assignmentId>
```

### 5.6 Reviewer 验收

```powershell
syncpoint session review --session <sessionId> --task <taskId> --reviewer <REV>
syncpoint session start-review --review <reviewId>

syncpoint review checklist-add --review <reviewId> --title "命令可执行"
syncpoint review checklist-add --review <reviewId> --title "Project Memory 流程完整"
syncpoint review checklist-add --review <reviewId> --title "Agent 集群修改路径清楚"

syncpoint review evidence-add --review <reviewId> --kind manual --title "文档检查" --content "已覆盖模型接入、session role、knowledge add/approve/export。"
syncpoint review checklist-pass --item <itemId1>
syncpoint review checklist-pass --item <itemId2>
syncpoint review checklist-pass --item <itemId3>

syncpoint review gate --review <reviewId>
syncpoint review approve --review <reviewId> --summary "操作文档可用于本地多模型协作体验"
syncpoint session advance --session <sessionId>
```

### 5.7 每个模型怎么知道自己下一步

```powershell
syncpoint playbook active-session --agent <agentId>
syncpoint playbook next-action --session <sessionId> --agent <agentId>
```

也可以让模型通过 MCP 调：

```text
syncpoint_active_session
syncpoint_session_playbook
syncpoint_context_prepare
syncpoint_project_memory_search
```

## 6. 给不同模型的启动提示词

### Architect

```text
你是 SyncPoint session 里的 Architect Agent。
你的 Agent ID 是：<ARCH>

开始前请先使用 SyncPoint MCP：
1. 读取 active session / session playbook
2. 读取 approved project memory
3. 根据用户目标拆分 task
4. 必要时创建 draft project memory，等待用户确认后 approve
5. 不要直接执行任务，执行交给 executor
```

### Executor

```text
你是 SyncPoint session 里的 Executor Agent。
你的 Agent ID 是：<EXEC>

开始前请先使用 SyncPoint MCP：
1. 读取 active session / next action
2. 准备 execute/resume context
3. 如果 context gate 不通过，先 checkpoint 或向 Architect 请求补充
4. 完成阶段性工作后写 checkpoint + context capsule
5. 完成后等待 reviewer 验收
```

### Reviewer

```text
你是 SyncPoint session 里的 Reviewer Agent。
你的 Agent ID 是：<REV>

开始前请先使用 SyncPoint MCP：
1. 读取 review packet
2. 创建 checklist
3. 收集 build/test/typecheck/manual evidence
4. 运行 approval gate
5. gate 通过才 approve；否则 request changes
```

## 7. MCP 能力速查

常用 resources：

```text
syncpoint://status
syncpoint://agents
syncpoint://tasks
syncpoint://project-memory
syncpoint://session/{sessionId}
syncpoint://active-session/{agentId}
syncpoint://session/{sessionId}/next-action/{agentId}
syncpoint://review/{reviewRequestId}/packet
```

常用 tools：

```text
syncpoint_project_memory_add
syncpoint_project_memory_approve
syncpoint_project_memory_search
syncpoint_project_memory_export

syncpoint_session_create
syncpoint_session_assign_role
syncpoint_session_plan_task
syncpoint_session_request_review
syncpoint_session_advance

syncpoint_loop_resume
syncpoint_loop_checkpoint
syncpoint_loop_handoff

syncpoint_review_checklist_add
syncpoint_review_evidence_add
syncpoint_review_gate
syncpoint_review_approve
syncpoint_review_block

syncpoint_active_session
syncpoint_next_action
```

常用 prompts：

```text
syncpoint_project_onboarding
syncpoint_architect_plan
syncpoint_executor_resume
syncpoint_review_task
syncpoint_review_with_evidence
syncpoint_session_playbook
syncpoint_memory_review
```

## 8. 当前限制

当前版本已经能完成本地多 Agent 协作 MVP，但还有几个边界：

```text
1. SyncPoint 不负责调用模型 API，不自动运行 Agent。
2. 多模型接入依赖编辑器/MCP 客户端实际调用工具。
3. session role 目前支持追加绑定，没有 unassign-role 命令。
4. Project Memory import/sync-file 还未实现，当前主要是 add/approve/export。
5. UI 面板不是当前主入口，CLI/MCP 是主要体验路径。
```

推荐操作方式：

```text
用户/Architect 先沉淀 Project Memory
Architect 创建 session 并拆任务
Executor 通过 loop boot/resume/checkpoint 执行
Reviewer 通过 review packet/evidence/gate 验收
Playbook 持续告诉每个 Agent 下一步
```
