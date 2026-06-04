# Contributing to SyncPoint

## Development Environment

### Prerequisites

- **Node.js 20+** (LTS)
- **pnpm 9+** (`npm install -g pnpm`)
- **SQLite** (bundled with better-sqlite3, no separate install needed)

### Setup

```bash
git clone https://github.com/MIK-HEAL/SyncPoint.git
cd SyncPoint
pnpm install
pnpm build
```

### Project Structure

```
SyncPoint/
├── docs/                  # Documentation
├── packages/
│   ├── syncpoint-core/    # Shared types, schemas, protocols
│   ├── syncpoint-server/  # Business logic, DB, tRPC, SSE
│   ├── syncpoint-cli/     # CLI commands
│   ├── syncpoint-mcp/     # MCP server for IDE integration
│   ├── syncpoint-sdk/     # Client SDK
│   └── vscode-extension/  # VS Code extension
└── TASK/                  # Task lists and plans
```

### Package Dependency Order

```
core ← server ← cli, mcp, sdk
```

When making changes, build in dependency order:

```bash
pnpm --filter syncpoint-core build
pnpm --filter syncpoint-server build
pnpm --filter syncpoint-cli build
# or build all:
pnpm build
```

## Code Conventions

### TypeScript

- Strict mode enabled (`strict: true`)
- No implicit returns (`noImplicitReturns: true`)
- ESLint + Prettier for formatting
- All new code requires type annotations on public APIs

### Naming

- Files: kebab-case (`resource-claim-service.ts`)
- Functions: camelCase (`createResourceClaim`)
- Types/Interfaces: PascalCase (`ResourceClaim`)
- Enums: PascalCase (`ResourceClaimStatus`)
- Constants: UPPER_SNAKE_CASE (`DEFAULT_CONFIG`)

### Imports

- Use `.js` extensions in import paths (for Node16 module resolution)
- Internal package imports use the package name: `import { ... } from "syncpoint-core"`
- Prefer named exports over default exports

### Error Handling

- Use typed errors from `syncpoint-core/src/errors.ts`
- Service functions throw typed errors; CLI/MCP layers format them for display
- Repository functions throw on not-found with meaningful messages

## Testing

### Running Tests

```bash
# All tests
pnpm test

# Specific package
pnpm --filter syncpoint-core test

# With coverage
pnpm --filter syncpoint-core test -- --coverage

# Watch mode
pnpm --filter syncpoint-core test -- --watch
```

### Writing Tests

- Framework: **Vitest** (configured at package level)
- Test files: `*.test.ts` alongside source files
- Use `describe`/`it` pattern from vitest
- Fixtures: create helper functions in test files for common setup
- Integration tests use a temporary SQLite database

### Coverage Goals

| Package | Target |
|---------|--------|
| syncpoint-core | ≥80% |
| syncpoint-server | ≥60% |
| syncpoint-cli | ≥60% |
| syncpoint-mcp | ≥60% |

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add resource scope refinement for function-level locking
fix: prevent zombie SSE connections from leaking memory
docs: add architecture overview
test: add conflict detector unit tests
refactor: extract path normalization to shared utility
```

### Commit Types

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Adding or fixing tests |
| `refactor` | Code restructuring without behavior change |
| `chore` | Build, CI, dependencies |
| `perf` | Performance improvement |

## Pull Requests

1. Create a feature branch from `main`
2. Make changes with clear commit messages
3. Run `pnpm build && pnpm test` to verify
4. Open a PR with a description of what changed and why
5. CI will run tests and coverage checks

## Getting Help

- Issues: https://github.com/MIK-HEAL/SyncPoint/issues
- Architecture: `docs/ARCHITECTURE.md`
- API Reference: `docs/API.md`
- Configuration: `docs/CONFIG.md`
