import { db } from "@workspace/db";
import {
  approvalInstancesTable,
  employeesTable,
  hrDocumentTypesTable,
  hrEmployeeActivityTable,
  hrEmployeeContractsTable,
  hrEmployeeDocumentsTable,
  hrEmployeeNotesTable,
  hrJobTitlesTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getFullReportingChain } from "../org/reporting-hierarchy-service";
import { getOrgUnitAncestors } from "../org/org-graph-service";
import { listEmployeeMovements } from "./movement-service";
import { getEmployeeTimeline } from "./timeline-service";
import { listLifecycleEvents } from "./lifecycle-service";
import { getWorkforceGovernanceMode, getWorkforceActivationRequires } from "./settings";

export async function getEmployeeFileAggregate(workspaceId: number, employeeId: number) {
  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(
      and(eq(employeesTable.id, employeeId), eq(employeesTable.workspaceId, workspaceId)),
    )
    .limit(1);

  if (!employee) {
    throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
  }

  const [
    documents,
    contracts,
    notes,
    movements,
    timeline,
    lifecycleEvents,
    recentActivity,
    documentTypes,
    governanceMode,
    activationRequires,
  ] = await Promise.all([
    db
      .select()
      .from(hrEmployeeDocumentsTable)
      .where(
        and(
          eq(hrEmployeeDocumentsTable.employeeId, employeeId),
          eq(hrEmployeeDocumentsTable.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(hrEmployeeDocumentsTable.createdAt))
      .limit(50),
    db
      .select()
      .from(hrEmployeeContractsTable)
      .where(
        and(
          eq(hrEmployeeContractsTable.employeeId, employeeId),
          eq(hrEmployeeContractsTable.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(hrEmployeeContractsTable.createdAt))
      .limit(20),
    db
      .select()
      .from(hrEmployeeNotesTable)
      .where(
        and(
          eq(hrEmployeeNotesTable.employeeId, employeeId),
          eq(hrEmployeeNotesTable.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(hrEmployeeNotesTable.createdAt))
      .limit(20),
    listEmployeeMovements(workspaceId, employeeId, 20),
    getEmployeeTimeline(workspaceId, employeeId, 30),
    listLifecycleEvents(workspaceId, employeeId, 20),
    db
      .select()
      .from(hrEmployeeActivityTable)
      .where(
        and(
          eq(hrEmployeeActivityTable.employeeId, employeeId),
          eq(hrEmployeeActivityTable.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(hrEmployeeActivityTable.createdAt))
      .limit(20),
    db
      .select()
      .from(hrDocumentTypesTable)
      .where(
        and(
          eq(hrDocumentTypesTable.workspaceId, workspaceId),
          eq(hrDocumentTypesTable.isActive, true),
        ),
      ),
    getWorkforceGovernanceMode(workspaceId),
    getWorkforceActivationRequires(workspaceId),
  ]);

  let orgPath: Array<{ id: number; name: string; type: string }> = [];
  if (employee.orgUnitId) {
    const ancestors = await getOrgUnitAncestors(workspaceId, employee.orgUnitId);
    orgPath = ancestors.map((u) => ({ id: u.id, name: u.name, type: u.type }));
  }

  let reportingChain: Awaited<ReturnType<typeof getFullReportingChain>> = [];
  try {
    reportingChain = await getFullReportingChain(workspaceId, employeeId);
  } catch {
    reportingChain = [];
  }

  let managerName: string | null = null;
  if (employee.directManagerId) {
    const [mgr] = await db
      .select({ fullName: employeesTable.fullName })
      .from(employeesTable)
      .where(eq(employeesTable.id, employee.directManagerId))
      .limit(1);
    managerName = mgr?.fullName ?? null;
  }

  let jobTitleName: string | null = null;
  if (employee.jobTitleId) {
    const [jt] = await db
      .select({ name: hrJobTitlesTable.name })
      .from(hrJobTitlesTable)
      .where(eq(hrJobTitlesTable.id, employee.jobTitleId))
      .limit(1);
    jobTitleName = jt?.name ?? null;
  }

  const approvals = await db
    .select()
    .from(approvalInstancesTable)
    .where(
      and(
        eq(approvalInstancesTable.workspaceId, workspaceId),
        inArray(approvalInstancesTable.entityType, ["employee", "workforce_lifecycle"]),
      ),
    )
    .orderBy(desc(approvalInstancesTable.createdAt))
    .limit(20);

  const employeeApprovals = approvals.filter(
    (a) =>
      (a.entityType === "employee" && a.entityId === employeeId)
      || (a.context && typeof a.context === "object"
        && (a.context as { employeeId?: number }).employeeId === employeeId),
  );

  const requiredTypes = documentTypes.filter((t) => t.isRequired);
  const uploadedCodes = new Set(
    documents.map((d) => (d as { categoryCode?: string | null }).categoryCode ?? d.documentType).filter(Boolean),
  );
  const documentCompliance = {
    required: requiredTypes.length,
    met: requiredTypes.filter((t) => t.code && uploadedCodes.has(t.code)).length,
    missing: requiredTypes
      .filter((t) => t.code && !uploadedCodes.has(t.code))
      .map((t) => ({ code: t.code, name: t.name })),
  };

  const activeContract = contracts.find((c) => c.status === "active") ?? contracts[0] ?? null;

  const lifecycleState = deriveLifecycleState(employee.status, lifecycleEvents);

  return {
    employee,
    summary: {
      orgPath,
      managerName,
      jobTitleName,
      reportingChainDepth: reportingChain.length,
      lifecycleState,
      documentCompliance,
      activeContractId: activeContract?.id ?? null,
    },
    sections: {
      documents,
      contracts,
      notes,
      movements,
      timeline,
      lifecycleEvents,
      recentActivity,
      approvals: employeeApprovals,
    },
    runtime: {
      governanceMode,
      activationRequires,
    },
  };
}

function deriveLifecycleState(
  status: string,
  events: Array<{ eventType: string; status: string }>,
): string {
  const pending = events.find((e) => e.status === "pending" || e.status === "in_progress");
  if (pending) return `${pending.eventType}_${pending.status}`;
  if (status === "terminated" || status === "resigned") return "offboarded";
  if (status === "active") return "active";
  return status;
}
