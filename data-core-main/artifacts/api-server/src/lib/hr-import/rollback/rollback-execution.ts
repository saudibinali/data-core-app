/**
 * Phase 4 — Rollback execution runtime (restore pre-images; no destructive deletes).
 */

import { db, employeesTable, hrImportSessionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { listRollbackSnapshots } from "./rollback-foundation";
import { runInTransaction } from "../commit/transaction-manager";
import { recordCommitTelemetry } from "../telemetry/commit-telemetry";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";
import { getImportRuntimeSettings, isLiveCommitAllowed } from "../runtime-settings";

export type RollbackExecutionResult = {
  ok: boolean;
  sessionId: number;
  restored: number;
  skipped: number;
  errors: string[];
  reason?: string;
  timingMs: number;
};

const RESTORABLE_FIELDS = [
  "fullName", "firstName", "lastName", "email", "phoneNumber", "employeeNumber",
  "status", "employmentType", "hireDate", "endDate", "probationEndDate",
  "dateOfBirth", "gender", "nationality", "maritalStatus", "nationalId",
  "passportNumber", "address", "company", "branch", "location",
  "orgUnitId", "jobTitleId", "jobGradeId", "positionId", "workLocationId",
  "position", "directManagerId", "emergencyContactName", "emergencyContactPhone",
  "emergencyContactRelation", "notes",
] as const;

export async function executeRollbackSession(input: {
  workspaceId: number;
  sessionId: number;
  revertToken: string;
}): Promise<RollbackExecutionResult> {
  const t0 = Date.now();
  incrementRuntimeMetric("import.v4.rollback_request");

  const settings = await getImportRuntimeSettings(input.workspaceId);
  if (!isLiveCommitAllowed(settings)) {
    return {
      ok: false,
      sessionId: input.sessionId,
      restored: 0,
      skipped: 0,
      errors: [],
      reason: "ROLLBACK_REQUIRES_CONTROLLED_COMMIT_MODE",
      timingMs: Date.now() - t0,
    };
  }

  const [session] = await db
    .select()
    .from(hrImportSessionsTable)
    .where(
      and(
        eq(hrImportSessionsTable.id, input.sessionId),
        eq(hrImportSessionsTable.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  if (!session) {
    return {
      ok: false,
      sessionId: input.sessionId,
      restored: 0,
      skipped: 0,
      errors: ["Session not found"],
      reason: "SESSION_NOT_FOUND",
      timingMs: Date.now() - t0,
    };
  }

  if (session.status !== "committed") {
    return {
      ok: false,
      sessionId: input.sessionId,
      restored: 0,
      skipped: 0,
      errors: [],
      reason: "SESSION_NOT_COMMITTED",
      timingMs: Date.now() - t0,
    };
  }

  if (!session.revertToken || session.revertToken !== input.revertToken) {
    return {
      ok: false,
      sessionId: input.sessionId,
      restored: 0,
      skipped: 0,
      errors: [],
      reason: "INVALID_REVERT_TOKEN",
      timingMs: Date.now() - t0,
    };
  }

  const snapshots = await listRollbackSnapshots(input.sessionId, input.workspaceId);
  const actionable = snapshots.filter((s) => !s.action.startsWith("prepare_"));

  let restored = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    await runInTransaction(async (tx) => {
      for (const snap of [...actionable].reverse()) {
        if (snap.entityType !== "employee" || !snap.entityId) {
          skipped++;
          continue;
        }

        if (snap.action === "update" && snap.beforeJson) {
          const patch: Record<string, unknown> = {};
          const before = snap.beforeJson as Record<string, unknown>;
          for (const field of RESTORABLE_FIELDS) {
            if (field in before) patch[field] = before[field];
          }
          if (Object.keys(patch).length) {
            await tx
              .update(employeesTable)
              .set(patch as never)
              .where(
                and(
                  eq(employeesTable.id, snap.entityId!),
                  eq(employeesTable.workspaceId, input.workspaceId),
                ),
              );
            restored++;
          } else {
            skipped++;
          }
        } else if (snap.action === "insert") {
          await tx
            .update(employeesTable)
            .set({ status: "terminated", notes: `[import_rollback_session_${input.sessionId}]` })
            .where(
              and(
                eq(employeesTable.id, snap.entityId!),
                eq(employeesTable.workspaceId, input.workspaceId),
              ),
            );
          restored++;
        } else {
          skipped++;
        }
      }
    });

    await db
      .update(hrImportSessionsTable)
      .set({
        status: "rolled_back",
        summary: {
          ...(session.summary as object),
          rollbackResult: { restored, skipped, errors, phase: 4 },
        },
      })
      .where(
        and(
          eq(hrImportSessionsTable.id, input.sessionId),
          eq(hrImportSessionsTable.workspaceId, input.workspaceId),
        ),
      );

    incrementRuntimeMetric("import.v4.rollback_success");
    void recordCommitTelemetry({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      event: "rollback_success",
      timingMs: { rollbackMs: Date.now() - t0 },
      metadata: { restored, skipped },
    });

    return {
      ok: true,
      sessionId: input.sessionId,
      restored,
      skipped,
      errors,
      timingMs: Date.now() - t0,
    };
  } catch (e) {
    incrementRuntimeMetric("import.v4.rollback_failure");
    errors.push(e instanceof Error ? e.message : String(e));
    return {
      ok: false,
      sessionId: input.sessionId,
      restored,
      skipped,
      errors,
      reason: "ROLLBACK_EXECUTION_FAILED",
      timingMs: Date.now() - t0,
    };
  }
}
