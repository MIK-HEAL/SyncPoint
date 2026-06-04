/**
 * CLI commands for review workflow.
 */

import { Command } from "commander";
import {
  rwCreateChecklistItem,
  rwListChecklist,
  rwUpdateChecklistItem,
  rwAddEvidence,
  rwListEvidence,
  rwRequestChanges,
  rwAddressChange,
  rwListChangeRequests,
  rwEvaluateGate,
  rwApproveReview,
  rwBlockReview,
  rwPrepareReviewPacket,
} from "syncpoint-server/application";
import { listSessions, listReviewRequests } from "syncpoint-server/repositories";
import type { ChecklistItemStatus, EvidenceKind } from "syncpoint-core";

export function registerReviewCommands(program: Command): void {
  const review = program
    .command("review")
    .description("Manage review workflow — checklist, evidence, changes, approval");

  // ── checklist add ──────────────────────────────────
  review
    .command("checklist-add")
    .description("Add a checklist item to a review")
    .requiredOption("--review <id>", "Review request ID")
    .requiredOption("--title <text>", "Checklist item title")
    .option("--description <text>", "Item description")
    .option("--optional", "Mark as non-required")
    .option("--json", "Output JSON")
    .action((opts) => {
      const item = rwCreateChecklistItem({
        reviewRequestId: opts.review,
        title: opts.title,
        description: opts.description,
        required: !opts.optional,
      });
      if (opts.json) {
        console.log(JSON.stringify(item, null, 2));
      } else {
        console.log(`Checklist item added: ${item.id} [${item.status}] ${item.required ? "(required)" : "(optional)"}`);
        console.log(`  ${item.title}`);
      }
    });

  // ── checklist list ─────────────────────────────────
  review
    .command("checklist-list")
    .description("List checklist items for a review")
    .requiredOption("--review <id>", "Review request ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const items = rwListChecklist(opts.review);
      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        if (items.length === 0) {
          console.log("No checklist items.");
        } else {
          for (const i of items) {
            const req = i.required ? "REQ" : "OPT";
            console.log(`  [${i.status}] ${i.title} (${req}) — ${i.id}`);
          }
        }
      }
    });

  // ── checklist pass ─────────────────────────────────
  review
    .command("checklist-pass")
    .description("Mark a checklist item as PASSED")
    .requiredOption("--item <id>", "Checklist item ID")
    .option("--notes <text>", "Notes")
    .option("--json", "Output JSON")
    .action((opts) => {
      const item = rwUpdateChecklistItem(opts.item, "PASSED" as ChecklistItemStatus, { notes: opts.notes });
      if (opts.json) {
        console.log(JSON.stringify(item, null, 2));
      } else {
        console.log(`Checklist item PASSED: ${item.id}`);
      }
    });

  // ── checklist fail ─────────────────────────────────
  review
    .command("checklist-fail")
    .description("Mark a checklist item as FAILED")
    .requiredOption("--item <id>", "Checklist item ID")
    .option("--notes <text>", "Notes")
    .option("--json", "Output JSON")
    .action((opts) => {
      const item = rwUpdateChecklistItem(opts.item, "FAILED" as ChecklistItemStatus, { notes: opts.notes });
      if (opts.json) {
        console.log(JSON.stringify(item, null, 2));
      } else {
        console.log(`Checklist item FAILED: ${item.id}`);
      }
    });

  // ── evidence add ───────────────────────────────────
  review
    .command("evidence-add")
    .description("Add evidence to a review")
    .requiredOption("--review <id>", "Review request ID")
    .requiredOption("--kind <kind>", "Evidence kind: build|typecheck|test|lint|manual|diff|log|screenshot|note")
    .requiredOption("--title <text>", "Evidence title")
    .requiredOption("--content <text>", "Evidence content")
    .option("--metadata <json>", "Metadata JSON")
    .option("--json", "Output JSON")
    .action((opts) => {
      const ev = rwAddEvidence({
        reviewRequestId: opts.review,
        kind: opts.kind as EvidenceKind,
        title: opts.title,
        content: opts.content,
        metadataJson: opts.metadata,
        createdBy: "cli",
      });
      if (opts.json) {
        console.log(JSON.stringify(ev, null, 2));
      } else {
        console.log(`Evidence added: ${ev.id} [${ev.kind}] ${ev.title}`);
      }
    });

  // ── evidence list ──────────────────────────────────
  review
    .command("evidence-list")
    .description("List evidence for a review")
    .requiredOption("--review <id>", "Review request ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const list = rwListEvidence(opts.review);
      if (opts.json) {
        console.log(JSON.stringify(list, null, 2));
      } else {
        if (list.length === 0) {
          console.log("No evidence recorded.");
        } else {
          for (const e of list) {
            console.log(`  [${e.kind}] ${e.title} — ${e.id}`);
          }
        }
      }
    });

  // ── changes request ────────────────────────────────
  review
    .command("changes-request")
    .description("Request changes for a review")
    .requiredOption("--review <id>", "Review request ID")
    .requiredOption("--summary <text>", "Change summary")
    .option("--items <text>", "Change items")
    .option("--json", "Output JSON")
    .action((opts) => {
      const cr = rwRequestChanges({
        reviewRequestId: opts.review,
        summary: opts.summary,
        items: opts.items,
        requestedBy: "cli",
      });
      if (opts.json) {
        console.log(JSON.stringify(cr, null, 2));
      } else {
        console.log(`Change request created: ${cr.id} [${cr.status}]`);
        console.log(`  ${cr.summary}`);
      }
    });

  // ── changes address ────────────────────────────────
  review
    .command("changes-address")
    .description("Mark a change request as addressed")
    .requiredOption("--change <id>", "Change request ID")
    .option("--evidence <id>", "Link evidence ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const cr = rwAddressChange({
        changeRequestId: opts.change,
        evidenceId: opts.evidence,
        addressedBy: "cli",
      });
      if (opts.json) {
        console.log(JSON.stringify(cr, null, 2));
      } else {
        console.log(`Change request addressed: ${cr.id} [${cr.status}]`);
      }
    });

  // ── gate ───────────────────────────────────────────
  review
    .command("gate")
    .description("Evaluate approval gate for a review")
    .requiredOption("--review <id>", "Review request ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const gate = rwEvaluateGate(opts.review);
      if (opts.json) {
        console.log(JSON.stringify(gate, null, 2));
      } else {
        console.log(`Gate: ${gate.status}`);
        console.log(`  Checklist: ${gate.checklistPassed}/${gate.checklistTotal} passed, ${gate.checklistFailed} failed, ${gate.checklistWaived} waived, ${gate.checklistOpen} open`);
        console.log(`  Evidence: ${gate.evidenceCount}`);
        console.log(`  Open changes: ${gate.openChangeRequests}`);
        if (gate.reasons.length > 0) {
          console.log(`  Reasons: ${gate.reasons.join("; ")}`);
        }
      }
    });

  // ── approve ────────────────────────────────────────
  review
    .command("approve")
    .description("Approve a review (gate must be PASSED). Use --all --task <taskId> for batch approval.")
    .option("--review <id>", "Review request ID (single approval)")
    .option("--summary <text>", "Approval summary")
    .option("--all", "Approve all eligible reviews")
    .option("--task <taskId>", "Task ID filter for --all")
    .option("--session <sessionId>", "Session ID filter for --all")
    .option("--dry-run", "Show what would be approved without actually approving")
    .option("--json", "Output JSON")
    .action((opts) => {
      // ── Batch approval ──────────────────────────────
      if (opts.all) {
        const sessions = listSessions();
        const allReviewRequests: Array<{ id: string; taskId: string; sessionId: string; status: string }> = [];

        for (const session of sessions) {
          if (opts.session && session.id !== opts.session) continue;
          try {
            const reviews = listReviewRequests(session.id);
            for (const r of reviews) {
              if (opts.task && (r as any).taskId !== opts.task) continue;
              // Only approve PENDING or IN_PROGRESS reviews
              if ((r as any).status !== "PENDING" && (r as any).status !== "IN_PROGRESS") continue;
              allReviewRequests.push({
                id: r.id,
                taskId: (r as any).taskId ?? "",
                sessionId: session.id,
                status: (r as any).status,
              });
            }
          } catch { /* session may not have reviews */ }
        }

        if (allReviewRequests.length === 0) {
          const filterDesc = opts.task ? ` for task ${opts.task}` : "";
          console.log(`No eligible review requests found${filterDesc}.`);
          return;
        }

        if (opts.dryRun) {
          if (opts.json) {
            console.log(JSON.stringify({ dryRun: true, count: allReviewRequests.length, reviews: allReviewRequests }, null, 2));
          } else {
            console.log(`Would approve ${allReviewRequests.length} review(s):`);
            for (const r of allReviewRequests) {
              console.log(`  ${r.id} (task: ${r.taskId}, session: ${r.sessionId}) [${r.status}]`);
            }
          }
          return;
        }

        // Approve each eligible review
        const approved: string[] = [];
        const failed: Array<{ id: string; error: string }> = [];
        for (const r of allReviewRequests) {
          try {
            // Evaluate gate first
            const gate = rwEvaluateGate(r.id);
            if (gate.status === "BLOCKED") {
              failed.push({ id: r.id, error: `Gate is BLOCKED: ${gate.reasons.join("; ")}` });
              continue;
            }
            const result = rwApproveReview({
              reviewRequestId: r.id,
              summary: opts.summary ?? `Batch approved${opts.task ? ` for task ${opts.task}` : ""}`,
              decidedBy: "cli",
            });
            approved.push(result.approvalRecord.id);
          } catch (e) {
            failed.push({ id: r.id, error: (e as Error).message });
          }
        }

        if (opts.json) {
          console.log(JSON.stringify({
            total: allReviewRequests.length,
            approved: approved.length,
            failed: failed.length,
            approvedIds: approved,
            failures: failed,
          }, null, 2));
        } else {
          console.log(`Batch approve complete: ${approved.length}/${allReviewRequests.length} approved`);
          if (approved.length > 0) {
            console.log(`  ✅ Approved: ${approved.join(", ")}`);
          }
          if (failed.length > 0) {
            console.log(`  ❌ Failed:`);
            for (const f of failed) {
              console.log(`     ${f.id}: ${f.error}`);
            }
          }
        }
        return;
      }

      // ── Single approval ────────────────────────────
      if (!opts.review) {
        console.error("Either --review <id> or --all is required.");
        console.error("Run 'syncpoint review approve --help' for usage.");
        process.exitCode = 1;
        return;
      }
      const result = rwApproveReview({
        reviewRequestId: opts.review,
        summary: opts.summary ?? "Approved via CLI",
        decidedBy: "cli",
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Review approved: ${result.approvalRecord.id}`);
        console.log(`  Gate: ${result.gate.status}`);
      }
    });

  // ── block ──────────────────────────────────────────
  review
    .command("block")
    .description("Block a review with optional change request")
    .requiredOption("--review <id>", "Review request ID")
    .requiredOption("--summary <text>", "Block summary")
    .option("--changes <text>", "Requested changes")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = rwBlockReview({
        reviewRequestId: opts.review,
        summary: opts.summary,
        requestedChanges: opts.changes,
        decidedBy: "cli",
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Review blocked: ${result.approvalRecord.id}`);
        if (result.changeRequest) {
          console.log(`  Change request: ${result.changeRequest.id}`);
        }
      }
    });

  // ── packet ─────────────────────────────────────────
  review
    .command("packet")
    .description("Prepare full review packet for a reviewer")
    .requiredOption("--review <id>", "Review request ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const packet = rwPrepareReviewPacket(opts.review);
      if (opts.json) {
        console.log(JSON.stringify(packet, null, 2));
      } else {
        console.log(`Review Packet: ${packet.reviewRequest.id}`);
        console.log(`  Gate: ${packet.gate.status}`);
        console.log(`  Checklist: ${packet.checklistItems.length} items`);
        console.log(`  Evidence: ${packet.evidence.length} entries`);
        console.log(`  Changes: ${packet.changeRequests.length} requests`);
        console.log(`  Approvals: ${packet.approvalRecords.length} records`);
        if (packet.context) {
          console.log(`  Context: ${packet.context.intent}/${packet.context.role}`);
        }
      }
    });
}
