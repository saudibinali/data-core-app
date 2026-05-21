/**
 * @phase P19-B — Notification infrastructure smoke tests
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
  notificationsTable,
  workspaceSmtpConfigsTable,
  notificationJobsTable,
  notificationDeliveriesTable,
} from "@workspace/db";
import { encryptSecret } from "../../lib/secret-encryption";
import { dispatchUserNotification } from "../../lib/notifications/dispatch";
import {
  processNotificationJobBatch,
  resetStuckProcessingJobs,
} from "../../lib/notifications/queue-processor";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = HAS_DB && process.env.RUN_P19B_SMOKE !== "0";

const MIGRATION_0002 = path.resolve(
  fileURLToPath(new URL("../../../../../lib/db/drizzle/0002_notification_infrastructure.sql", import.meta.url)),
);

async function ensureP19BMigration(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'notification_jobs' LIMIT 1`,
  );
  if (rows.length > 0) return;

  const raw = fs.readFileSync(MIGRATION_0002, "utf8");
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

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/mail/workspace-mailer", () => ({
  workspaceMailer: {
    send: vi.fn().mockResolvedValue({ messageId: "test-msg-id", via: "platform" }),
    verifyWorkspaceConnection: vi.fn().mockResolvedValue(undefined),
    getWorkspaceConfig: vi.fn(),
  },
}));

type Ctx = { userId: number; workspaceId: number; userRole: string };

let wsA: number;
let wsB: number;
let adminA: Ctx;
let adminB: Ctx;
let memberA: Ctx;

async function insertUser(wsId: number, role: string, name: string) {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO users (workspace_id, email, full_name, role, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [wsId, `${name}-${Date.now()}@p19b.test`, name, role],
  );
  return r.rows[0]!.id;
}

function mountSmtpRouter(ctx: Ctx) {
  vi.resetModules();
  vi.doMock("../../middlewares/requireAuth", () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const r = req as unknown as Ctx;
      r.userId = ctx.userId;
      r.workspaceId = ctx.workspaceId;
      r.userRole = ctx.userRole;
      next();
    },
    requireWorkspaceAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  }));
  return import("../workspace-smtp").then(({ default: router }) => {
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(router as any);
    return app;
  });
}

function mountStorageRouter(ctx?: Ctx) {
  vi.resetModules();
  if (ctx) {
    vi.doMock("../../middlewares/requireAuth", () => ({
      requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        const r = req as unknown as Ctx;
        r.userId = ctx.userId;
        r.workspaceId = ctx.workspaceId;
        next();
      },
      requireWorkspaceAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
        next(),
      requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
        next(),
    }));
  }
  return import("../storage").then(({ default: router }) => {
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(router as any);
    return app;
  });
}

function mountNotificationsRouter(ctx: Ctx) {
  vi.resetModules();
  vi.doMock("../../middlewares/requireAuth", () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const r = req as unknown as Ctx & { userPermissions?: string[] };
      r.userId = ctx.userId;
      r.workspaceId = ctx.workspaceId;
      r.userRole = ctx.userRole;
      r.userPermissions = ["notifications.view"];
      next();
    },
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
    requireWorkspaceAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  }));
  return import("../notifications").then(({ default: router }) => {
    const app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use(router as any);
    return app;
  });
}

describe.skipIf(!RUN)("P19-B notification infrastructure smoke", () => {
  beforeAll(async () => {
    initializeDatabase(process.env.DATABASE_URL!);
    await ensureP19BMigration();
    const [a] = await db.insert(workspacesTable).values({ name: "P19B A", slug: `p19b-a-${Date.now()}` }).returning();
    const [b] = await db.insert(workspacesTable).values({ name: "P19B B", slug: `p19b-b-${Date.now()}` }).returning();
    wsA = a!.id;
    wsB = b!.id;
    const userA = await insertUser(wsA, "admin", "AdminA");
    const userB = await insertUser(wsB, "admin", "AdminB");
    const member = await insertUser(wsA, "member", "MemberA");
    adminA = { userId: userA, workspaceId: wsA, userRole: "admin" };
    adminB = { userId: userB, workspaceId: wsB, userRole: "admin" };
    memberA = { userId: member, workspaceId: wsA, userRole: "member" };
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("workspace SMTP isolation — config scoped per workspace", async () => {
    await db.insert(workspaceSmtpConfigsTable).values({
      workspaceId: wsA,
      host: "smtp.a.test",
      port: 587,
      username: "a@test",
      encryptedPassword: encryptSecret("secret-a"),
      fromEmail: "noreply@a.test",
    });

    const appA = await mountSmtpRouter(adminA);
    const resA = await request(appA).get("/hr/workspace/smtp-config");
    expect(resA.status).toBe(200);
    expect(resA.body.host).toBe("smtp.a.test");
    expect(resA.body.encryptedPassword).toBeUndefined();
    expect(resA.body.password).toBeUndefined();

    const appB = await mountSmtpRouter(adminB);
    const resB = await request(appB).get("/hr/workspace/smtp-config");
    expect(resB.status).toBe(200);
    expect(resB.body).toBeNull();
  });

  it("notification enqueue — dispatch creates job + deliveries", async () => {
    const busId = `p19b-${Date.now()}`;
    await dispatchUserNotification({
      workspaceId: wsA,
      userId: memberA.userId,
      type: "leave_request",
      title: "Test",
      message: "Enqueue test",
      busEventId: busId,
      emailTemplateKey: "leave.requested",
      templateVars: { leaveType: "annual", message: "Enqueue test" },
    });

    const [job] = await db
      .select()
      .from(notificationJobsTable)
      .where(
        and(
          eq(notificationJobsTable.workspaceId, wsA),
          eq(notificationJobsTable.idempotencyKey, `${busId}:email:${memberA.userId}`),
        ),
      )
      .limit(1);
    expect(job).toBeDefined();
    expect(job!.status).toBe("pending");

    const deliveries = await db
      .select()
      .from(notificationDeliveriesTable)
      .where(eq(notificationDeliveriesTable.workspaceId, wsA));
    expect(deliveries.some((d: { channel: string; status: string }) => d.channel === "in_app" && d.status === "sent")).toBe(true);
    expect(deliveries.some((d: { channel: string; status: string }) => d.channel === "email" && d.status === "pending")).toBe(true);
  });

  it("retry behavior — failed job re-queued then sent", async () => {
    const { workspaceMailer } = await import("../../lib/mail/workspace-mailer");
    const sendMock = workspaceMailer.send as ReturnType<typeof vi.fn>;

    const [job] = await db
      .insert(notificationJobsTable)
      .values({
        workspaceId: wsA,
        idempotencyKey: `retry-${Date.now()}`,
        eventType: "test",
        channel: "email",
        status: "pending",
        recipientUserId: memberA.userId,
        recipientEmail: `member-${memberA.userId}@p19b.test`,
        templateKey: "leave.approved",
        payloadJson: JSON.stringify({ message: "retry", leaveType: "annual" }),
        maxAttempts: 3,
      })
      .returning();

    sendMock.mockReset();
    sendMock.mockRejectedValue(new Error("transient smtp"));
    await processNotificationJobBatch();
    const [afterFail] = await db
      .select()
      .from(notificationJobsTable)
      .where(eq(notificationJobsTable.id, job!.id))
      .limit(1);
    expect(["failed", "pending"]).toContain(afterFail!.status);

    await db
      .update(notificationJobsTable)
      .set({ status: "pending", scheduledAt: new Date(), attempts: 1 })
      .where(eq(notificationJobsTable.id, job!.id));

    sendMock.mockReset();
    sendMock.mockResolvedValue({ messageId: "ok", via: "platform" });
    await resetStuckProcessingJobs();
    await processNotificationJobBatch();
    const [afterOk] = await db
      .select()
      .from(notificationJobsTable)
      .where(eq(notificationJobsTable.id, job!.id))
      .limit(1);
    expect(afterOk!.status).toBe("sent");
  });

  it("no cross-workspace notifications in list API", async () => {
    await db.insert(notificationsTable).values({
      userId: memberA.userId,
      workspaceId: wsB,
      type: "test_cross",
      title: "Cross",
      message: "Should not appear",
    });
    await db.insert(notificationsTable).values({
      userId: memberA.userId,
      workspaceId: wsA,
      type: "test_local",
      title: "Local",
      message: "Should appear",
    });

    const app = await mountNotificationsRouter(memberA);
    const res = await request(app).get("/notifications");
    expect(res.status).toBe(200);
    const types = (res.body as Array<{ type: string }>).map((n) => n.type);
    expect(types).toContain("test_local");
    expect(types).not.toContain("test_cross");
  });

  it("ACL enforcement — cross-workspace object path forbidden", async () => {
    vi.resetModules();
    const { ObjectStorageService } = await import("../../lib/objectStorage");
    const svc = new ObjectStorageService();
    expect(svc.isObjectInWorkspace("/objects/uploads/ws-999/fake", wsA)).toBe(false);
    expect(svc.isObjectInWorkspace(`/objects/uploads/ws-${wsA}/abc`, wsA)).toBe(true);
  });

  it("upload auth protection — presign requires auth", async () => {
    vi.resetModules();
    vi.doMock("../../middlewares/requireAuth", () => ({
      requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (!req.headers.authorization?.startsWith("Bearer ")) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
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
        getObjectEntityUploadURL = async () =>
          "https://storage.googleapis.com/bucket/private/uploads/ws-1/obj";
        normalizeObjectEntityPath = () => "/objects/uploads/ws-1/obj";
        isObjectInWorkspace = () => true;
      },
    }));
    const app = await mountStorageRouter();
    const res = await request(app)
      .post("/storage/uploads/request-url")
      .send({ fileName: "f.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(401);
  });
});
