import { db } from "@workspace/db";
import { workforceTimelineEventsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

export type TimelineEventInput = {
  workspaceId: number;
  employeeId: number;
  eventCategory: string;
  eventType: string;
  title: string;
  description?: string | null;
  occurredAt?: Date;
  actorUserId?: number | null;
  actorName?: string | null;
  correlationId?: string | null;
  sourceTable?: string | null;
  sourceId?: number | null;
  metadata?: unknown;
};

export async function appendTimelineEvent(input: TimelineEventInput) {
  const [row] = await db
    .insert(workforceTimelineEventsTable)
    .values({
      workspaceId: input.workspaceId,
      employeeId: input.employeeId,
      eventCategory: input.eventCategory,
      eventType: input.eventType,
      title: input.title,
      description: input.description ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      actorUserId: input.actorUserId ?? null,
      actorName: input.actorName ?? null,
      correlationId: input.correlationId ?? null,
      sourceTable: input.sourceTable ?? null,
      sourceId: input.sourceId ?? null,
      metadata: input.metadata ?? null,
    })
    .returning();
  return row!;
}

export async function getEmployeeTimeline(
  workspaceId: number,
  employeeId: number,
  limit = 100,
) {
  return db
    .select()
    .from(workforceTimelineEventsTable)
    .where(
      and(
        eq(workforceTimelineEventsTable.workspaceId, workspaceId),
        eq(workforceTimelineEventsTable.employeeId, employeeId),
      ),
    )
    .orderBy(desc(workforceTimelineEventsTable.occurredAt))
    .limit(limit);
}
