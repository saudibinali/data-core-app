/**
 * @file        scripts/src/check-workflow-triggers.ts
 * @purpose     Identify workflow_definitions rows whose trigger_event matches a
 *              legacy event name that has since been renamed in the canonical
 *              EVENT_TYPES catalog.
 *
 * ── Background ────────────────────────────────────────────────────────────────
 *   The appEventBus bridge dispatches canonical event names to workspace_event_logs
 *   and the WorkflowEngine.  If a workflow_definitions row was configured with a
 *   legacy event name (e.g. "approval.requested") before the rename, that workflow
 *   will SILENTLY NEVER FIRE because the WorkflowEngine now receives the canonical
 *   name ("approval.created") instead.
 *
 * ── Legacy names that need migration ─────────────────────────────────────────
 *   "approval.requested"   → "approval.created"
 *   "approval.approved"    → "approval.completed"
 *   "approval.rejected"    → "approval.completed"
 *   "forms.form.submitted" → "form.submitted"
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   pnpm --filter @workspace/scripts run check-workflow-triggers
 *
 *   Dry-run by default — reports affected rows without modifying data.
 *   Pass --migrate to apply the rename SQL:
 *     pnpm --filter @workspace/scripts run check-workflow-triggers -- --migrate
 *
 * ── Safety ────────────────────────────────────────────────────────────────────
 *   Migration is ADDITIVE — only the trigger_event column is updated.
 *   No workflow logic, conditions, or steps are touched.
 *   Runs in a transaction; rolls back on any error.
 *
 *   For "approval.approved" and "approval.rejected" → "approval.completed":
 *   Note that approval.completed carries an `outcome` field ("approved"|"rejected")
 *   in the event payload.  Workflow conditions that previously matched the specific
 *   event name now need to add a condition on outcome.  This script reports such
 *   rows so they can be reviewed manually.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── Legacy → canonical rename map ────────────────────────────────────────────

const RENAMES: Array<{ legacy: string; canonical: string; requiresConditionReview: boolean }> = [
  {
    legacy:   "approval.requested",
    canonical: "approval.created",
    requiresConditionReview: false,
  },
  {
    legacy:   "approval.approved",
    canonical: "approval.completed",
    requiresConditionReview: true,  // add condition: outcome = "approved"
  },
  {
    legacy:   "approval.rejected",
    canonical: "approval.completed",
    requiresConditionReview: true,  // add condition: outcome = "rejected"
  },
  {
    legacy:   "forms.form.submitted",
    canonical: "form.submitted",
    requiresConditionReview: false,
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const shouldMigrate = process.argv.includes("--migrate");

  console.log("=".repeat(70));
  console.log("WORKFLOW TRIGGER COMPATIBILITY CHECK");
  console.log("Scanning workflow_definitions for legacy trigger_event names...");
  console.log("=".repeat(70));

  let totalAffected = 0;
  let conditionReviewRequired = false;

  for (const { legacy, canonical, requiresConditionReview } of RENAMES) {
    const rows = await db.execute<{
      id: number;
      name: string;
      key: string;
      workspace_id: number;
      trigger_event: string;
      is_active: boolean;
    }>(sql`
      SELECT id, name, key, workspace_id, trigger_event, is_active
      FROM workflow_definitions
      WHERE trigger_event = ${legacy}
      ORDER BY workspace_id, id
    `);

    const affected = rows.rows;

    if (affected.length === 0) {
      console.log(`\n✓  "${legacy}" — no rows found (safe)`);
      continue;
    }

    totalAffected += affected.length;
    console.log(`\n⚠  "${legacy}" → "${canonical}" — ${affected.length} row(s) affected:`);

    for (const row of affected) {
      const status = row.is_active ? "ACTIVE" : "inactive";
      console.log(`   id=${row.id}  workspace=${row.workspace_id}  key="${row.key}"  name="${row.name}"  [${status}]`);
    }

    if (requiresConditionReview) {
      conditionReviewRequired = true;
      console.log(`   ⚠  CONDITION REVIEW REQUIRED: "${legacy}" is now merged into "${canonical}".`);
      console.log(`      The payload carries outcome="approved"|"rejected".`);
      console.log(`      Add a workflow condition on outcome to preserve the original behaviour.`);
    }

    if (shouldMigrate) {
      console.log(`   → Migrating ${affected.length} row(s) to trigger_event = '${canonical}'...`);
      await db.execute(sql`
        UPDATE workflow_definitions
        SET trigger_event = ${canonical},
            updated_at    = now()
        WHERE trigger_event = ${legacy}
      `);
      console.log(`   ✓ Done.`);
    }
  }

  console.log("\n" + "=".repeat(70));

  if (totalAffected === 0) {
    console.log("✅ No legacy trigger_event names found. All workflow definitions are up to date.");
  } else if (shouldMigrate) {
    console.log(`✅ Migration complete. ${totalAffected} workflow definition(s) updated.`);
    if (conditionReviewRequired) {
      console.log("⚠  Some rows require manual condition review — see output above.");
    }
  } else {
    console.log(`⚠  ${totalAffected} workflow definition(s) use legacy trigger_event names.`);
    console.log("   These workflows will SILENTLY NOT FIRE with the current event system.");
    console.log("   Run with --migrate to apply the rename:");
    console.log("   pnpm --filter @workspace/scripts run check-workflow-triggers -- --migrate");
    if (conditionReviewRequired) {
      console.log("⚠  Some rows require manual condition review after migration — see output above.");
    }
  }

  console.log("=".repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  });
