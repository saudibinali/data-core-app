import { appendTimelineEvent } from "./timeline-service";
import { recordWorkforceAudit } from "./audit-service";

export type DocumentUploadedHook = {
  workspaceId: number;
  employeeId: number;
  documentId: number;
  name: string;
  documentType: string;
  categoryCode?: string | null;
  isSigned?: boolean;
  actorUserId?: number | null;
};

export async function onEmployeeDocumentUploaded(input: DocumentUploadedHook): Promise<void> {
  await appendTimelineEvent({
    workspaceId: input.workspaceId,
    employeeId: input.employeeId,
    eventCategory: "document",
    eventType: "document_uploaded",
    title: `Document uploaded: ${input.name}`,
    description: input.documentType,
    actorUserId: input.actorUserId,
    sourceTable: "hr_employee_documents",
    sourceId: input.documentId,
    metadata: {
      categoryCode: input.categoryCode ?? input.documentType,
      isSigned: input.isSigned ?? false,
    },
  });

  await recordWorkforceAudit({
    workspaceId: input.workspaceId,
    entityType: "employee_document",
    entityId: input.documentId,
    action: "document.uploaded",
    actorUserId: input.actorUserId,
    afterState: {
      name: input.name,
      documentType: input.documentType,
      categoryCode: input.categoryCode,
    },
  });
}
