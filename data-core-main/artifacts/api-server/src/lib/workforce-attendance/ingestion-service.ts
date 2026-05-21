import { db } from "@workspace/db";
import { attendanceRawEventsTable, employeesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { hashPayload, toLocalDateString } from "./time-utils";
import { requireSourceByCode } from "./source-seed";
import { getWorkspaceTimezone } from "./calendar-context";
import { payrollLockService } from "../payroll/payroll-lock-service";
import { payrollPolicyService, type PayrollLockPolicy } from "../payroll/payroll-policy-service";
import { logger } from "../logger";

export type IngestLockOptions = {
  breakGlass?: boolean;
  breakGlassReason?: string;
  userId?: number;
};

export type IngestRawEventInput = {
  workspaceId: number;
  sourceCode: string;
  employeeId: number;
  eventTypeHint: "clock_in" | "clock_out" | "import_row";
  occurredAt: Date;
  payload: Record<string, unknown>;
  externalId?: string;
  createdByUserId?: number;
  timezone?: string;
};

export class AttendanceIngestionService {
  validateEvent(input: IngestRawEventInput): void {
    if (!input.workspaceId || !input.employeeId) throw new Error("workspaceId and employeeId required");
    if (!input.eventTypeHint) throw new Error("eventTypeHint required");
    if (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime())) {
      throw new Error("Invalid occurredAt");
    }
    const allowed = new Set(["manual", "web", "excel", "system", "vendor"]);
    if (!allowed.has(input.sourceCode)) throw new Error(`Invalid source: ${input.sourceCode}`);
  }

  async resolveEmployee(workspaceId: number, employeeId: number): Promise<void> {
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)))
      .limit(1);
    if (!emp) throw new Error("Employee not found in workspace");
  }

  generateIdempotencyKey(input: IngestRawEventInput): string {
    if (input.externalId) {
      return `ext:${input.sourceCode}:${input.externalId}`;
    }
    const tz = input.timezone ?? "UTC";
    const localDate = toLocalDateString(input.occurredAt, tz);
    const payloadKey = hashPayload({
      employeeId: input.employeeId,
      eventTypeHint: input.eventTypeHint,
      occurredAt: input.occurredAt.toISOString(),
      localDate,
    });
    return `${input.sourceCode}:${input.employeeId}:${input.eventTypeHint}:${payloadKey.slice(0, 32)}`;
  }

  async ingestRawEvent(
    input: IngestRawEventInput,
    lockOptions?: IngestLockOptions,
  ): Promise<{
    rawEventId: number;
    duplicate: boolean;
  }> {
    this.validateEvent(input);
    await this.resolveEmployee(input.workspaceId, input.employeeId);

    const tz = input.timezone ?? (await getWorkspaceTimezone(input.workspaceId));
    const localDate = toLocalDateString(input.occurredAt, tz);
    const lockPolicy = await payrollPolicyService.resolvePolicy<PayrollLockPolicy>(
      input.workspaceId,
      "payroll.lock",
    );
    if (lockPolicy.block_ingest_when_locked !== false) {
      await payrollLockService.assertDateNotLocked(input.workspaceId, localDate, {
        breakGlass: lockOptions?.breakGlass,
        userId: lockOptions?.userId,
        reason: lockOptions?.breakGlassReason,
        action: "attendance_ingest",
      });
    }

    const source = await requireSourceByCode(input.workspaceId, input.sourceCode);
    const idempotencyKey = this.generateIdempotencyKey(input);
    const payloadJson = JSON.stringify(input.payload);
    const payloadHash = hashPayload(input.payload);

    const existing = await db
      .select({ id: attendanceRawEventsTable.id })
      .from(attendanceRawEventsTable)
      .where(
        and(
          eq(attendanceRawEventsTable.workspaceId, input.workspaceId),
          eq(attendanceRawEventsTable.sourceId, source.id),
          eq(attendanceRawEventsTable.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (existing[0]) {
      logger.debug({ idempotencyKey }, "[workforce] duplicate raw event skipped");
      return { rawEventId: existing[0].id, duplicate: true };
    }

    const [inserted] = await db
      .insert(attendanceRawEventsTable)
      .values({
        workspaceId: input.workspaceId,
        sourceId: source.id,
        employeeId: input.employeeId,
        externalId: input.externalId ?? null,
        idempotencyKey,
        eventTypeHint: input.eventTypeHint,
        payloadJson,
        payloadHash,
        occurredAt: input.occurredAt,
        processingStatus: "received",
        createdByUserId: input.createdByUserId ?? null,
      })
      .returning({ id: attendanceRawEventsTable.id });

    return { rawEventId: inserted!.id, duplicate: false };
  }
}

export const attendanceIngestionService = new AttendanceIngestionService();
