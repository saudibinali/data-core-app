import { db } from "@workspace/db";
import { legacyCompatUsageEventsTable } from "@workspace/db";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { incrementRuntimeMetric } from "./observability-metrics";

export type LegacyUsageEventType =
  | "route_hit"
  | "adapter_read"
  | "adapter_write"
  | "shadow_mismatch"
  | "write_blocked"
  | "adapter_skipped";

export type RecordLegacyUsageInput = {
  workspaceId: number;
  eventType: LegacyUsageEventType;
  legacySurface: string;
  runtimeMode?: string | null;
  sourcePath?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  metadata?: unknown;
};

export async function recordLegacyUsage(input: RecordLegacyUsageInput): Promise<void> {
  incrementRuntimeMetric(`legacy.${input.legacySurface}.${input.eventType}`);

  await db
    .insert(legacyCompatUsageEventsTable)
    .values({
      workspaceId: input.workspaceId,
      eventType: input.eventType,
      legacySurface: input.legacySurface,
      runtimeMode: input.runtimeMode ?? null,
      sourcePath: input.sourcePath ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? null,
    })
    .catch(() => undefined);
}

export async function getLegacyUsageSummary(
  workspaceId: number,
  sinceDays = 30,
): Promise<{ total: number; bySurface: Record<string, number>; byType: Record<string, number> }> {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  const rows = await db
    .select({
      legacySurface: legacyCompatUsageEventsTable.legacySurface,
      eventType: legacyCompatUsageEventsTable.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(legacyCompatUsageEventsTable)
    .where(
      and(
        eq(legacyCompatUsageEventsTable.workspaceId, workspaceId),
        gte(legacyCompatUsageEventsTable.recordedAt, since),
      ),
    )
    .groupBy(legacyCompatUsageEventsTable.legacySurface, legacyCompatUsageEventsTable.eventType);

  const bySurface: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let total = 0;

  for (const row of rows) {
    total += row.count;
    bySurface[row.legacySurface] = (bySurface[row.legacySurface] ?? 0) + row.count;
    byType[row.eventType] = (byType[row.eventType] ?? 0) + row.count;
  }

  return { total, bySurface, byType };
}

export async function getRecentLegacyUsageEvents(
  workspaceId: number,
  limit = 50,
) {
  return db
    .select()
    .from(legacyCompatUsageEventsTable)
    .where(eq(legacyCompatUsageEventsTable.workspaceId, workspaceId))
    .orderBy(desc(legacyCompatUsageEventsTable.recordedAt))
    .limit(Math.min(limit, 200));
}

/** Returns true when workspace has zero legacy route hits in window (cleanup gate helper). */
export async function hasZeroActiveLegacyTraffic(
  workspaceId: number,
  sinceDays = 30,
): Promise<boolean> {
  const summary = await getLegacyUsageSummary(workspaceId, sinceDays);
  const routeHits = summary.byType.route_hit ?? 0;
  const adapterWrites = summary.byType.adapter_write ?? 0;
  return routeHits === 0 && adapterWrites === 0;
}
