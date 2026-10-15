### 一、代码质量优点

| 方面 | 具体表现 |
|------|---------|
| ✅ 类型安全 | 全面使用 Zod 运行时验证（`ResourceRefSchema`, `SyncGateSchema` 等），TypeScript 类型导出完整 |
| ✅ 纯函数设计 | `evaluateWriteDecision`, `evaluateGateLiveness`, `resourceLocatorsOverlap` 都是纯函数，无副作用 |
| ✅ 插件系统 | 注册表模式（Map 存储），自动注册机制，防重复注册 |
| ✅ 数据库 | WAL 模式 + 网络文件系统回退，外键约束，忙等待超时 5 秒，内存映射 I/O 256MB |
| ✅ 错误处理 | 自定义错误层次结构（`SyncPointError`, `ResourceConflictError` 等） |

---

### 二、具体实现问题

#### 问题 1：SyncGate 状态机过于复杂

**代码位置**：`sync-gate.ts`

- **9 个状态**：`NEEDS_SYNC → SYNC_REQUESTED → PARTIALLY_ACKED → SYNC_ACKED → READY_TO_CONTINUE`，旁路 `ESCALATED/TIMED_OUT/BYPASS_REQUESTED/CANCELLED`
- **5 种策略**：`ALL_REQUIRED`, `QUORUM_ACK`, `MAJORITY_VETO`, `OWNER_OVERRIDE`, `HUMAN_REQUIRED`

**批评**：9 状态 × 5 策略 = 45 种组合，测试覆盖困难。99% 场景只需要 `ALL_REQUIRED`，其他 4 种增加了复杂度但可能很少使用。

#### 问题 2：用逗号分隔字符串存储 ID 列表（数据库反模式）

**代码位置**：`sync-gate-evaluate.ts:19-22`

```typescript
export function parseIdList(ids: string[] | string): string[] {
  if (Array.isArray(ids)) return ids.map(s => s.trim()).filter(s => s.length > 0);
  return ids.split(",").map(s => s.trim()).filter(s => s.length > 0);
}
```

**批评**：`sync_gate` 表的 `requiredAgentIds`, `ackedAgentIds` 是逗号分隔字符串。这导致：
- 查询性能差（无法利用索引）
- 数据完整性无法保证（外键约束失效）
- 没有防止重复 ID，没有验证 ID 格式

#### 问题 3：数据库迁移过多，说明 schema 不稳定

**代码位置**：`db-migrations.ts`

v0.2 就有 **11 个迁移函数**：
- `runPeerContractNormalizationMigration`
- `runAgentRegistryEntryMigration`
- `runAgentMessageMigration`
- `runFkIndexesMigration`
- `runQueryPathIndexesMigration`
- `runStateTransitionLogMigration`
- `runResourceScopeMigration`（添加 4 个列）
- `runContextSnapshotIncrementalMigration`（添加 4 个列）
- `runEventSeqMigration`
- `ensureRuntimeOnlyTables`

**批评**：大量 `ALTER TABLE` 添加列，典型的"设计时没想好，后期打补丁"。

#### 问题 4：WritePermit 评估逻辑冗长且有重复检查

**代码位置**：`write-permit.ts:131-168`

`evaluateWriteDecision` 函数长达 170 行，包含 7 个检查步骤：
1. resources 为空 → blocker
2. resource 格式 → blocker
3. blocking gates → blocker
4. conflicting exclusive claims → blocker
5. constraint runtime → blocker
6. operation authorized → blocker
7. claims covering all resources → blocker

**批评**：步骤 3 和 4 重叠（blocking gates 通常由 conflicting claims 创建），步骤 6 和 7 重叠（两种授权方式逻辑复杂）。

#### 问题 5：插件注册使用全局状态

**代码位置**：`syncpoint-plugin-code/src/index.ts`

```typescript
let _registered = false;
export function registerCodePlugin(): void {
  if (_registered) return;
  // ...
  _registered = true;
}
```

**批评**：全局状态 `_registered` 违反"无副作用"原则，测试时需要 `_resetCodePlugin()` 清除。

#### 问题 6：tRPC router 过于庞大

**代码位置**：`router.ts`

**25 个 router**：`agent`, `task`, `checkpoint`, `diary`, `handoff`, `contract`, `contextSnapshot`, `event`, `pinnedMemory`, `resumeContext`, `adapter`, `loop`, `projectMemory`, `wake`, `syncStatus`, `checkpointReview`, `constraint`, `syncGate`, `negotiation`, `agentManifest`, `agentRegistration`, `agentRegistry`, `fileAudit`, `write`, `guard`, `agentMessage`

**批评**：v0.2 就有 25 个 router，很多可能只对应 1-2 个 endpoint，维护成本高。

#### 问题 7：CLI 命令过多

**代码位置**：`cli/src/main.ts`

**19 个命令组**：`registerPrimitiveCommands`, `registerContextCommands`, `registerProjectMemoryCommands`, `registerAdapterCommand`, `registerLoopCommand`, `registerSessionCommands`, `registerReviewCommands`, `registerPlaybookCommands`, `registerSyncCommands`, `registerDemoCommands`, `registerFacadeCommands`, `registerConnectCommands`, `registerWatchCommands`, `registerWriteCommands`, `registerGuardCommands`, `registerTeamCommands`, `registerDevCommands`, `registerMessageCommands`, `registerAdminCommands`

**批评**：用户需要学习大量命令，复杂度接近 Git。

#### 问题 8：数据库连接全局单例

**代码位置**：`db.ts`

```typescript
let sqlite: Database.Database | null = null;
let _db: ReturnType<typeof drizzle> | null = null;
```

**批评**：全局单例，无法同时连接多个数据库，没有连接池，`closeDb()` 时其他模块可能还在使用。

#### 问题 9：EventBus 全局单例

**代码位置**：`main.ts`

```typescript
const bus = SyncPointEventBus.getInstance();
```

**批评**：测试时难以隔离，可能导致测试间状态污染。

#### 问题 10：函数解析器过度设计

**代码位置**：`syncpoint-kernel/src/index.ts` 导出

```typescript
export {
  parseFunctions,
  findFunctionAtLine,
  registerFunctionParseStrategy,
  getFunctionParseStrategy,
  getStrategyForExtension,
  clearFunctionParseStrategies,
} from "./function-parser.js";
```

**批评**：SyncPoint 定位是"通用资源协调"，不是"代码分析工具"。函数解析应该由外部工具（如 Tree-sitter）提供，而不是内置。

---

### 三、文档与代码差距

#### 问题 11：L0-L4 承诺未完全实现

**文档说**："L0-L4 渐进式防护"

**代码实际**：
- `file-audit.ts` → L0（审计）
- `write-permit.ts` → L1（写入许可）
- **L2-L4（编辑器硬保存、文件权限、OS 策略）在代码中未找到实现**

**批评**：文档承诺了 L0-L4，但代码只实现了 L0-L1，给用户错误期望。

#### 问题 12：v0.2 breaking change 无自动迁移

**README 说**："v0.2 introduces a breaking schema reset."

**代码实际**：大量 `ALTER TABLE`，但没有自动迁移机制，用户需要手动处理。

---

### 四、总结

| 维度 | 评价 |
|------|------|
| **类型安全** | ✅ 优秀（Zod + TypeScript） |
| **纯函数设计** | ✅ 优秀 |
| **插件系统** | ✅ 完善 |
| **数据库设计** | ✅ 合理（但迁移过多） |
| **状态机复杂度** | ❌ 过高（9 状态 × 5 策略） |
| **数据存储** | ❌ 反模式（逗号分隔 ID） |
| **全局状态** | ❌ 隐患（db/eventBus 单例） |
| **功能 scope** | ❌ 过大（25 router / 19 命令组） |
| **文档一致性** | ❌ 有差距（L0-L4 承诺） |

**客观评价**：这不是"烂代码"，而是"为了支持过多功能而变复杂的代码"。核心问题是功能 scope 太大，导致每个功能都无法做到极致简洁。 