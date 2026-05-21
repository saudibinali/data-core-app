import { db } from "@workspace/db";
import {
  employeesTable,
  hrCalendarHolidaysTable,
  hrEmployeeLeavesTable,
  hrLeaveMigrationMapTable,
  hrWorkCalendarsTable,
  leaveApprovalStepsTable,
  leaveRequestsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

export type LeaveMigrationReport = {
  legacyTotal: number;
  canonicalTotal: number;
  alreadyMigrated: number;
  pendingMigration: number;
  skippedNoLinkedUser: number;
  leaveRuntimeMode: string;
};

export type LeaveMigrationRunResult = {
  dryRun: boolean;
  processed: number;
  migrated: number;
  skipped: number;
  errors: Array<{ legacyLeaveId: number; reason: string }>;
  samples: Array<{ legacyLeaveId: number; canonicalRequestId?: number; requestNumber?: string }>;
};

function migrationRequestNumber(legacyLeaveId: number): string {
  return `LRQ-MIG-${legacyLeaveId}`;
}

function mapLegacyStatus(status: string): string {
  switch (status) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    default:
      return "pending_approval";
  }
}

async function calcBusinessDays(
  workspaceId: number,
  startDate: string,
  endDate: string,
): Promise<number> {
  const [calendar] = await db
    .select()
    .from(hrWorkCalendarsTable)
    .where(
      and(
        eq(hrWorkCalendarsTable.workspaceId, workspaceId),
        eq(hrWorkCalendarsTable.isDefault, true),
        eq(hrWorkCalendarsTable.isActive, true),
      ),
    )
    .limit(1);

  const workDays: number[] = calendar ? (calendar.workDays as number[]) : [1, 2, 3, 4, 5];
  const holidaySet = new Set<string>();
  if (calendar) {
    const hols = await db
      .select({ date: hrCalendarHolidaysTable.date })
      .from(hrCalendarHolidaysTable)
      .where(
        and(
          eq(hrCalendarHolidaysTable.calendarId, calendar.id),
          gte(hrCalendarHolidaysTable.date, startDate),
          lte(hrCalendarHolidaysTable.date, endDate),
        ),
      );
    for (const h of hols) holidaySet.add(h.date);
  }

  let count = 0;
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (current <= end) {
    const dayOfWeek = current.getUTCDay();
    const dateStr = current.toISOString().split("T")[0]!;
    if (workDays.includes(dayOfWeek) && !holidaySet.has(dateStr)) count++;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}

async function resolveFallbackUserId(workspaceId: number): Promise<number | null> {
  const [admin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.workspaceId, workspaceId),
        inArray(usersTable.role, ["admin", "owner"]),
      ),
    )
    .limit(1);
  return admin?.id ?? null;
}

export async function getLeaveMigrationReport(workspaceId: number): Promise<LeaveMigrationReport> {
  const [legacyRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hrEmployeeLeavesTable)
    .where(eq(hrEmployeeLeavesTable.workspaceId, workspaceId));

  const [canonicalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leaveRequestsTable)
    .where(eq(leaveRequestsTable.workspaceId, workspaceId));

  const [migratedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hrLeaveMigrationMapTable)
    .where(eq(hrLeaveMigrationMapTable.workspaceId, workspaceId));

  const [skipRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hrEmployeeLeavesTable)
    .innerJoin(employeesTable, eq(hrEmployeeLeavesTable.employeeId, employeesTable.id))
    .leftJoin(
      hrLeaveMigrationMapTable,
      and(
        eq(hrLeaveMigrationMapTable.legacyLeaveId, hrEmployeeLeavesTable.id),
        eq(hrLeaveMigrationMapTable.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(hrEmployeeLeavesTable.workspaceId, workspaceId),
        isNull(hrLeaveMigrationMapTable.legacyLeaveId),
        isNull(employeesTable.userId),
        isNull(hrEmployeeLeavesTable.createdBy),
      ),
    );

  const skippedNoLinkedUser = skipRow?.count ?? 0;

  const { getLeaveRuntimeMode } = await import("./hcm-workspace-settings");
  const leaveRuntimeMode = await getLeaveRuntimeMode(workspaceId);

  const legacyTotal = legacyRow?.count ?? 0;
  const alreadyMigrated = migratedRow?.count ?? 0;

  return {
    legacyTotal,
    canonicalTotal: canonicalRow?.count ?? 0,
    alreadyMigrated,
    pendingMigration: Math.max(0, legacyTotal - alreadyMigrated),
    skippedNoLinkedUser,
    leaveRuntimeMode,
  };
}

export async function runLeaveMigration(
  workspaceId: number,
  options: { dryRun?: boolean; limit?: number } = {},
): Promise<LeaveMigrationRunResult> {
  const dryRun = options.dryRun !== false;
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000);

  const migratedIds = await db
    .select({ legacyLeaveId: hrLeaveMigrationMapTable.legacyLeaveId })
    .from(hrLeaveMigrationMapTable)
    .where(eq(hrLeaveMigrationMapTable.workspaceId, workspaceId));
  const migratedSet = new Set(migratedIds.map((r) => r.legacyLeaveId));

  const legacyRows = await db
    .select()
    .from(hrEmployeeLeavesTable)
    .where(eq(hrEmployeeLeavesTable.workspaceId, workspaceId))
    .orderBy(hrEmployeeLeavesTable.id)
    .limit(limit * 2);

  const toProcess = legacyRows.filter((r) => !migratedSet.has(r.id)).slice(0, limit);
  const fallbackUserId = await resolveFallbackUserId(workspaceId);

  const result: LeaveMigrationRunResult = {
    dryRun,
    processed: 0,
    migrated: 0,
    skipped: 0,
    errors: [],
    samples: [],
  };

  for (const legacy of toProcess) {
    result.processed++;

    const [employee] = await db
      .select({
        id: employeesTable.id,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(
        and(
          eq(employeesTable.id, legacy.employeeId),
          eq(employeesTable.workspaceId, workspaceId),
        ),
      );

    const requestedByUserId =
      employee?.userId ?? legacy.createdBy ?? fallbackUserId;

    if (!requestedByUserId) {
      result.skipped++;
      result.errors.push({
        legacyLeaveId: legacy.id,
        reason: "no_linked_user",
      });
      continue;
    }

    const startDate = legacy.startDate;
    const endDate = legacy.endDate;
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    const daysRequested =
      legacy.daysCount ??
      Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
    const businessDaysCount = await calcBusinessDays(workspaceId, startDate, endDate);
    const bizDays = businessDaysCount > 0 ? businessDaysCount : daysRequested;

    const canonicalStatus = mapLegacyStatus(legacy.status);
    const requestNumber = migrationRequestNumber(legacy.id);

    if (dryRun) {
      result.migrated++;
      if (result.samples.length < 10) {
        result.samples.push({
          legacyLeaveId: legacy.id,
          requestNumber,
        });
      }
      continue;
    }

    try {
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: leaveRequestsTable.id })
          .from(leaveRequestsTable)
          .where(
            and(
              eq(leaveRequestsTable.workspaceId, workspaceId),
              eq(leaveRequestsTable.requestNumber, requestNumber),
            ),
          )
          .limit(1);

        if (existing) {
          await tx
            .insert(hrLeaveMigrationMapTable)
            .values({
              workspaceId,
              legacyLeaveId: legacy.id,
              canonicalRequestId: existing.id,
            })
            .onConflictDoNothing();
          return;
        }

        const [inserted] = await tx
          .insert(leaveRequestsTable)
          .values({
            workspaceId,
            employeeId: legacy.employeeId,
            requestedByUserId,
            leaveType: legacy.leaveType,
            startDate,
            endDate,
            daysRequested,
            businessDaysCount: bizDays,
            status: canonicalStatus,
            employeeNote: legacy.reason ?? legacy.notes ?? null,
            approvedByUserId:
              canonicalStatus === "approved" ? legacy.approvedBy ?? requestedByUserId : null,
            approvedAt: canonicalStatus === "approved" ? legacy.approvedAt ?? legacy.createdAt : null,
            rejectedByUserId:
              canonicalStatus === "rejected" ? legacy.approvedBy ?? requestedByUserId : null,
            rejectedAt: canonicalStatus === "rejected" ? legacy.updatedAt : null,
            cancelledAt: canonicalStatus === "cancelled" ? legacy.updatedAt : null,
            requestNumber,
            createdAt: legacy.createdAt,
            updatedAt: legacy.updatedAt,
          })
          .returning();

        if (!inserted) throw new Error("insert_failed");

        await tx.insert(hrLeaveMigrationMapTable).values({
          workspaceId,
          legacyLeaveId: legacy.id,
          canonicalRequestId: inserted.id,
        });

        if (canonicalStatus === "approved" || canonicalStatus === "rejected") {
          const approverId = legacy.approvedBy ?? requestedByUserId;
          await tx.insert(leaveApprovalStepsTable).values({
            leaveRequestId: inserted.id,
            stepOrder: 1,
            approverUserId: approverId,
            approverRole: "migrated",
            status: canonicalStatus === "approved" ? "approved" : "rejected",
            decidedAt: legacy.approvedAt ?? legacy.updatedAt,
            comment: "P-HCM3 legacy migration",
          });
        }

        if (result.samples.length < 10) {
          result.samples.push({
            legacyLeaveId: legacy.id,
            canonicalRequestId: inserted.id,
            requestNumber,
          });
        }
      });
      result.migrated++;
    } catch (err: unknown) {
      result.skipped++;
      result.errors.push({
        legacyLeaveId: legacy.id,
        reason: err instanceof Error ? err.message : "migration_failed",
      });
    }
  }

  return result;
}
