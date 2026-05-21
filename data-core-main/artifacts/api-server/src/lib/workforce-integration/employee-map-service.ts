import { db } from "@workspace/db";
import {
  attendanceIntegrationEmployeeMapTable,
  attendanceIntegrationsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

export class EmployeeMapService {
  async resolveEmployeeId(
    workspaceId: number,
    integrationId: number,
    externalEmployeeId: string,
  ): Promise<{ employeeId: number | null; status: string; confidence: number }> {
    const [row] = await db
      .select()
      .from(attendanceIntegrationEmployeeMapTable)
      .where(
        and(
          eq(attendanceIntegrationEmployeeMapTable.integrationId, integrationId),
          eq(attendanceIntegrationEmployeeMapTable.externalEmployeeId, externalEmployeeId),
        ),
      )
      .limit(1);

    if (!row || row.workspaceId !== workspaceId) {
      return { employeeId: null, status: "unresolved", confidence: 0 };
    }
    if (row.status === "ignored") {
      return { employeeId: null, status: "ignored", confidence: row.confidence };
    }
    return {
      employeeId: row.employeeId,
      status: row.employeeId ? row.status : "unresolved",
      confidence: row.confidence,
    };
  }

  async upsertMapping(input: {
    workspaceId: number;
    integrationId: number;
    externalEmployeeId: string;
    employeeId: number | null;
    confidence?: number;
    status?: string;
  }) {
    const status =
      input.status ?? (input.employeeId != null ? "mapped" : "unresolved");
    const [existing] = await db
      .select({ id: attendanceIntegrationEmployeeMapTable.id })
      .from(attendanceIntegrationEmployeeMapTable)
      .where(
        and(
          eq(attendanceIntegrationEmployeeMapTable.integrationId, input.integrationId),
          eq(
            attendanceIntegrationEmployeeMapTable.externalEmployeeId,
            input.externalEmployeeId,
          ),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(attendanceIntegrationEmployeeMapTable)
        .set({
          employeeId: input.employeeId,
          confidence: input.confidence ?? 100,
          status,
          updatedAt: new Date(),
        })
        .where(eq(attendanceIntegrationEmployeeMapTable.id, existing.id));
      return existing.id;
    }

    const [ins] = await db
      .insert(attendanceIntegrationEmployeeMapTable)
      .values({
        workspaceId: input.workspaceId,
        integrationId: input.integrationId,
        externalEmployeeId: input.externalEmployeeId,
        employeeId: input.employeeId,
        confidence: input.confidence ?? 100,
        status,
      })
      .returning({ id: attendanceIntegrationEmployeeMapTable.id });
    return ins!.id;
  }

  async listMappings(workspaceId: number, integrationId: number) {
    return db
      .select()
      .from(attendanceIntegrationEmployeeMapTable)
      .where(
        and(
          eq(attendanceIntegrationEmployeeMapTable.workspaceId, workspaceId),
          eq(attendanceIntegrationEmployeeMapTable.integrationId, integrationId),
        ),
      );
  }

  async assertIntegrationInWorkspace(workspaceId: number, integrationId: number) {
    const [row] = await db
      .select()
      .from(attendanceIntegrationsTable)
      .where(
        and(
          eq(attendanceIntegrationsTable.id, integrationId),
          eq(attendanceIntegrationsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row) throw new Error("Integration not found");
    return row;
  }
}

export const employeeMapService = new EmployeeMapService();
