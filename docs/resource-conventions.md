# Resource Locator and Metadata Conventions

SyncPoint's resource system is type-agnostic. This document standardizes how `ResourceRef` fields and `appliesTo` scoping should be used across resource types.

---

## ResourceRef Fields

Every resource in SyncPoint is addressed by a `ResourceRef`:

```ts
interface ResourceRef {
  type: string;      // resource type identifier
  locator: string;   // type-specific address
  metadata: string;  // optional type-specific metadata
  id?: string;       // optional stable ID
}
```

### Conventions per resource type

| Type | `locator` format | `metadata` examples | Notes |
|---|---|---|---|
| `file` | Relative path from project root | `""` (usually empty) | Supports prefix/glob overlap via `pathsOverlap` |
| `binary_asset` | Relative path from project root | `"1920x600 PNG"`, `"vector logo"` | Same path semantics as `file`, but distinct type for domain clarity |
| `db_table` | `schema.table` or `table` | `"postgresql"`, `"sqlite"` | Overlap: exact match or wildcard `schema.*` |
| `api_endpoint` | `METHOD /path` or `/path` | `"v2"`, `"internal"` | Overlap: path prefix matching |
| `config_key` | Dot-notation key, e.g. `auth.session.timeout` | `"env:production"` | Overlap: prefix matching |
| `image_region` | `path#x,y,w,h` or `path#named-region` | `"layer:background"`, `"1920x1080 PNG"` | Locator = image path + region selector. Overlap: same image path with intersecting regions |
| `video_range` | `path#start-end` (timecodes, e.g. `clip.mp4#00:01:30-00:02:45`) | `"track:audio"`, `"1080p H.264"` | Locator = video path + time range. Overlap: same video path with overlapping time ranges |
| `audio_segment` | `path#start-end` (timecodes, e.g. `podcast.wav#00:05:00-00:10:00`) | `"track:vocals"`, `"44.1kHz stereo"` | Locator = audio path + time range. Overlap: same audio path with overlapping time segments |

### Rules

1. **`type` must be a non-empty lowercase string** — use snake_case (`binary_asset`, not `BinaryAsset`).
2. **`locator` must be a non-empty string** — the primary address for the resource.
3. **`metadata` is freeform** — use it for human-readable context, not for addressing. The protocol never uses metadata for overlap detection or conflict resolution.
4. **`id` is optional** — use for stable identity when the locator may change (e.g. database primary key for a resource that gets renamed).

### Overlap detection

Core uses `resourceLocatorsOverlap(a, b)` for conflict detection:

- If a `ResourceMatcher` is registered for the type → delegates to `locatorsOverlap(a, b)`
- If no matcher is registered → **exact string equality** on `locator`
- Different `type` values **never overlap** (e.g. a `file` claim and a `binary_asset` claim for the same path are independent)

---

## appliesTo Scoping (Project Memory)

Project Memory entries use `appliesTo` to restrict which task contexts they are relevant to. The field is a JSON object with scope fields:

```json
{
  "files": ["src/auth/**", "src/session.ts"],
  "modules": ["core", "auth"]
}
```

### Registered scope fields

| Field | Registered by | Match semantics | Example |
|---|---|---|---|
| `files` | `_scope-matchers.ts` (server) | Prefix/glob overlap | `"src/**"` matches `"src/auth.ts"` |
| `modules` | `_scope-matchers.ts` (server) | Prefix/glob overlap | `"core"` matches `"core"` |

### How appliesTo matching works

1. `parseAppliesTo(raw)` parses the JSON string into `{ files?: string[], modules?: string[], ... }`.
2. For each field with patterns, `isRelevantToContext` checks if any pattern overlaps with the current context via registered `ScopeMatcher`s.
3. If **no scope fields** are present → the memory applies to all contexts (project-wide).
4. If **any scope field matches** → the memory is relevant.
5. If **scope fields exist but none match** → the memory is excluded from projection.

### Adding custom scope fields

Plugins can register scope matchers for new fields:

```ts
import { registerScopeMatcher, getScopeMatcher } from "syncpoint-core";

if (!getScopeMatcher("tables")) {
  registerScopeMatcher({
    field: "tables",
    findOverlaps(patterns: string[], targets: string[]): string[] {
      return targets.filter(t =>
        patterns.some(p => t === p || t.startsWith(p + "."))
      );
    },
  });
}
```

Then project memory entries can use:

```json
{
  "tables": ["users", "sessions.*"]
}
```

### Relationship between ResourceRef.type and appliesTo fields

These are **independent systems**:

- `ResourceRef.type` determines **claim overlap** detection (via `ResourceMatcher`)
- `appliesTo` fields determine **projection scoping** (via `ScopeMatcher`)

They often align (file resource claims ↔ `files` scope), but are not required to. A `binary_asset` claim does not automatically interact with `appliesTo.files` scoping — they serve different purposes:

| System | Question it answers | Extension point |
|---|---|---|
| `ResourceRef` + `ResourceMatcher` | "Do these two claims conflict?" | `registerResourceMatcher()` |
| `appliesTo` + `ScopeMatcher` | "Is this memory relevant to the current context?" | `registerScopeMatcher()` |

---

## Future Considerations

- **Typed capsule resources**: Currently `workingResources` on context capsules is a freeform comma-separated string. A future enhancement would store `ResourceRef[]` to carry type information, eliminating the `type: "file"` default assumption in constraint evaluation.
- **Metadata schema per type**: The `metadata` field is currently unstructured. If structured metadata becomes valuable (e.g. image dimensions for layout constraint checking), plugins could register metadata schemas per resource type.
- **Cross-type constraints**: Currently, different resource types never conflict. If needed, a `CrossTypeMatcher` could be introduced for cases like "a `file` resource claim on `db/schema.sql` should conflict with a `db_table` claim on `users`."
