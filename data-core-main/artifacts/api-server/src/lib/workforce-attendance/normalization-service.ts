import { db } from "@workspace/db";
import {
  attendanceRawEventsTable,
  attendanceEventsTable,
  attendanceSourcesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { toLocalDateString, SOURCE_PRIORITY } from "./time-utils";
import { getWorkspaceTimezone } from "./calendar-context";
import { pairMissingPunches, resolveSourceConflict } from "./import/normalization-rules";

export class AttendanceNormalizationService {
  applySourcePriority(sources: Array<{ code: string; priority: number }>): string {
    return sources.sort((a, b) => b.priority - a.priority)[0]?.code ?? "manual";
  }

  async detectDuplicateCanonical(
    workspaceId: number,
    employeeId: number,
    idempotencyKey: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: attendanceEventsTable.id })
      .from(attendanceEventsTable)
      .where(
        and(
          eq(attendanceEventsTable.workspaceId, workspaceId),
          eq(attendanceEventsTable.employeeId, employeeId),
          eq(attendanceEventsTable.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async normalizeRawEvent(rawEventId: number): Promise<{ eventId: number; skipped: boolean }> {
    const [raw] = await db
      .select()
      .from(attendanceRawEventsTable)
      .where(eq(attendanceRawEventsTable.id, rawEventId))
      .limit(1);

    if (!raw || !raw.employeeId) {
      throw new Error("Raw event not found or employee unresolved");
    }

    const idempotencyKey = `norm:${raw.id}`;
    const dup = await this.detectDuplicateCanonical(raw.workspaceId, raw.employeeId, idempotencyKey);
    if (dup) {
      await db
        .update(attendanceRawEventsTable)
        .set({ processingStatus: "duplicate", errorMessage: null })
        .where(eq(attendanceRawEventsTable.id, rawEventId));
      return { eventId: 0, skipped: true };
    }

    const timezone = await getWorkspaceTimezone(raw.workspaceId);
    const localDate = toLocalDateString(raw.occurredAt, timezone);
    const eventType =
      raw.eventTypeHint === "clock_out"
        ? "clock_out"
        : raw.eventTypeHint === "clock_in"
          ? "clock_in"
          : raw.eventTypeHint.startsWith("clock")
            ? raw.eventTypeHint
            : "clock_in";

    let locationJson: string | null = null;
    try {
      const payload = JSON.parse(raw.payloadJson) as {
        location?: unknown;
        warnings?: unknown[];
        geofence?: unknown;
        privacy?: unknown;
      };
      if (payload.location) {
        locationJson = JSON.stringify({
          ...(payload.location as object),
          warnings: payload.warnings ?? [],
          geofence: payload.geofence ?? null,
          privacy: payload.privacy ?? { punchTimeOnly: true },
        });
      }
    } catch {
      /* ignore */
    }

    const [event] = await db
      .insert(attendanceEventsTable)
      .values({
        workspaceId: raw.workspaceId,
        employeeId: raw.employeeId,
        sourceId: raw.sourceId,
        rawEventId: raw.id,
        eventType,
        occurredAt: raw.occurredAt,
        localDate,
        timezone,
        locationJson,
        idempotencyKey,
      })
      .returning({ id: attendanceEventsTable.id });

    await db
      .update(attendanceRawEventsTable)
      .set({ processingStatus: "normalized", errorMessage: null })
      .where(eq(attendanceRawEventsTable.id, rawEventId));

    return { eventId: event!.id, skipped: false };
  }

  async createAttendanceEventFromRaw(rawEventId: number): Promise<number> {
    const result = await this.normalizeRawEvent(rawEventId);
    return result.eventId;
  }

  async rebuildEmployeeDay(workspaceId: number, employeeId: number, localDate: string): Promise<void> {
    const events = await db
      .select({
        id: attendanceEventsTable.id,
        eventType: attendanceEventsTable.eventType,
        occurredAt: attendanceEventsTable.occurredAt,
        sourceId: attendanceEventsTable.sourceId,
        code: attendanceSourcesTable.code,
        priority: attendanceSourcesTable.defaultPriority,
      })
      .from(attendanceEventsTable)
      .innerJoin(attendanceSourcesTable, eq(attendanceEventsTable.sourceId, attendanceSourcesTable.id))
      .where(
        and(
          eq(attendanceEventsTable.workspaceId, workspaceId),
          eq(attendanceEventsTable.employeeId, employeeId),
          eq(attendanceEventsTable.localDate, localDate),
          eq(attendanceEventsTable.isSuperseded, false),
        ),
      );

    if (events.length === 0) return;

    const priorities = events.map((e) => ({
      code: e.code,
      priority: SOURCE_PRIORITY[e.code] ?? e.priority,
    }));
    const { winner, conflict } = resolveSourceConflict(priorities);
    if (conflict) {
      await this.suppressLowerPriorityEvents(
        workspaceId,
        employeeId,
        localDate,
        winner,
        events.map((e) => ({
          id: e.id,
          code: e.code,
          priority: SOURCE_PRIORITY[e.code] ?? e.priority,
        })),
      );
    }

    const punchWarnings = pairMissingPunches(
      events.map((e) => ({ eventType: e.eventType, occurredAt: e.occurredAt })),
    );
    void punchWarnings;
    void winner;
  }

  /** Mark duplicate lower-priority canonical events as superseded (soft suppression). */
  async suppressLowerPriorityEvents(
    workspaceId: number,
    employeeId: number,
    localDate: string,
    winnerCode: string,
    events: Array<{ id: number; code: string; priority: number }>,
  ): Promise<void> {
    const winnerPriority =
      SOURCE_PRIORITY[winnerCode] ??
      events.find((e) => e.code === winnerCode)?.priority ??
      0;

    const losers = events.filter((e) => {
      const p = SOURCE_PRIORITY[e.code] ?? e.priority;
      return e.code !== winnerCode && p < winnerPriority;
    });

    for (const loser of losers) {
      await db
        .update(attendanceEventsTable)
        .set({ isSuperseded: true })
        .where(
          and(
            eq(attendanceEventsTable.id, loser.id),
            eq(attendanceEventsTable.workspaceId, workspaceId),
            eq(attendanceEventsTable.employeeId, employeeId),
            eq(attendanceEventsTable.localDate, localDate),
          ),
        );
    }
  }
}

export const attendanceNormalizationService = new AttendanceNormalizationService();
