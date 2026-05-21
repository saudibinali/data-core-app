import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { workspaceSmtpConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireWorkspaceAdmin,
} from "../middlewares/requireAuth";
import { encryptSecret } from "../lib/secret-encryption";
import { workspaceMailer } from "../lib/mail/workspace-mailer";
import { logCommunicationAudit } from "../lib/communication-audit";

const router: IRouter = Router();

function sanitizeConfig(row: typeof workspaceSmtpConfigsTable.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    replyToEmail: row.replyToEmail,
    isVerified: row.isVerified,
    lastTestAt: row.lastTestAt,
    lastTestStatus: row.lastTestStatus,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.get(
  "/hr/workspace/smtp-config",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const { workspaceId } = req;
    if (!workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }
    const [row] = await db
      .select()
      .from(workspaceSmtpConfigsTable)
      .where(eq(workspaceSmtpConfigsTable.workspaceId, workspaceId))
      .limit(1);
    res.json(row ? sanitizeConfig(row) : null);
  },
);

router.put(
  "/hr/workspace/smtp-config",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const { workspaceId, userId } = req;
    if (!workspaceId || !userId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const host = String(body.host ?? "").trim();
    const port = Number(body.port ?? 587);
    const username = String(body.username ?? "").trim();
    const password = typeof body.password === "string" ? body.password : "";
    const fromEmail = String(body.fromEmail ?? "").trim();
    const fromName = body.fromName != null ? String(body.fromName) : null;
    const replyToEmail = body.replyToEmail != null ? String(body.replyToEmail) : null;
    const secure = Boolean(body.secure);

    if (!host || !username || !fromEmail) {
      res.status(400).json({ error: "host, username, and fromEmail are required" });
      return;
    }

    const [existing] = await db
      .select()
      .from(workspaceSmtpConfigsTable)
      .where(eq(workspaceSmtpConfigsTable.workspaceId, workspaceId))
      .limit(1);

    const encryptedPassword =
      password.length > 0
        ? encryptSecret(password)
        : existing?.encryptedPassword;

    if (!encryptedPassword) {
      res.status(400).json({ error: "password is required for new configuration" });
      return;
    }

    let row: typeof workspaceSmtpConfigsTable.$inferSelect;
    if (existing) {
      const [updated] = await db
        .update(workspaceSmtpConfigsTable)
        .set({
          host,
          port,
          secure,
          username,
          encryptedPassword,
          fromEmail,
          fromName,
          replyToEmail,
          updatedByUserId: userId,
          isVerified: false,
        })
        .where(eq(workspaceSmtpConfigsTable.id, existing.id))
        .returning();
      row = updated!;
    } else {
      const [inserted] = await db
        .insert(workspaceSmtpConfigsTable)
        .values({
          workspaceId,
          host,
          port,
          secure,
          username,
          encryptedPassword,
          fromEmail,
          fromName,
          replyToEmail,
          createdByUserId: userId,
          updatedByUserId: userId,
        })
        .returning();
      row = inserted!;
    }

    await logCommunicationAudit({
      workspaceId,
      action: "smtp_config.upsert",
      actorUserId: userId,
      targetType: "workspace_smtp_config",
      targetId: String(row.id),
    });

    res.json(sanitizeConfig(row));
  },
);

router.post(
  "/hr/workspace/smtp-config/test",
  requireAuth,
  requireWorkspaceAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const { workspaceId, userId } = req;
    if (!workspaceId) {
      res.status(403).json({ error: "No workspace" });
      return;
    }

    try {
      await workspaceMailer.verifyWorkspaceConnection(workspaceId);
      await db
        .update(workspaceSmtpConfigsTable)
        .set({
          isVerified: true,
          lastTestAt: new Date(),
          lastTestStatus: "ok",
        })
        .where(eq(workspaceSmtpConfigsTable.workspaceId, workspaceId));

      await logCommunicationAudit({
        workspaceId,
        action: "smtp_config.test_ok",
        actorUserId: userId,
        targetType: "workspace_smtp_config",
      });

      res.json({ success: true, message: "SMTP connection verified" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "SMTP test failed";
      await db
        .update(workspaceSmtpConfigsTable)
        .set({
          isVerified: false,
          lastTestAt: new Date(),
          lastTestStatus: message,
        })
        .where(eq(workspaceSmtpConfigsTable.workspaceId, workspaceId));

      await logCommunicationAudit({
        workspaceId,
        action: "smtp_config.test_failed",
        actorUserId: userId,
        metadata: { error: message },
      });

      res.status(422).json({ success: false, error: message });
    }
  },
);

export default router;
