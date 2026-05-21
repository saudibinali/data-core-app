import nodemailer, { type Transporter } from "nodemailer";
import { db } from "@workspace/db";
import { workspaceSmtpConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptSecret } from "../secret-encryption";
import { platformMailer, type MailSendOptions } from "./platform-mailer";
import { logger } from "../logger";

export class WorkspaceMailer {
  async getWorkspaceConfig(workspaceId: number) {
    const [row] = await db
      .select()
      .from(workspaceSmtpConfigsTable)
      .where(eq(workspaceSmtpConfigsTable.workspaceId, workspaceId))
      .limit(1);
    return row ?? null;
  }

  private async createTransporter(workspaceId: number): Promise<{
    transporter: Transporter;
    from: string;
  } | null> {
    const config = await this.getWorkspaceConfig(workspaceId);
    if (!config || config.status !== "active") return null;

    const password = decryptSecret(config.encryptedPassword);
    const from = config.fromName
      ? `"${config.fromName}" <${config.fromEmail}>`
      : config.fromEmail;

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: password },
    });

    return { transporter, from };
  }

  /** Workspace SMTP first; platform env SMTP fallback. */
  async send(workspaceId: number, opts: MailSendOptions): Promise<{ messageId?: string; via: "workspace" | "platform" } | null> {
    try {
      const ws = await this.createTransporter(workspaceId);
      if (ws) {
        const info = await ws.transporter.sendMail({
          from: ws.from,
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
          text: opts.text,
          replyTo: undefined,
        });
        return { messageId: info.messageId, via: "workspace" };
      }
    } catch (err) {
      logger.warn({ err, workspaceId }, "[WorkspaceMailer] workspace SMTP failed — trying platform fallback");
    }

    const fallback = await platformMailer.send(opts);
    if (fallback) return { ...fallback, via: "platform" };
    return null;
  }

  async verifyWorkspaceConnection(workspaceId: number): Promise<void> {
    const ws = await this.createTransporter(workspaceId);
    if (!ws) throw new Error("No active workspace SMTP configuration");
    await ws.transporter.verify();
  }
}

export const workspaceMailer = new WorkspaceMailer();
