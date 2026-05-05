# SyncPoint — Layer Boundary Principles

Where does new code go? Use this decision tree before creating a new file
or adding logic to an existing one.

## Four Layers

| Layer | Location | Responsibility | May import |
|-------|----------|---------------|------------|
| **Protocol rule** | `syncpoint-core/src/` | Pure functions, types, state machines, validation. No I/O. | nothing outside core |
| **Use case / state transition** | `syncpoint-server/src/application/` | Orchestrates repo calls, enforces invariants, emits events. One public function ≈ one use case. | core, repositories, other services (sparingly) |
| **Read model / query aggregation** | `syncpoint-server/src/application/` (suffix: `-service.ts`) | Assembles cross-domain read views (e.g. `sync-status-service.ts`). No writes. | core, repositories, other services |
| **Transport adapter** | routers (`tRPC`), CLI commands, MCP tools, VS Code extension | Input validation → delegate to application layer → format output. **No business logic.** | application layer only |

## Rules of Thumb

1. **Router ≠ service.** If a router does more than validate input and call
   a service function, the logic belongs in `application/`.

2. **Judgment logic lives in one place.** "What counts as a blocker?" or
   "Is this agent blocked?" should be a shared helper or core function —
   never re-derived inline in two files.

3. **Cross-domain coordination goes through services, not direct repo
   calls.** If a function touches sessions *and* gates *and* wakes, it
   should be an application-layer service, not an inline block inside a
   router or CLI command.

4. **Core stays pure.** `syncpoint-core` must never import from `server`,
   `cli`, `mcp`, or `sdk`. If you need I/O, it belongs in `server`.

5. **Don't over-abstract.** One service per bounded context is enough.
   Facades, abstract factories, and "manager of managers" patterns are
   not welcome here.

## When Adding a New Capability (P11, P12, …)

Ask:

- Is this a **protocol rule** (pure logic, no DB)?  → `syncpoint-core`
- Is this a **write use case** (create/update state)?  → `application/*-service.ts`
- Is this a **read aggregation** (query + join + format)?  → `application/*-service.ts` (read model)
- Is this a **transport concern** (HTTP shape, CLI flags, MCP tool schema)?  → `routers/` or adapter layer

If unsure, default to `application/` — it's easier to push down to core
later than to extract up from a router.

## Reality Runtime Layers

SyncPoint's memory system is a five-layer executable runtime (see `docs/reality-runtime.md`):

| Layer | Purpose | Key files |
|-------|---------|-----------|
| **Project Memory** | Long-term reality source code | `project-memory.ts`, `project-memory-service.ts` |
| **Projection Layer** | Reality Compiler — scopes, traces, detects conflicts | `projection.ts`, `projection-service.ts` |
| **Context Capsule** | Agent's current task reality mirror | `capsule-context.ts`, `context-policy-service.ts` |
| **Protocol Gate** | Collaboration boundary (gates, transactions, claims) | `protocol-gate-service.ts`, `sync-gate-service.ts` |
| **Constraint Runtime** | Executable enforcement — blocks on violations | `constraint-runtime.ts`, `constraint-runtime-service.ts` |

**Key invariants**:

- Raw Project Memory content never reaches agent prompts — only compiled projections.
- `hard_constraint` / `protocol_rule` must enter gate/runtime, never capsule-only.
- Projection conflicts are always surfaced explicitly, never silently merged.
- Constraint evaluation is read-only; enforcement happens at entry points (`loopResume`, `orchStartAssignment`, `wakeStart`, `opCheck`).
