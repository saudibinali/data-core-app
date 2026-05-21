/**
 * @phase P19-C — Document registry smoke tests
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, and } from "drizzle-orm";
import {
  db,
  pool,
  initializeDatabase,
  workspacesTable,
  documentsTable,
  documentAccessLogsTable,
  generatedReportsTable,
} from "@workspace/db";
import { documentService } from "../../lib/documents/document-service";
import { validateMimeType } from "../../lib/documents/mime-policy";
import { issueDocumentDownloadToken, verifyDocumentDownloadToken } from "../../lib/documents/download-token";
import { ObjectStorageService } from "../../lib/objectStorage";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = HAS_DB && process.env.RUN_P19C_SMOKE !== "0";

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const MIGRATION_0003 = path.resolve(
  fileURLToPath(new URL("../../../../../lib/db/drizzle/0003_document_registry.sql", import.meta.url)),
);

async function ensureP19CMigration(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'documents' LIMIT 1`,
  );
  if (rows.length > 0) return;
  const raw = fs.readFileSync(MIGRATION_0003, "utf8");
  const statements = raw
    .split("--> statement-breakpoint")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await pool.query(stmt);
  }
}

type Ctx = { userId: number; workspaceId: number; userRole: string; perms: string[] };

let wsA: number;
let wsB: number;
let adminA: Ctx;
let memberA: Ctx;

async function insertUser(wsId: number, role: string, name: string) {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO users (workspace_id, email, full_name, role, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [wsId, `${name}-${Date.now()}@p19c.test`, name, role],
  );
  return r.rows[0]!.id;
}

function mountAttachmentsRouter(ctx: Ctx) {
  vi.resetModules();
  vi.doMock("../../middlewares/requireAuth", () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const r = req as unknown as Ctx & { userPermissions?: string[] };
      r.userId = ctx.userId;
      r.workspaceId = ctx.workspaceId;
      r.userRole = ctx.userRole;
      r.userPermissions = ctx.perms;
      next();
    },
    requireWorkspaceAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  }));
  vi.doMock("../../lib/objectStorage", () => ({
    ObjectNotFoundError: class ObjectNotFoundError extends Error {},
    ObjectStorageService: class {
      buildRegistryRelativePath(...parts: unknown[]) {
        return `uploads/ws-${parts[0]}/docs/hr/employee/1/1/v1`;
      }
      toObjectPath(key: string) {
        return `/objects/${key}`;
      }
      async getRegistryUploadURL() {
        return "https://storage.googleapis.com/mock/upload";
      }
      async getSignedDownloadURL() {
        return "https://storage.googleapis.com/mock/download";
      }
      isObjectInWorkspace(objectPath: string, workspaceId: number) {
        return objectPath.includes(`ws-${workspaceId}`);
      }
      async getObjectEntityFile() {
        return {};
      }
      async downloadObject() {
        return new Response(new ReadableStream(), { status: 200 });
      }
    },
  }));
  return import("../attachments").then(({ default: router }) => {
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(router as any);
    return app;
  });
}

describe.skipIf(!RUN)("P19-C document registry smoke", () => {
  beforeAll(async () => {
    initializeDatabase(process.env.DATABASE_URL!);
    await ensureP19CMigration();
    const [a] = await db.insert(workspacesTable).values({ name: "P19C A", slug: `p19c-a-${Date.now()}` }).returning();
    const [b] = await db.insert(workspacesTable).values({ name: "P19C B", slug: `p19c-b-${Date.now()}` }).returning();
    wsA = a!.id;
    wsB = b!.id;
    adminA = { userId: await insertUser(wsA, "admin", "AdminA"), workspaceId: wsA, userRole: "admin", perms: ["hr.manage", "hr.view"] };
    memberA = { userId: await insertUser(wsA, "member", "MemberA"), workspaceId: wsA, userRole: "member", perms: [] };
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("MIME allowlist rejects executables", () => {
    expect(validateMimeType("application/x-msdownload").ok).toBe(false);
    expect(validateMimeType("application/pdf").ok).toBe(true);
  });

  it("workspace isolation — documents scoped per workspace", async () => {
    const objectPath = `/objects/uploads/ws-${wsA}/docs/hr/employee/1/1/v1`;
    const docA = await documentService.registerExistingFile({
      workspaceId: wsA,
      userId: adminA.userId,
      fileName: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      objectPath,
      entity: { sourceType: "test", sourceEntityType: "employee", sourceEntityId: "1", domain: "hr" },
    });

    const rowsB = await db
      .select()
      .from(documentsTable)
      .where(and(eq(documentsTable.workspaceId, wsB), eq(documentsTable.id, docA.id)));
    expect(rowsB).toHaveLength(0);
  });

  it("attachment upload-request creates registry row", async () => {
    const app = await mountAttachmentsRouter(adminA);
    const res = await request(app)
      .post("/attachments/upload-request")
      .send({
        fileName: "test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        entityType: "employee",
        entityId: "42",
        sourceType: "hr_employee_document",
      });
    expect(res.status).toBe(201);
    expect(res.body.documentId).toBeGreaterThan(0);
    expect(res.body.uploadUrl).toBeDefined();
  });

  it("signed download token binds user and workspace", () => {
    const token = issueDocumentDownloadToken({
      documentId: 1,
      versionId: 1,
      workspaceId: wsA,
      userId: adminA.userId,
    });
    const payload = verifyDocumentDownloadToken(token);
    expect(payload?.workspaceId).toBe(wsA);
    expect(payload?.userId).toBe(adminA.userId);
  });

  it("confidential document blocks member download", async () => {
    const objectPath = `/objects/uploads/ws-${wsA}/docs/hr/employee/9/9/v1`;
    const [doc] = await db
      .insert(documentsTable)
      .values({
        workspaceId: wsA,
        title: "Confidential",
        fileName: "secret.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        storageKey: objectPath,
        status: "active",
        classification: "confidential",
        isConfidential: true,
        sourceType: "hr",
        sourceEntityType: "employee",
        sourceEntityId: "9",
        createdByUserId: adminA.userId,
      })
      .returning();

    await expect(
      documentService.issueSignedDownload(doc!.id, wsA, {
        userId: memberA.userId,
        workspaceId: wsA,
        userRole: memberA.userRole,
        userPermissions: memberA.perms,
      } as express.Request),
    ).rejects.toThrow(/Forbidden/);
  });

  it("access logs written on register", async () => {
    const objectPath = `/objects/uploads/ws-${wsA}/legacy/uuid`;
    const doc = await documentService.registerExistingFile({
      workspaceId: wsA,
      userId: adminA.userId,
      fileName: "logged.pdf",
      mimeType: "application/pdf",
      sizeBytes: 50,
      objectPath,
      entity: { sourceType: "test", sourceEntityType: "employee", sourceEntityId: "2", domain: "hr" },
    });
    const logs = await db
      .select()
      .from(documentAccessLogsTable)
      .where(eq(documentAccessLogsTable.documentId, doc.id));
    expect(logs.some((l) => l.action === "upload")).toBe(true);
  });

  it("no public access — storage path check", () => {
    const svc = new ObjectStorageService();
    expect(svc.isObjectInWorkspace(`/objects/uploads/ws-${wsB}/x`, wsA)).toBe(false);
  });

  it("generated_reports lifecycle", async () => {
    const app = await mountAttachmentsRouter(adminA);
    const create = await request(app)
      .post("/generated-reports")
      .send({ reportDefinitionKey: "attendance.summary", format: "xlsx" });
    expect(create.status).toBe(201);
    const id = create.body.id as number;

    const patch = await request(app)
      .patch(`/generated-reports/${id}`)
      .send({ status: "completed", storageKey: `/objects/uploads/ws-${wsA}/reports/r1` });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("completed");

    const [row] = await db
      .select()
      .from(generatedReportsTable)
      .where(eq(generatedReportsTable.id, id))
      .limit(1);
    expect(row!.status).toBe("completed");
  });
});
