/**
 * Phase 4 — Workforce synchronization after controlled import commit.
 */

import { appendTimelineEvent } from "../../workforce/operations/timeline-service";
import { syncLegacyUserFieldsFromEmployee } from "../../workforce/manager-resolver";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";
import { recordLegacyUsage } from "../../workforce/stabilization/usage-telemetry";

export async function syncImportWorkforceSideEffects(input: {
  workspaceId: number;
  sessionId: number;
  employeeIds: number[];
  actorUserId?: number;
  correlationId?: string;
}): Promise<{ timelineEvents: number; userSyncs: number }> {
  const t0 = Date.now();
  let timelineEvents = 0;
  let userSyncs = 0;

  for (const employeeId of input.employeeIds) {
    try {
      await appendTimelineEvent({
        workspaceId: input.workspaceId,
        employeeId,
        eventCategory: "import",
        eventType: "employee.import.v2.commit",
        title: "Employee imported via v2 controlled commit",
        description: `Session ${input.sessionId}`,
        actorUserId: input.actorUserId ?? null,
        correlationId: input.correlationId ?? null,
        sourceTable: "hr_import_sessions",
        sourceId: input.sessionId,
        metadata: { phase: 4, runtime: "controlled_commit" },
      });
      timelineEvents++;
    } catch {
      incrementRuntimeMetric("import.v4.sync_timeline_failure");
    }

    try {
      await syncLegacyUserFieldsFromEmployee(input.workspaceId, employeeId);
      userSyncs++;
    } catch {
      incrementRuntimeMetric("import.v4.sync_user_failure");
    }
  }

  incrementRuntimeMetric("import.v4.sync_total", Date.now() - t0);

  void recordLegacyUsage({
    workspaceId: input.workspaceId,
    eventType: "route_hit",
    legacySurface: "hr.import.workforce.sync",
    sourcePath: `session:${input.sessionId}`,
    entityType: "import_session",
    entityId: input.sessionId,
    metadata: {
      timelineEvents,
      userSyncs,
      employeeCount: input.employeeIds.length,
      syncMs: Date.now() - t0,
    },
  });

  return { timelineEvents, userSyncs };
}
