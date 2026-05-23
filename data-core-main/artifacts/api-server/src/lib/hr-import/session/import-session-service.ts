/**
 * Import session runtime — foundation CRUD (Phase 1, dry-run default).
 */

import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import {
  hrImportSessionsTable,
  hrImportSessionRowsTable,
  type HrImportSession,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import type { ImportRuntimeMode } from "../runtime-settings";

export type CreateImportSessionInput = {
  workspaceId: number;
  importType: string;
  templateKey?: string;
  templateVersion?: string;
  runtimeMode?: ImportRuntimeMode;
  dryRun?: boolean;
  createdByUserId?: number;
  mappingJson?: unknown;
  sourcePath?: string;
};

export type AppendSessionRowInput = {
  sessionId: number;
  workspaceId: number;
  rowNumber: number;
  rawRow?: unknown;
  normalizedRow?: unknown;
  validationResult?: unknown;
  action?: string;
  status?: string;
  errors?: unknown;
  warnings?: unknown;
};

export class ImportSessionService {
  async createSession(input: CreateImportSessionInput): Promise<HrImportSession> {
    const dryRun = input.dryRun !== false;
    const [session] = await db
      .insert(hrImportSessionsTable)
      .values({
        workspaceId: input.workspaceId,
        importType: input.importType,
        status: "draft",
        templateKey: input.templateKey ?? null,
        templateVersion: input.templateVersion ?? null,
        runtimeMode: input.runtimeMode ?? "legacy",
        dryRun,
        mappingJson: input.mappingJson ?? null,
        revertToken: dryRun ? null : `rev_${randomBytes(16).toString("hex")}`,
        sourcePath: input.sourcePath ?? null,
        createdByUserId: input.createdByUserId ?? null,
        summary: { phase: 1, note: "foundation_session" },
      })
      .returning();
    return session!;
  }

  async getSession(workspaceId: number, sessionId: number): Promise<HrImportSession | null> {
    const [row] = await db
      .select()
      .from(hrImportSessionsTable)
      .where(
        and(
          eq(hrImportSessionsTable.id, sessionId),
          eq(hrImportSessionsTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async listSessions(workspaceId: number, limit = 25): Promise<HrImportSession[]> {
    return db
      .select()
      .from(hrImportSessionsTable)
      .where(eq(hrImportSessionsTable.workspaceId, workspaceId))
      .orderBy(desc(hrImportSessionsTable.createdAt))
      .limit(Math.min(limit, 100));
  }

  async updateSessionStatus(
    workspaceId: number,
    sessionId: number,
    status: string,
    summary?: unknown,
  ): Promise<HrImportSession | null> {
    const [row] = await db
      .update(hrImportSessionsTable)
      .set({ status, summary: summary ?? undefined })
      .where(
        and(
          eq(hrImportSessionsTable.id, sessionId),
          eq(hrImportSessionsTable.workspaceId, workspaceId),
        ),
      )
      .returning();
    return row ?? null;
  }

  async appendRow(input: AppendSessionRowInput): Promise<void> {
    await db
      .insert(hrImportSessionRowsTable)
      .values({
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        rowNumber: input.rowNumber,
        rawRow: input.rawRow ?? null,
        normalizedRow: input.normalizedRow ?? null,
        validationResult: input.validationResult ?? null,
        action: input.action ?? null,
        status: input.status ?? "pending",
        errors: input.errors ?? null,
        warnings: input.warnings ?? null,
      })
      .onConflictDoUpdate({
        target: [hrImportSessionRowsTable.sessionId, hrImportSessionRowsTable.rowNumber],
        set: {
          rawRow: input.rawRow ?? null,
          normalizedRow: input.normalizedRow ?? null,
          validationResult: input.validationResult ?? null,
          action: input.action ?? null,
          status: input.status ?? "pending",
          errors: input.errors ?? null,
          warnings: input.warnings ?? null,
        },
      });
  }

  async mergeSessionSummary(workspaceId: number, sessionId: number, patch: Record<string, unknown>): Promise<void> {
    const session = await this.getSession(workspaceId, sessionId);
    if (!session) return;
    const merged = { ...((session.summary as Record<string, unknown>) ?? {}), ...patch };
    await this.updateSessionStatus(workspaceId, sessionId, session.status, merged);
  }

  async beginCommit(workspaceId: number, sessionId: number, revertToken: string): Promise<void> {
    await db
      .update(hrImportSessionsTable)
      .set({ status: "committing", dryRun: false, revertToken })
      .where(
        and(
          eq(hrImportSessionsTable.id, sessionId),
          eq(hrImportSessionsTable.workspaceId, workspaceId),
        ),
      );
  }

  async getSessionRows(sessionId: number, workspaceId: number) {
    return db
      .select()
      .from(hrImportSessionRowsTable)
      .where(
        and(
          eq(hrImportSessionRowsTable.sessionId, sessionId),
          eq(hrImportSessionRowsTable.workspaceId, workspaceId),
        ),
      )
      .orderBy(hrImportSessionRowsTable.rowNumber);
  }
}

export const importSessionService = new ImportSessionService();
