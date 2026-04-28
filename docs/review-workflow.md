# Review Workflow

SyncPoint v0.8 adds a review and approval layer on top of v0.7 orchestration.
It does not run agents automatically. It records what was reviewed, what
evidence supports the decision, and whether approval is blocked.

## Flow

```text
session review
  -> review checklist-add
  -> review evidence-add
  -> review gate
  -> review approve | review block
```

`review approve` writes both:

- an `approval_record`
- a v0.7 `ReviewDecision` with verdict `approved`

`review block` writes:

- an `approval_record` with decision `blocked`
- a v0.7 `ReviewDecision` with verdict `request-changes` or `rejected`
- an optional `change_request`

## Approval Gate

The gate is computed from checklist items, evidence, and change requests.
It is not persisted as a separate table in v0.8.

The gate is `PASSED` only when:

- all required checklist items are `PASSED` or `WAIVED`
- at least one evidence item exists
- there are no open change requests

The gate is `BLOCKED` when:

- a required checklist item is `OPEN` or `FAILED`
- no evidence has been recorded
- at least one change request is still `OPEN`

Only `PASSED` reviews can be approved.

## CLI

```bash
syncpoint session review \
  --session <sessionId> \
  --task <taskId> \
  --reviewer <reviewerAgentId> \
  --json

syncpoint review checklist-add \
  --review <reviewRequestId> \
  --title "Tests pass"

syncpoint review checklist-pass \
  --item <checklistItemId> \
  --notes "All tests pass"

syncpoint review evidence-add \
  --review <reviewRequestId> \
  --kind test \
  --title "pnpm test" \
  --content "23 test files, 282 tests passed"

syncpoint review gate --review <reviewRequestId>

syncpoint review approve \
  --review <reviewRequestId> \
  --summary "Approved with test evidence."
```

To request changes:

```bash
syncpoint review block \
  --review <reviewRequestId> \
  --summary "Missing coverage" \
  --changes "Add tests for error paths"

syncpoint review changes-address \
  --change <changeRequestId> \
  --evidence <evidenceId>
```

## MCP

The MCP server exposes the same workflow:

```text
syncpoint_review_checklist_add
syncpoint_review_checklist_update
syncpoint_review_evidence_add
syncpoint_review_evidence_list
syncpoint_review_changes_request
syncpoint_review_changes_address
syncpoint_review_gate
syncpoint_review_approve
syncpoint_review_block
syncpoint_review_packet
```

Review packet resource:

```text
syncpoint://review/{reviewRequestId}/packet
```

Review prompt:

```text
syncpoint_review_with_evidence
```

## Boundary

Review workflow delegates session state changes to the v0.7 orchestration
service. Checklist, evidence, change requests, and gate evaluation stay in
the v0.8 review workflow service.
