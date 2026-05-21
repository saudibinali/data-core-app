import { db } from "@workspace/db";
import { workspaceReportBrandingTable, workspacesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type WorkspaceBranding = {
  workspaceId: number;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  footerText: string | null;
  locale: "en" | "ar";
  watermarkText: string | null;
};

export async function getWorkspaceBranding(workspaceId: number): Promise<WorkspaceBranding> {
  const [ws] = await db
    .select({
      name: workspacesTable.name,
      logoUrl: workspacesTable.logoUrl,
      primaryColor: workspacesTable.primaryColor,
    })
    .from(workspacesTable)
    .where(eq(workspacesTable.id, workspaceId))
    .limit(1);

  const [override] = await db
    .select()
    .from(workspaceReportBrandingTable)
    .where(eq(workspaceReportBrandingTable.workspaceId, workspaceId))
    .limit(1);

  const localeRaw = override?.locale ?? "en";
  const locale: "en" | "ar" = localeRaw === "ar" ? "ar" : "en";

  return {
    workspaceId,
    displayName: override?.displayName ?? ws?.name ?? `Workspace ${workspaceId}`,
    logoUrl: override?.logoUrl ?? ws?.logoUrl ?? null,
    primaryColor: override?.primaryColor ?? ws?.primaryColor ?? "#1e40af",
    footerText: override?.footerText ?? null,
    locale,
    watermarkText: override?.watermarkText ?? null,
  };
}

export async function upsertWorkspaceBranding(
  workspaceId: number,
  patch: Partial<Omit<WorkspaceBranding, "workspaceId">>,
): Promise<void> {
  await db
    .insert(workspaceReportBrandingTable)
    .values({
      workspaceId,
      displayName: patch.displayName ?? null,
      logoUrl: patch.logoUrl ?? null,
      primaryColor: patch.primaryColor ?? "#1e40af",
      footerText: patch.footerText ?? null,
      locale: patch.locale ?? "en",
      watermarkText: patch.watermarkText ?? null,
    })
    .onConflictDoUpdate({
      target: workspaceReportBrandingTable.workspaceId,
      set: {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.logoUrl !== undefined ? { logoUrl: patch.logoUrl } : {}),
        ...(patch.primaryColor !== undefined ? { primaryColor: patch.primaryColor } : {}),
        ...(patch.footerText !== undefined ? { footerText: patch.footerText } : {}),
        ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
        ...(patch.watermarkText !== undefined ? { watermarkText: patch.watermarkText } : {}),
        updatedAt: new Date(),
      },
    });
}
