import { appEventBus } from "../events/app-bus";
import { EVENT_TYPES } from "@workspace/core-events";
import { db } from "@workspace/db";
import { attendanceRawEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { attendanceIngestionService, type IngestRawEventInput } from "./ingestion-service";
import { attendanceNormalizationService } from "./normalization-service";
import { attendanceSummaryService } from "./summary-service";
import { syncSummaryToLegacyAttendance } from "./legacy-bridge";
import { logAttendanceAccess } from "./access-log";
import { toLocalDateString } from "./time-utils";
import { getWorkspaceTimezone } from "./calendar-context";
import { payrollLockService } from "../payroll/payroll-lock-service";
import { payrollPolicyService, type PayrollLockPolicy } from "../payroll/payroll-policy-service";
import type { IngestLockOptions } from "./ingestion-service";
import { logger } from "../logger";

export type ProcessIngestResult = {
  rawEventId: number;
  duplicate: boolean;
  eventId: number;
  summaryId: number;
  legacyAttendanceId: number;
};

export async function processIngestedEvent(
  input: IngestRawEventInput,
  options?: { createdByUserId?: number; ipAddress?: string },
): Promise<ProcessIngestResult> {
  logAttendanceAccess({
    workspaceId: input.workspaceId,
    userId: options?.createdByUserId,
    action: "ingest",
    resourceType: "attendance_raw_event",
    ipAddress: options?.ipAddress,
  });

  const { rawEventId, duplicate } = await attendanceIngestionService.ingestRawEvent(
    input,
    options?.lock,
  );

  void appEventBus.emit({
    type: EVENT_TYPES.ATTENDANCE_RAW_RECEIVED,
    module: "hr",
    workspace: { workspaceId: input.workspaceId },
    actor: { userId: options?.createdByUserId, role: undefined },
    metadata: {
      idempotencyKey: `attendance-raw-${rawEventId}`,
    },
    data: {
      rawEventId,
      employeeId: input.employeeId,
      sourceCode: input.sourceCode,
      duplicate,
    },
  });

  if (duplicate) {
    const tz = input.timezone ?? (await getWorkspaceTimezone(input.workspaceId));
    const localDate = toLocalDateString(input.occurredAt, tz);
    const summary = await attendanceSummaryService.buildDailySummary(
      input.workspaceId,
      input.employeeId,
      localDate,
    );
    const legacyId = await syncSummaryToLegacyAttendance(summary, options?.createdByUserId);
    return {
      rawEventId,
      duplicate: true,
      eventId: 0,
      summaryId: summary.id,
      legacyAttendanceId: legacyId,
    };
  }

  let eventId = 0;
  let skipped = true;
  try {
    const norm = await attendanceNormalizationService.normalizeRawEvent(rawEventId);
    eventId = norm.eventId;
    skipped = norm.skipped;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(attendanceRawEventsTable)
      .set({ processingStatus: "failed", errorMessage: message })
      .where(eq(attendanceRawEventsTable.id, rawEventId));
    logger.warn({ rawEventId, err: message }, "[workforce] normalization failed");
    throw err;
  }

  if (!skipped && eventId) {
    void appEventBus.emit({
      type: EVENT_TYPES.ATTENDANCE_EVENT_NORMALIZED,
      module: "hr",
      workspace: { workspaceId: input.workspaceId },
      actor: { userId: options?.createdByUserId, role: undefined },
      metadata: { idempotencyKey: `attendance-norm-${eventId}` },
      data: { rawEventId, eventId, employeeId: input.employeeId },
    });
  }

  const tz = input.timezone ?? (await getWorkspaceTimezone(input.workspaceId));
  const localDate = toLocalDateString(input.occurredAt, tz);
  const summary = await attendanceSummaryService.buildDailySummary(
    input.workspaceId,
    input.employeeId,
    localDate,
  );

  const legacyId = await syncSummaryToLegacyAttendance(summary, options?.createdByUserId);

  void appEventBus.emit({
    type: EVENT_TYPES.ATTENDANCE_DAY_CALCULATED,
    module: "hr",
    workspace: { workspaceId: input.workspaceId },
    actor: { userId: options?.createdByUserId, role: undefined },
    metadata: { idempotencyKey: `attendance-day-${summary.id}` },
    data: {
      employeeId: input.employeeId,
      localDate,
      summaryId: summary.id,
      legacyAttendanceId: legacyId,
      status: summary.status,
    },
  });

  return {
    rawEventId,
    duplicate,
    eventId,
    summaryId: summary.id,
    legacyAttendanceId: legacyId,
  };
}

export async function ingestWebClock(params: {
  workspaceId: number;
  employeeId: number;
  userId: number;
  eventType: "clock_in" | "clock_out";
  occurredAt?: Date;
  location?: { lat?: number; lng?: number; accuracyM?: number };
  ipAddress?: string;
}): Promise<ProcessIngestResult> {
  const occurredAt = params.occurredAt ?? new Date();
  const timezone = await getWorkspaceTimezone(params.workspaceId);

  return processIngestedEvent(
    {
      workspaceId: params.workspaceId,
      sourceCode: "web",
      employeeId: params.employeeId,
      eventTypeHint: params.eventType,
      occurredAt,
      timezone,
      payload: {
        eventType: params.eventType,
        location: params.location ?? null,
        userId: params.userId,
      },
      createdByUserId: params.userId,
    },
    { createdByUserId: params.userId, ipAddress: params.ipAddress },
  );
}

export async function ingestExcelRow(params: {
  workspaceId: number;
  employeeId: number;
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  userId?: number;
}): Promise<void> {
  await ingestExcelRowWithMeta(params);
}

export async function ingestExcelRowWithMeta(params: {
  workspaceId: number;
  employeeId: number;
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  userId?: number;
  importBatchId?: number;
  rowNumber?: number;
}): Promise<{ rawEventId?: number }> {
  const timezone = await getWorkspaceTimezone(params.workspaceId);
  const base = new Date(`${params.date}T12:00:00Z`);
  const batchPrefix = params.importBatchId ? `batch:${params.importBatchId}:row:${params.rowNumber ?? 0}` : "";
  let lastRawId: number | undefined;

  if (params.checkIn) {
    const [h, m] = params.checkIn.split(":").map(Number);
    const at = new Date(base);
    at.setUTCHours(h ?? 8, m ?? 0, 0, 0);
    const result = await processIngestedEvent(
      {
        workspaceId: params.workspaceId,
        sourceCode: "excel",
        employeeId: params.employeeId,
        eventTypeHint: "clock_in",
        occurredAt: at,
        timezone,
        externalId: batchPrefix
          ? `${batchPrefix}:in`
          : `excel:${params.date}:in:${params.checkIn}`,
        payload: { date: params.date, checkIn: params.checkIn, importBatchId: params.importBatchId },
        createdByUserId: params.userId,
      },
      { createdByUserId: params.userId },
    );
    lastRawId = result.rawEventId;
  }
  if (params.checkOut) {
    const [h, m] = params.checkOut.split(":").map(Number);
    const at = new Date(base);
    at.setUTCHours(h ?? 17, m ?? 0, 0, 0);
    const result = await processIngestedEvent(
      {
        workspaceId: params.workspaceId,
        sourceCode: "excel",
        employeeId: params.employeeId,
        eventTypeHint: "clock_out",
        occurredAt: at,
        timezone,
        externalId: batchPrefix
          ? `${batchPrefix}:out`
          : `excel:${params.date}:out:${params.checkOut}`,
        payload: { date: params.date, checkOut: params.checkOut, importBatchId: params.importBatchId },
        createdByUserId: params.userId,
      },
      { createdByUserId: params.userId },
    );
    lastRawId = result.rawEventId;
  }
  return { rawEventId: lastRawId };
}
