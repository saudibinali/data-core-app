import { db } from "@workspace/db";
import { documentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { ObjectStorageService } from "../../objectStorage";

const objectStorage = new ObjectStorageService();

export async function readDocumentBuffer(
  documentId: number,
  workspaceId: number,
): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, documentId), eq(documentsTable.workspaceId, workspaceId)))
    .limit(1);
  if (!doc?.storageKey || doc.status !== "active") {
    throw new Error("Document not found or not ready");
  }
  const file = await objectStorage.getObjectEntityFile(doc.storageKey);
  const [contents] = await file.download();
  return {
    buffer: Buffer.from(contents),
    mimeType: doc.mimeType ?? "application/octet-stream",
    fileName: doc.fileName,
  };
}
