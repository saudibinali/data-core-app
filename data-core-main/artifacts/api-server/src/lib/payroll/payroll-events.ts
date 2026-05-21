/**
 * P21-C — Payroll domain events → notification bus
 */
import { appEventBus } from "../events/app-bus";
import { EVENT_TYPES } from "@workspace/core-events";
import { dispatchUserNotification } from "../notifications/dispatch";
import { db, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

export type PayrollEventType =
  | typeof PAYROLL_EVENT_TYPES.RUN_CREATED
  | typeof PAYROLL_EVENT_TYPES.RUN_REVIEW
  | typeof PAYROLL_EVENT_TYPES.RUN_APPROVED
  | typeof PAYROLL_EVENT_TYPES.PAYSLIP_ISSUED;

export async function emitPayrollEvent(
  type: PayrollEventType,
  data: {
    workspaceId: number;
    userId?: number;
    runId: number;
    payslipId?: number;
    employeeId?: number;
    runType?: string;
  },
): Promise<void> {
  await appEventBus.emit({
    type,
    module: "hr",
    workspace: { workspaceId: data.workspaceId },
    actor: { userId: data.userId, role: undefined },
    metadata: { idempotencyKey: `${type}-${data.runId}-${data.payslipId ?? "run"}` },
    data: {
      runId: data.runId,
      payslipId: data.payslipId,
      employeeId: data.employeeId,
      runType: data.runType,
    },
  });
}

export function registerPayrollBusListeners(): void {
  appEventBus.subscribe(EVENT_TYPES.PAYROLL_RUN_CREATED, async (event) => {
    logger.info({ runId: event.data.runId }, "[payroll-bus] run created");
  });

  appEventBus.subscribe(EVENT_TYPES.PAYROLL_RUN_REVIEW, async (event) => {
    logger.info({ runId: event.data.runId }, "[payroll-bus] run in review");
  });

  appEventBus.subscribe(EVENT_TYPES.PAYROLL_RUN_APPROVED, async (event) => {
    logger.info({ runId: event.data.runId }, "[payroll-bus] run approved");
  });

  appEventBus.subscribe(EVENT_TYPES.PAYROLL_PAYSLIP_ISSUED, async (event) => {
    const { employeeId, payslipId, runId } = event.data;
    if (!employeeId) return;

    const [emp] = await db
      .select({ userId: employeesTable.userId })
      .from(employeesTable)
      .where(eq(employeesTable.id, employeeId))
      .limit(1);

    if (!emp?.userId) return;

    await dispatchUserNotification({
      workspaceId: event.workspace.workspaceId,
      userId: emp.userId,
      type: "payroll_payslip_issued",
      title: "Payslip issued",
      message: `Your payslip #${payslipId} for payroll run ${runId} is available.`,
      enqueueEmail: false,
    });
  });
}
