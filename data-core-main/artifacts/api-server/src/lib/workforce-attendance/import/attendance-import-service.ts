import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import {
  importJobsTable,
  documentsTable,
  attendanceImportBatchesTable,
  attendanceImportRowsTable,
  attendanceAdjustmentsTable,
  hrAttendanceTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { documentService } from "../../documents/document-service";
import { storeImportFile } from "./import-artifact-storage";
import { dispatchUserNotification } from "../../notifications/dispatch";
import { parseAttendanceImportBuffer } from "./import-parser";
import { validateImportRows, type ValidatedImportRow } from "./import-validator";
import {
  buildReconciliationFromRows,
  persistReconciliationReport,
  type ReconciliationSummary,
} from "./import-reconciliation";
import { readDocumentBuffer } from "./document-buffer";
import { ImportTemplateRegistry } from "./import-template-registry";
import { processImportRow } from "./import-row-processor";
const IMPORT_TYPE = "attendance.period";

export type StartImportInput = {
  workspaceId: number;
  userId: number;
  templateKey: string;
  dryRun: boolean;
  documentId?: number;
  fileBuffer?: Buffer;
  mimeType?: string;
  fileName?: string;
  mappingJson?: string;
};

export class AttendanceImportService {
  async startImport(input: StartImportInput): Promise<{
    importJobId: number;
    batchId: number;
    dryRun: boolean;
    validation: Awaited<ReturnType<typeof validateImportRows>>;
  }> {
    ImportTemplateRegistry.require(input.templateKey);

    let documentId = input.documentId;
    let buffer = input.fileBuffer;

    if (documentId && !buffer) {
      const doc = await readDocumentBuffer(documentId, input.workspaceId);
      buffer = doc.buffer;
      input.mimeType = doc.mimeType;
      input.fileName = doc.fileName;
    }

    if (!buffer) throw new Error("No import file provided");

    const [job] = await db
      .insert(importJobsTable)
      .values({
        workspaceId: input.workspaceId,
        importType: IMPORT_TYPE,
        status: "processing",
        dryRun: input.dryRun,
        sourceStorageKey: `document:${documentId}`,
        createdByUserId: input.userId,
      })
      .returning();

    const revertToken = input.dryRun ? null : `rev_${randomBytes(16).toString("hex")}`;

    const [batch] = await db
      .insert(attendanceImportBatchesTable)
      .values({
        workspaceId: input.workspaceId,
        importJobId: job!.id,
        fileDocumentId: documentId ?? null,
        templateKey: input.templateKey,
        mappingJson: input.mappingJson ?? null,
        dryRun: input.dryRun,
        status: "validating",
        revertToken,
        createdByUserId: input.userId,
      })
      .returning();

    const storageKey = await storeImportFile(
      input.workspaceId,
      batch!.id,
      input.fileName ?? "attendance-import.xlsx",
      buffer,
    );

    await db
      .update(importJobsTable)
      .set({ sourceStorageKey: storageKey })
      .where(eq(importJobsTable.id, job!.id));

    if (documentId) {
      await documentService.attachToEntity(documentId, input.workspaceId, {
        sourceType: "hr",
        sourceEntityType: "attendance_import_batch",
        sourceEntityId: String(batch!.id),
      });
    }

    const parsed = parseAttendanceImportBuffer(buffer, input.templateKey, input.mimeType);
    const validation = await validateImportRows(input.workspaceId, parsed);

    for (const row of validation.rows) {
      await db.insert(attendanceImportRowsTable).values({
        workspaceId: input.workspaceId,
        batchId: batch!.id,
        rowNumber: row.rowNumber,
        employeeId: row.employeeId ?? null,
        localDate: row.date ?? null,
        rawJson: JSON.stringify({ raw: row.raw, resolved: row }),
        validationStatus: row.errors.length > 0 ? "invalid" : "valid",
        errorsJson: row.errors.length ? JSON.stringify(row.errors) : null,
        warningsJson:
          row.warnings.length || row.normalizationWarnings.length
            ? JSON.stringify([...row.warnings, ...row.normalizationWarnings])
            : null,
      });
    }

    const summary = {
      stats: validation.stats,
      dryRun: input.dryRun,
      rowCount: validation.rows.length,
    };

    if (input.dryRun) {
      await db
        .update(importJobsTable)
        .set({
          status: "completed",
          summaryJson: JSON.stringify(summary),
          completedAt: new Date(),
        })
        .where(eq(importJobsTable.id, job!.id));

      await db
        .update(attendanceImportBatchesTable)
        .set({
          status: "dry_run_complete",
          summaryJson: JSON.stringify(summary),
          completedAt: new Date(),
        })
        .where(eq(attendanceImportBatchesTable.id, batch!.id));

      await this.notifyDryRunReady(input.workspaceId, input.userId, batch!.id);
    } else {
      await db
        .update(attendanceImportBatchesTable)
        .set({ status: "awaiting_confirm", summaryJson: JSON.stringify(summary) })
        .where(eq(attendanceImportBatchesTable.id, batch!.id));

      await db
        .update(importJobsTable)
        .set({ status: "awaiting_confirm", summaryJson: JSON.stringify(summary) })
        .where(eq(importJobsTable.id, job!.id));
    }

    return {
      importJobId: job!.id,
      batchId: batch!.id,
      dryRun: input.dryRun,
      validation,
    };
  }

  async confirmImport(params: {
    workspaceId: number;
    userId: number;
    batchId: number;
  }): Promise<{
    reconciliation: ReconciliationSummary;
    reconciliationReportId: number;
    importJobId: number;
  }> {
    const [batch] = await db
      .select()
      .from(attendanceImportBatchesTable)
      .where(
        and(
          eq(attendanceImportBatchesTable.id, params.batchId),
          eq(attendanceImportBatchesTable.workspaceId, params.workspaceId),
        ),
      )
      .limit(1);

    if (!batch) throw new Error("Import batch not found");
    if (batch.status === "completed") throw new Error("Import already completed");
    if (batch.revertedAt) throw new Error("Import was reverted");

    const rowRecords = await db
      .select()
      .from(attendanceImportRowsTable)
      .where(eq(attendanceImportRowsTable.batchId, params.batchId))
      .orderBy(attendanceImportRowsTable.rowNumber);

    const revertToken = batch.revertToken ?? `rev_${randomBytes(16).toString("hex")}`;

    await db
      .update(attendanceImportBatchesTable)
      .set({ status: "processing", dryRun: false, revertToken })
      .where(eq(attendanceImportBatchesTable.id, params.batchId));

    await db
      .update(importJobsTable)
      .set({ status: "processing" })
      .where(eq(importJobsTable.id, batch.importJobId));

    const applied: Array<{
      row: ValidatedImportRow;
      outcome: "inserted" | "updated" | "skipped" | "failed";
      error?: string;
    }> = [];

    const seenKeys = new Set<string>();

    for (const rec of rowRecords) {
      if (rec.validationStatus !== "valid" || !rec.employeeId || !rec.localDate) {
        applied.push({
          row: {
            rowNumber: rec.rowNumber,
            raw: JSON.parse(rec.rawJson) as Record<string, string>,
            errors: rec.errorsJson ? (JSON.parse(rec.errorsJson) as string[]) : ["invalid"],
            warnings: [],
            normalizationWarnings: [],
            isNew: true,
            fileDuplicate: false,
            employeeId: rec.employeeId ?? undefined,
            date: rec.localDate ?? undefined,
          },
          outcome: "skipped",
        });
        continue;
      }

      const key = `${rec.employeeId}__${rec.localDate}`;
      if (seenKeys.has(key)) {
        applied.push({
          row: {
            rowNumber: rec.rowNumber,
            raw: JSON.parse(rec.rawJson) as Record<string, string>,
            errors: [],
            warnings: ["skipped duplicate in file"],
            normalizationWarnings: [],
            isNew: false,
            fileDuplicate: true,
            employeeId: rec.employeeId,
            date: rec.localDate,
          },
          outcome: "skipped",
        });
        continue;
      }
      seenKeys.add(key);

      const stored = JSON.parse(rec.rawJson) as {
        raw?: Record<string, string>;
        resolved?: ValidatedImportRow;
      };
      const row: ValidatedImportRow = stored.resolved ?? {
        rowNumber: rec.rowNumber,
        raw: stored.raw ?? {},
        employeeId: rec.employeeId,
        date: rec.localDate,
        errors: [],
        warnings: [],
        normalizationWarnings: [],
        isNew: true,
        fileDuplicate: false,
      };

      try {
        const result = await processImportRow({
          workspaceId: params.workspaceId,
          userId: params.userId,
          batchId: params.batchId,
          row,
        });

        await db
          .update(attendanceImportRowsTable)
          .set({
            outcome: result.outcome,
            rawEventId: result.rawEventId ?? null,
            legacyAttendanceId: result.legacyAttendanceId ?? null,
            appliedAt: new Date(),
          })
          .where(eq(attendanceImportRowsTable.id, rec.id));

        if (result.outcome === "inserted" || result.outcome === "updated") {
          await db.insert(attendanceAdjustmentsTable).values({
            workspaceId: params.workspaceId,
            batchId: params.batchId,
            employeeId: rec.employeeId,
            localDate: rec.localDate,
            adjustmentType: result.outcome === "inserted" ? "import_insert" : "import_update",
            metadataJson: JSON.stringify({
              revertToken: batch.revertToken,
              legacyAttendanceId: result.legacyAttendanceId,
              importJobId: batch.importJobId,
            }),
            createdByUserId: params.userId,
          });
        }

        applied.push({ row, outcome: result.outcome });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        applied.push({ row, outcome: "failed", error: message });
        await db
          .update(attendanceImportRowsTable)
          .set({ outcome: "failed", errorsJson: JSON.stringify([message]) })
          .where(eq(attendanceImportRowsTable.id, rec.id));
      }
    }

    const reconciliation = buildReconciliationFromRows(applied);
    const reconciliationReportId = await persistReconciliationReport({
      workspaceId: params.workspaceId,
      userId: params.userId,
      batchId: params.batchId,
      summary: reconciliation,
    });

    await db
      .update(attendanceImportBatchesTable)
      .set({
        status: "completed",
        summaryJson: JSON.stringify(reconciliation),
        reconciliationReportId,
        completedAt: new Date(),
      })
      .where(eq(attendanceImportBatchesTable.id, params.batchId));

    await db
      .update(importJobsTable)
      .set({
        status: reconciliation.failed > 0 ? "completed_with_errors" : "completed",
        summaryJson: JSON.stringify(reconciliation),
        completedAt: new Date(),
      })
      .where(eq(importJobsTable.id, batch.importJobId));

    await this.notifyImportCompleted(params.workspaceId, params.userId, params.batchId, reconciliation);

    return { reconciliation, reconciliationReportId, importJobId: batch.importJobId };
  }

  async revertImport(params: {
    workspaceId: number;
    userId: number;
    batchId: number;
    revertToken: string;
  }): Promise<{ reverted: number }> {
    const [batch] = await db
      .select()
      .from(attendanceImportBatchesTable)
      .where(
        and(
          eq(attendanceImportBatchesTable.id, params.batchId),
          eq(attendanceImportBatchesTable.workspaceId, params.workspaceId),
        ),
      )
      .limit(1);

    if (!batch?.revertToken || batch.revertToken !== params.revertToken) {
      throw new Error("Invalid revert token");
    }
    if (batch.revertedAt) throw new Error("Already reverted");

    const adjustments = await db
      .select()
      .from(attendanceAdjustmentsTable)
      .where(
        and(
          eq(attendanceAdjustmentsTable.batchId, params.batchId),
          eq(attendanceAdjustmentsTable.workspaceId, params.workspaceId),
          sql`${attendanceAdjustmentsTable.revertedAt} IS NULL`,
        ),
      );

    let reverted = 0;
    for (const adj of adjustments) {
      const meta = JSON.parse(adj.metadataJson) as { legacyAttendanceId?: number };
      if (adj.adjustmentType === "import_insert" && meta.legacyAttendanceId) {
        await db
          .update(hrAttendanceTable)
          .set({
            notes: sql`COALESCE(${hrAttendanceTable.notes}, '') || ' [import reverted]'`,
            status: "absent",
            checkIn: null,
            checkOut: null,
          })
          .where(eq(hrAttendanceTable.id, meta.legacyAttendanceId));
      }
      await db
        .update(attendanceAdjustmentsTable)
        .set({ revertedAt: new Date() })
        .where(eq(attendanceAdjustmentsTable.id, adj.id));
      reverted++;
    }

    await db
      .update(attendanceImportBatchesTable)
      .set({ revertedAt: new Date(), status: "reverted" })
      .where(eq(attendanceImportBatchesTable.id, params.batchId));

    return { reverted };
  }

  async listImportHistory(workspaceId: number, limit = 20) {
    return db
      .select({
        batch: attendanceImportBatchesTable,
        job: importJobsTable,
      })
      .from(attendanceImportBatchesTable)
      .innerJoin(importJobsTable, eq(attendanceImportBatchesTable.importJobId, importJobsTable.id))
      .where(eq(attendanceImportBatchesTable.workspaceId, workspaceId))
      .orderBy(desc(attendanceImportBatchesTable.createdAt))
      .limit(limit);
  }

  async getImportStatus(workspaceId: number, batchId: number) {
    const [batch] = await db
      .select()
      .from(attendanceImportBatchesTable)
      .where(
        and(
          eq(attendanceImportBatchesTable.id, batchId),
          eq(attendanceImportBatchesTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!batch) return null;

    const [job] = await db
      .select()
      .from(importJobsTable)
      .where(eq(importJobsTable.id, batch.importJobId))
      .limit(1);

    const rows = await db
      .select({
        validationStatus: attendanceImportRowsTable.validationStatus,
        outcome: attendanceImportRowsTable.outcome,
      })
      .from(attendanceImportRowsTable)
      .where(eq(attendanceImportRowsTable.batchId, batchId));

    return { batch, job, rowStats: rows };
  }

  private async notifyDryRunReady(workspaceId: number, userId: number, batchId: number) {
    await dispatchUserNotification({
      workspaceId,
      userId,
      type: "attendance_import_dry_run_ready",
      title: "Import validation ready",
      message: `Attendance import batch #${batchId} dry-run is ready for review.`,
      enqueueEmail: false,
    });
  }

  private async notifyImportCompleted(
    workspaceId: number,
    userId: number,
    batchId: number,
    summary: ReconciliationSummary,
  ) {
    const failed = summary.failed > 0;
    await dispatchUserNotification({
      workspaceId,
      userId,
      type: failed ? "attendance_import_failed" : "attendance_import_completed",
      title: failed ? "Import completed with errors" : "Import completed",
      message: `Batch #${batchId}: ${summary.inserted} inserted, ${summary.updated} updated, ${summary.failed} failed.`,
      enqueueEmail: false,
    });
  }
}

export const attendanceImportService = new AttendanceImportService();
