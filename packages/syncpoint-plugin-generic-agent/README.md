# syncpoint-plugin-generic-agent

> SyncPoint plugin for generic (non-code) resource ownership, multi-modal operation validation, and constraint enforcement.

## Overview

This plugin extends SyncPoint beyond code to support **any** resource type — design assets, documents, datasets, binary artifacts, and more. It registers:

- **ResourceMatchers** for `artifact`, `binary_asset`, `document`, `design_asset`, `dataset_slice`
- **OperationValidators** for `artifact_update`, `artifact_review`, `artifact_transform`, `asset_generate`, `asset_edit`
- **ConstraintRuleEvaluator** for `resource_forbidden` (blocks operations on protected resources)
- **ScopeMatchers** for `resources` and `assetTypes` appliesTo fields in Project Memory

## Resource Locator Convention

All generic resources use URI-style locators:

```
{scheme}://{path}#{fragment}
```

| Scheme | Example |
|---|---|
| `artifact` | `artifact://landing-page-design` |
| `binary` | `binary://assets/hero-banner.png` |
| `doc` | `doc://PRD-001#section=pricing` |
| `design` | `design://homepage-hero#layer=face` |
| `dataset` | `dataset://users-2024#filter=active` |

Overlap detection uses **path-prefix matching** (exact match or directory containment). Fragment-level overlap (spatial/temporal) is deferred to domain-specific plugins.

## Usage

```ts
import { registerGenericAgentPlugin } from "syncpoint-plugin-generic-agent";

// Call once at startup
registerGenericAgentPlugin();
```

The plugin is auto-registered in `syncpoint-server` via `_plugin-init.ts`.

### CLI

```bash
# Claim a generic resource
syncpoint claim "artifact://landing-page" --type artifact --agent designer --task t1

# Claim a binary asset
syncpoint claim "binary://assets/logo.png" --type binary_asset --agent optimizer --task t2
```

### Project Memory Constraints

```json
{
  "kind": "do_not_touch",
  "appliesTo": { "resources": ["binary://brand-logo.png"] },
  "severity": "blocking",
  "validatorType": "resource_forbidden"
}
```

This will block any operation that touches `binary://brand-logo.png`.

## Validators

| Validator | Check |
|---|---|
| `generic_claim_coverage` | Target resources must be covered by actor's active claims |
| `generic_no_hard_conflict` | No other actor holds an exclusive claim on target resources |
| `generic_payload_present` | Operation has payload or payloadRef (soft warning) |

## Development

```bash
# Run tests
pnpm --filter syncpoint-plugin-generic-agent test

# Type check
pnpm --filter syncpoint-plugin-generic-agent typecheck
```
