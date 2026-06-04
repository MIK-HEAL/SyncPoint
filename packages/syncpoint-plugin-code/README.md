# syncpoint-plugin-code

SyncPoint first-party plugin — file resource ownership, code patch operations, and validators.

Extends SyncPoint with code-specific capabilities: AST-aware function boundaries, line-range drift tracking, and syntax-aware validation.

## Usage

```typescript
import {
  parseFunctions,
  normalizePath,
  matchesConstraintPattern,
} from "syncpoint-plugin-code";

// Find function boundaries in source code
const functions = parseFunctions(sourceCode, "typescript");
// [{ name: "login", start: 10, end: 45 }, ...]
```

📖 See [docs/plugin-api.md](../docs/plugin-api.md) for plugin development.
