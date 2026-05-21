import { db } from "@workspace/db";
import { attendanceSourcesTable, workspacesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../logger";

const DEFAULT_SOURCES = [
  { code: "manual", name: "Manual Entry", sourceKind: "manual", defaultPriority: 100, trustLevel: 90 },
  { code: "web", name: "Web Clock", sourceKind: "web", defaultPriority: 80, trustLevel: 85 },
  { code: "excel", name: "Excel Import", sourceKind: "excel", defaultPriority: 60, trustLevel: 70 },
  { code: "system", name: "System Generated", sourceKind: "system", defaultPriority: 40, trustLevel: 95 },
  { code: "vendor", name: "Vendor Integration", sourceKind: "vendor", defaultPriority: 50, trustLevel: 75 },
] as const;

export async function seedAttendanceSourcesForWorkspace(workspaceId: number): Promise<void> {
  for (const src of DEFAULT_SOURCES) {
    await db
      .insert(attendanceSourcesTable)
      .values({ workspaceId, ...src })
      .onConflictDoNothing({
        target: [attendanceSourcesTable.workspaceId, attendanceSourcesTable.code],
      });
  }
}

export async function seedAllWorkspaceAttendanceSources(): Promise<number> {
  const workspaces = await db.select({ id: workspacesTable.id }).from(workspacesTable);
  for (const ws of workspaces) {
    await seedAttendanceSourcesForWorkspace(ws.id);
  }
  logger.info({ count: workspaces.length }, "[workforce] attendance sources seeded");
  return workspaces.length;
}

export async function getSourceByCode(workspaceId: number, code: string) {
  const [row] = await db
    .select()
    .from(attendanceSourcesTable)
    .where(
      and(eq(attendanceSourcesTable.workspaceId, workspaceId), eq(attendanceSourcesTable.code, code)),
    )
    .limit(1);
  return row ?? null;
}

export async function requireSourceByCode(workspaceId: number, code: string) {
  const src = await getSourceByCode(workspaceId, code);
  if (!src || !src.isActive) throw new Error(`Unknown or inactive attendance source: ${code}`);
  return src;
}
