# SyncPoint Architecture Decisions

This document records the architectural choices that changed how SyncPoint is initialized, how its schema evolves, and how its tool surface is organized.

## Decision 1 — Prefer explicit initialization over import side effects

### Context

Early iterations allowed parts of the runtime to become ready as a side effect of importing modules. That made behavior harder to reason about:

- isolated imports could behave differently from full application startup
- tests could pass only because another import had already initialized global state
- plugin registration order became an implicit property of the import graph

### Decision

SyncPoint uses explicit bootstrap entrypoints for initialization-sensitive behavior.

Initialization must happen through a visible application step, not through hidden module loading. Services such as loop, operation, or constraint evaluation must behave consistently whether they are imported alone, used in tests, or reached through CLI/MCP/router adapters.

### Consequences

- initialization order is visible and testable
- importing a service no longer mutates unrelated global state
- future plugins or registries must document their bootstrap path instead of relying on transitive imports

## Decision 2 — Use schema breaking reset for structural debt removal

### Context

Several early tables stored business relationships as CSV or JSON blobs. That made the system fast to prototype, but it created long-term ambiguity:

- the database could not directly express core relationships
- repositories had to reconstruct typed meaning from raw strings
- compatibility layers encouraged old and new shapes to coexist for too long

Examples included approver lists, operation check payloads, and other business fields that were meaningful domain structure rather than opaque storage.

### Decision

When removing structural debt, SyncPoint prefers a breaking reset over keeping permanent compatibility layers inside the schema.

If a business relationship deserves first-class meaning, it should be represented directly in tables, join tables, or typed payload structures. Old CSV/JSON compatibility is not preserved inside the core storage model once the rewrite is accepted.

### Consequences

- repositories expose typed domain models instead of leaking storage-era encodings
- migrations stay simpler because the target shape is clear
- read/write paths are easier to audit because meaning lives in schema and repository boundaries, not ad hoc parsing code
- the cost is explicit: old persisted data may need reset or one-off migration work instead of indefinite dual-format support

## Decision 3 — Split MCP tools by domain instead of growing one monolithic surface

### Context

As SyncPoint grew, the MCP layer risked accumulating unrelated tools inside a single expanding module. That would make discovery, testing, and ownership harder:

- new tools would be added wherever there was room
- transport-level concerns would blur across resource claims, sync gates, context, memory, and review flows
- one large file would hide which bounded context actually owned the behavior

### Decision

SyncPoint organizes MCP tools by domain and keeps transport adapters thin.

Tool names remain stable for external consumers, but implementation should be grouped by bounded context. Each domain module owns its schemas, input normalization, and delegation to application services. The MCP root registers and aggregates those tools; it does not become the business-logic home.

### Consequences

- adding a new tool should usually touch one domain module plus central registration
- tests can target the correct domain surface without loading an oversized catch-all tool file
- the boundary between application logic and transport formatting stays clearer
- CLI, MCP, router, and editor adapters can evolve in parallel while still calling the same application-layer use cases

## What these decisions protect

Taken together, these decisions preserve three invariants:

1. runtime behavior should be explicit rather than accidental
2. durable data shape should represent business meaning directly
3. transport surfaces should mirror domain boundaries instead of hiding them

Those invariants are the maintainability baseline for future P3+ work.
