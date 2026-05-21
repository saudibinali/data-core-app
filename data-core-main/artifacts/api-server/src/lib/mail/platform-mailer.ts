import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "../logger";

export type MailSendOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

function isPlatformSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS,
  );
}

function createPlatformTransporter(): Transporter | null {
  if (!isPlatformSmtpConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  });
}

export class PlatformMailer {
  async send(opts: MailSendOptions): Promise<{ messageId?: string } | null> {
    const transporter = createPlatformTransporter();
    if (!transporter) {
      logger.debug({ to: opts.to }, "[PlatformMailer] SMTP not configured — skip");
      return null;
    }
    const from = process.env.SMTP_FROM ?? "noreply@ops-platform.local";
    const info = await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    return { messageId: info.messageId };
  }

  async verifyConnection(): Promise<boolean> {
    const transporter = createPlatformTransporter();
    if (!transporter) return false;
    await transporter.verify();
    return true;
  }

  isConfigured(): boolean {
    return isPlatformSmtpConfigured();
  }
}

export const platformMailer = new PlatformMailer();
