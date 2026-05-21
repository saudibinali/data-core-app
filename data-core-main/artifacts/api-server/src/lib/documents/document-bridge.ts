/**
 * P19-C legacy bridge — dual-write to canonical registry without removing legacy fields.
 */
import { documentService, type EntityRef } from "./document-service";
import { logger } from "../logger";

export async function bridgeHrEmployeeDocument(params: {
  workspaceId: number;
  userId: number;
  employeeId: number;
  name: string;
  objectPath: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType?: string;
}): Promise<number | null> {
  if (!params.objectPath || !params.fileName) return null;

  try {
    const doc = await documentService.registerExistingFile({
      workspaceId: params.workspaceId,
      userId: params.userId,
      fileName: params.fileName,
      mimeType: params.mimeType ?? "application/octet-stream",
      sizeBytes: params.fileSize ?? 0,
      title: params.name,
      objectPath: params.objectPath,
      entity: {
        sourceType: "hr_employee_document",
        sourceEntityType: "employee",
        sourceEntityId: String(params.employeeId),
        domain: "hr",
      },
    });
    return doc.id;
  } catch (err) {
    logger.warn({ err, employeeId: params.employeeId }, "[document-bridge] HR employee document bridge failed");
    return null;
  }
}

export async function bridgeContractAttachments(params: {
  workspaceId: number;
  userId: number;
  employeeId: number;
  contractId: number;
  attachments: Array<{ name?: string; objectPath?: string; size?: number }> | null;
}): Promise<number[]> {
  if (!params.attachments?.length) return [];
  const ids: number[] = [];
  for (const att of params.attachments) {
    if (!att.objectPath) continue;
    try {
      const doc = await documentService.registerExistingFile({
        workspaceId: params.workspaceId,
        userId: params.userId,
        fileName: att.name ?? "attachment",
        mimeType: "application/octet-stream",
        sizeBytes: att.size ?? 0,
        title: att.name,
        objectPath: att.objectPath,
        entity: {
          sourceType: "hr_contract",
          sourceEntityType: "contract",
          sourceEntityId: String(params.contractId),
          domain: "hr",
        },
      });
      ids.push(doc.id);
    } catch (err) {
      logger.warn({ err, contractId: params.contractId }, "[document-bridge] contract attachment bridge failed");
    }
  }
  return ids;
}

export async function bridgeLeaveAttachments(params: {
  workspaceId: number;
  userId: number;
  leaveRequestId: number;
  attachmentUrls: string[];
}): Promise<number[]> {
  const ids: number[] = [];
  for (const url of params.attachmentUrls) {
    if (!url) continue;
    try {
      const fileName = url.split("/").pop() ?? "attachment";
      const doc = await documentService.registerExistingFile({
        workspaceId: params.workspaceId,
        userId: params.userId,
        fileName,
        mimeType: "application/octet-stream",
        sizeBytes: 0,
        objectPath: url.startsWith("/objects/") ? url : `/objects/${url.replace(/^\//, "")}`,
        entity: {
          sourceType: "leave_request",
          sourceEntityType: "leave_request",
          sourceEntityId: String(params.leaveRequestId),
          domain: "leave",
        },
      });
      ids.push(doc.id);
    } catch (err) {
      logger.warn({ err, leaveRequestId: params.leaveRequestId }, "[document-bridge] leave attachment bridge failed");
    }
  }
  return ids;
}

export type { EntityRef };
