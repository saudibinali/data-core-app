import { db } from "@workspace/db";
import { documentAccessLogsTable, documentsTable, type Document } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import type { AuthRequest } from "../../middlewares/requireAuth";

export type DocumentAccessAction = "view" | "download" | "upload" | "archive";

export class DocumentAccessService {
  async canAccess(params: {
    userId: number;
    workspaceId: number;
    userRole?: string;
    userPermissions?: string[];
    document: Document;
    action: DocumentAccessAction;
  }): Promise<boolean> {
    const { document, workspaceId, userId, userRole, userPermissions, action } = params;

    if (document.workspaceId !== workspaceId) return false;
    if (document.deletedAt) return false;
    if (document.status === "purged") return false;
    if (action === "upload") return true;

    if (document.status === "archived" && action === "download") {
      return (
        userRole === "admin" ||
        userRole === "super_admin" ||
        userPermissions?.includes("hr.manage") === true
      );
    }

    if (document.isConfidential || document.classification === "confidential") {
      const isAdmin = userRole === "admin" || userRole === "super_admin";
      const hasHr = userPermissions?.includes("hr.manage") || userPermissions?.includes("hr.view");
      if (!isAdmin && !hasHr && document.createdByUserId !== userId) {
        return false;
      }
    }

    return document.status === "active" || document.status === "archived";
  }

  async logAccess(params: {
    workspaceId: number;
    documentId: number;
    userId: number | null;
    action: DocumentAccessAction;
    req?: AuthRequest;
  }): Promise<void> {
    await db.insert(documentAccessLogsTable).values({
      workspaceId: params.workspaceId,
      documentId: params.documentId,
      userId: params.userId,
      action: params.action,
      ipAddress: params.req?.ip ?? null,
      userAgent: typeof params.req?.headers["user-agent"] === "string" ? params.req.headers["user-agent"] : null,
    });
  }

  async assertActiveDocument(documentId: number, workspaceId: number): Promise<Document | null> {
    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(
        and(
          eq(documentsTable.id, documentId),
          eq(documentsTable.workspaceId, workspaceId),
          isNull(documentsTable.deletedAt),
        ),
      )
      .limit(1);
    return doc ?? null;
  }
}

export const documentAccessService = new DocumentAccessService();
