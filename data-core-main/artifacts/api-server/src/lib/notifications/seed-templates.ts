import { db } from "@workspace/db";
import { notificationTemplatesTable } from "@workspace/db";
import { isNull, and, eq } from "drizzle-orm";
import { PLATFORM_EMAIL_TEMPLATES } from "./templates";
import { logger } from "../logger";

export async function seedNotificationTemplates(): Promise<void> {
  for (const t of PLATFORM_EMAIL_TEMPLATES) {
    const [existing] = await db
      .select({ id: notificationTemplatesTable.id })
      .from(notificationTemplatesTable)
      .where(
        and(
          isNull(notificationTemplatesTable.workspaceId),
          eq(notificationTemplatesTable.templateKey, t.templateKey),
          eq(notificationTemplatesTable.channel, "email"),
          eq(notificationTemplatesTable.locale, "en"),
        ),
      )
      .limit(1);

    if (existing) continue;

    await db.insert(notificationTemplatesTable).values({
      workspaceId: null,
      templateKey: t.templateKey,
      channel: "email",
      locale: "en",
      subject: t.subject,
      bodyHtml: t.bodyHtml,
      bodyText: t.bodyText,
      isActive: true,
    });
  }
  logger.info("[seed] notification templates (platform defaults) ensured");
}
