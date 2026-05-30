# 用户注册使用体验优化任务清单

## 背景结论

基于 [`start.md`](start.md) 的方向与当前仓库实现，SyncPoint 现在已经具备两套“Agent 描述”能力，但用户注册体验仍然偏底层：

- 当前 VS Code 扩展仍以命令式注册为主，用户需要通过 [`syncpoint.registerAgent`](packages/vscode-extension/src/extension.ts:598) 手工输入名称、Provider、Role，然后调用 [`client.agent.create.mutate()`](packages/vscode-extension/src/extension.ts:612)。
- 服务端的基础注册接口仍是最小字段模型，只接受 [`name/provider/role`](packages/syncpoint-server/src/routers/agent-router.ts:7)，缺少声明式文件入口、批量导入和自动发现能力。
- CLI 的 [`syncpoint init`](packages/syncpoint-cli/src/main.ts:40) 只负责初始化 [`.syncpoint/`](packages/syncpoint-server/src/db.ts:190) 和数据库，不会生成 Agent 模板、团队模板或引导式 onboarding。
- 系统已经存在一套面向升级方向的 [`AgentManifestSchema`](packages/syncpoint-core/src/agent-manifest.ts:51) 与 [`manifestUpsert()`](packages/syncpoint-server/src/application/escalation-routing-service.ts:32) 能力，但它们主要服务于升级路由，不是“用户加入系统”的主入口。

结论：当前实现更像“先创建数据库中的 Agent 记录，再手工补能力”，而不是“用户创建一个声明文件，系统自动接纳”。这与 [`start.md`](start.md) 提出的“文件系统即注册中心”存在明显落差。

---

## 当前注册体验的主要问题

### 1. 注册入口仍是命令，不是声明

问题：

- 用户必须理解“注册动作”本身，而不是只需描述 Agent。
- 扩展命令式表单与 CLI API 绑定，无法通过仓库文件完成团队协作、复制模板、版本管理。

影响：

- 首次使用心智负担高。
- 团队成员配置无法通过 Git 审查与复用。

### 2. Manifest 存在，但没有成为唯一真理源

问题：

- [`packages/syncpoint-core/src/agent-manifest.ts`](packages/syncpoint-core/src/agent-manifest.ts) 里的 manifest 更偏运行时能力描述。
- 缺少面向用户的 YAML/JSON 文件规范、样例、目录约定与解析入口。

影响：

- “Agent 注册”与“Agent 能力描述”是分裂的两条链路。
- 后续做自动发现、团队模板、批量导入时会重复建模。

### 3. 缺少零步注册的自动发现机制

问题：

- 扩展激活流程 [`activate()`](packages/vscode-extension/src/extension.ts:566) 目前只注册视图、命令与文件保护，没有监听 [`.syncpoint/agents/`](start.md:54) 目录。
- 服务端启动也没有扫描 manifest 目录并同步注册中心。

影响：

- 用户每新增一个 Agent 都需要额外操作。
- 仓库内声明与运行时状态不能自动对齐。

### 4. 初始化流程没有完成“新手闭环”

问题：

- [`syncpoint init`](packages/syncpoint-cli/src/main.ts:40) 只创建目录和数据库。
- 没有顺手生成示例 Agent、团队模板、README 指引或 onboarding wizard。

影响：

- 用户初始化后仍不知道下一步做什么。
- 首次成功路径不连续，流失点高。

### 5. 缺少注册中心可视化与查询闭环

问题：

- 虽然服务端已有 [`agentManifestRouter`](packages/syncpoint-server/src/router.ts:23) 和 [`manifestList()`](packages/syncpoint-server/src/application/escalation-routing-service.ts:57)，但缺少明确的 CLI/扩展体验来回答“有哪些 Agent、谁在线、谁可处理什么任务”。

影响：

- 用户即使注册成功，也感知不到系统如何使用这些 Agent。
- Manifest 的价值无法被直接看见。

---

## 优化目标

1. 把“注册 Agent”改造成“声明 Agent”。
2. 把 [`.syncpoint/agents/`](start.md:54) 升级为官方注册中心目录。
3. 让 CLI、Server、VS Code Extension 共用同一套 manifest schema 和同步逻辑。
4. 让新用户在 1 分钟内完成 init → 生成 manifest → 自动发现 → 可视化确认。
5. 让团队可以通过 Git 管理 Agent 配置，并支持批量导入与模板复用。

---

## 分阶段任务清单

## Phase 1：定义统一的 Agent Manifest 基线

- [x] 在 [`packages/syncpoint-core/src/agent-manifest.ts`](packages/syncpoint-core/src/agent-manifest.ts) 基础上拆分“运行时 manifest”与“用户声明 manifest”，明确面向文件的 schema。
- [x] 支持 YAML/JSON 两种输入格式，统一约定目录为 [`.syncpoint/agents/`](start.md:54)。
- [x] 为用户声明 schema 增加可读字段：`name`、`profile`、`provider`、`role`、`tags`、`capabilities`、`availability`、`autoStart`、`notes`。
- [x] 定义 schema 版本字段，如 `version: 1`，为后续演进保留兼容空间。
- [x] 提供最小样例文件，如 [`executor-jack.yml`](start.md:56) 对应的仓库模板。
- [x] 为 manifest schema 增加单元测试：合法样例、缺失字段、默认值补齐、兼容旧结构。

验收标准：

- 任何一个用户都可以只靠一个 YAML 文件完整描述一个 Agent。
- CLI、Server、扩展对同一 manifest 的解析结果一致。

## Phase 2：构建文件系统注册中心与自动同步链路

- [x] 在 server 侧新增 manifest loader/service，负责扫描 [`.syncpoint/agents/`](start.md:54) 目录并解析文件。
- [x] 在 server 启动时执行一次初始化扫描，把声明式 manifest 同步为运行时 Agent + Agent Manifest。
- [x] 增加 upsert 规则：文件已存在则更新；文件删除则标记离线或移出活跃清单。
- [x] 建立文件路径与 Agent ID 的映射规则，避免重名导致重复注册。
- [x] 为失败场景提供明确错误：YAML 语法错误、字段非法、重复标识、无效 provider。
- [x] 为扫描/同步流程增加测试：首次导入、热更新、删除、坏文件容错。

验收标准：

- 用户把 manifest 文件放进目录后，无需执行额外注册命令即可在系统中看到 Agent。
- 服务端重启后可从目录恢复完整注册状态。

## Phase 3：把 VS Code 扩展从“注册按钮”升级为“自注册观察者”

- [x] 在 [`activate()`](packages/vscode-extension/src/extension.ts:566) 中加入 [`vscode.workspace.createFileSystemWatcher`](start.md:75) 监听 [`.syncpoint/agents/*.yml`](start.md:75) 与 JSON 文件。
- [x] 新文件创建时，触发 manifest 同步并显示轻量通知，例如“检测到新成员，已自动纳入协作网络”。
- [x] 文件修改时，自动刷新 Sync View，避免用户手动点刷新。
- [x] 文件删除时，将对应 Agent 标记为离线或从面板移除。
- [x] 重构 [`syncpoint.registerAgent`](packages/vscode-extension/src/extension.ts:598)：从“直接写数据库”改为“生成 manifest 文件”。
- [x] 新增侧边栏入口“添加新成员”，底层仍然只生成声明文件，不直接调用 [`agent.create`](packages/syncpoint-server/src/routers/agent-router.ts:7)。

验收标准：

- 扩展中不再把“注册”作为核心动作，而是把“创建 manifest”作为核心动作。
- 用户修改 YAML 后能立即在视图中看到同步结果。

## Phase 4：补齐 CLI 新手闭环与批量导入体验

- [x] 升级 [`syncpoint init`](packages/syncpoint-cli/src/main.ts:42)，可选生成 [`.syncpoint/agents/`](start.md:54) 目录、示例 manifest、团队模板。
- [x] 新增 `syncpoint agent init` 命令，用问答式流程生成单个 manifest 文件。
- [x] 新增 `syncpoint agent import` 或 `syncpoint team init`，支持批量生成多角色模板。
- [x] 新增 `syncpoint agent validate`，在写入前校验 YAML/JSON 是否符合 schema。
- [x] 新增 `syncpoint agent sync`，用于无编辑器场景下手动触发重新扫描。
- [x] 更新 CLI 帮助文案，让“创建文件即注册”成为默认叙述。

验收标准：

- 新用户执行一次 `syncpoint init` 后，可以直接得到可工作的 manifest 示例。
- 不使用 VS Code 的用户也能顺畅完成注册与同步。

## Phase 5：提供注册中心可视化、查询与可观测性

- [x] 在 CLI 新增 `syncpoint agent list`，展示 manifest 来源、状态、能力、标签、最近同步时间。
- [x] 在扩展 Sync View 中增加“Agent Registry”或在现有 Agent 区域显式展示 manifest 元数据。
- [x] 区分“文件存在但解析失败”“已导入但离线”“运行中”等状态。
- [x] 增加诊断输出：哪一个文件导入失败、失败原因是什么、如何修复。
- [x] 在状态栏或输出面板增加 watcher 日志，提升系统可理解性。

验收标准：

- 用户可以直接回答“哪些 Agent 已声明、哪些可用、哪些异常”。
- 注册失败时不需要读源码即可定位问题。

## Phase 6：文档与迁移方案

- [x] 更新 [`README.md`](README.md) 的 Quick Start，把“手工注册 Agent”改为“创建 manifest → 自动发现”。
- [x] 在 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 补充“文件系统即注册中心”的架构说明。
- [x] 为现有命令式注册模式提供兼容期说明：哪些 API 保留、哪些标记 deprecated。
- [x] 编写迁移指南：如何把数据库中已有 Agent 转换为 manifest 文件。
- [x] 增加面向团队协作的示例目录结构与最佳实践。

验收标准：

- 新文档的默认路径不再要求用户先理解底层 API。
- 老用户有明确迁移路径，不会因模型变化失去现有数据。

---

## 实施优先级建议

### P0：本周必须完成

1. 统一用户态 Agent Manifest Schema。
2. Server 启动扫描 [`.syncpoint/agents/`](start.md:54) 并同步注册中心。
3. CLI 生成 manifest 模板。

### P1：随后完成

1. VS Code watcher 自动同步。
2. `syncpoint.registerAgent` 改造成 manifest 生成器。
3. `syncpoint agent list` 查询体验。

### P2：增强项

1. 团队模板与批量导入。
2. manifest 迁移工具。
3. A2A 风格 Agent Card 导出与外部互操作。

---

## 建议的实现原则

- 单一真理源：以 [`.syncpoint/agents/`](start.md:54) 下的 manifest 文件为准，数据库是投影，不是源头。
- 先声明后同步：用户动作应尽量落在文件创建/修改，而不是 RPC 调用。
- CLI、扩展、服务端共用 schema 与 parser，避免三套语义分叉。
- 渐进兼容：保留现有 [`agent.create`](packages/syncpoint-server/src/routers/agent-router.ts:7) 作为内部兼容层，但不再作为主推荐入口。
- 可诊断：所有自动发现流程必须伴随清晰日志与错误回显。

---

## 最终判断

围绕用户注册体验，当前项目最值得优先优化的不是继续包装“自动执行注册命令”，而是把“注册”整体重定义为“声明文件被系统发现并接纳”。

只要把 [`.syncpoint/agents/`](start.md:54) 做成真正的注册中心，再补齐 watcher、CLI 模板和 registry 查询，SyncPoint 的用户接入体验就会从“数据库驱动的专家工具”变成“仓库驱动的零步协作入口”。
