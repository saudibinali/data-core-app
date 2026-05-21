import { db } from "@workspace/db";
import { documentFoldersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export type FolderType = "employee" | "workspace" | "payroll" | "reports";

/** Minimal folder foundation — no tree UI. */
export async function ensureDocumentFolder(params: {
  workspaceId: number;
  folderType: FolderType;
  name: string;
  entityType?: string;
  entityId?: string;
  parentPath?: string;
}): Promise<number> {
  const base = params.parentPath ?? `/${params.folderType}`;
  const pathMaterialized =
    params.entityType && params.entityId
      ? `${base}/${params.entityType}/${params.entityId}/${params.name}`
      : `${base}/${params.name}`;

  const [existing] = await db
    .select({ id: documentFoldersTable.id })
    .from(documentFoldersTable)
    .where(
      and(
        eq(documentFoldersTable.workspaceId, params.workspaceId),
        eq(documentFoldersTable.pathMaterialized, pathMaterialized),
      ),
    )
    .limit(1);

  if (existing) return existing.id;

  const [inserted] = await db
    .insert(documentFoldersTable)
    .values({
      workspaceId: params.workspaceId,
      name: params.name,
      pathMaterialized,
      folderType: params.folderType,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
    })
    .returning({ id: documentFoldersTable.id });

  return inserted!.id;
}

export async function ensureEmployeeFolder(workspaceId: number, employeeId: number): Promise<number> {
  return ensureDocumentFolder({
    workspaceId,
    folderType: "employee",
    name: "root",
    entityType: "employee",
    entityId: String(employeeId),
  });
}

export async function ensureWorkspaceFolder(workspaceId: number): Promise<number> {
  return ensureDocumentFolder({
    workspaceId,
    folderType: "workspace",
    name: "shared",
  });
}

export async function ensurePayrollFolder(workspaceId: number): Promise<number> {
  return ensureDocumentFolder({
    workspaceId,
    folderType: "payroll",
    name: "payroll",
  });
}

export async function ensureReportsFolder(workspaceId: number): Promise<number> {
  return ensureDocumentFolder({
    workspaceId,
    folderType: "reports",
    name: "generated",
  });
}
