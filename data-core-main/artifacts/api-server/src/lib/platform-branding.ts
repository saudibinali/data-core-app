/**
 * Platform identity branding (logo, favicon) — read + file storage.
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "@workspace/db";
import { platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const IDENTITY_DEFAULTS = {
  platform_name: "OpsPlatform",
  org_name: "",
  logo_url: "",
  favicon_url: "",
  primary_color: "#3b82f6",
  tagline: "",
  support_email: "",
  website_url: "",
};

export type PlatformBranding = {
  platformName: string;
  orgName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  tagline: string;
  supportEmail: string;
  websiteUrl: string;
};

function brandingPublicDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "artifacts/ops-platform/public/branding"),
    path.resolve(process.cwd(), "../ops-platform/public/branding"),
    path.resolve(process.cwd(), "public/branding"),
  ];
  for (const dir of candidates) {
    const parent = path.dirname(dir);
    if (fs.existsSync(parent)) {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
  }
  const fallback = candidates[0];
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

export function brandingAssetPath(kind: "logo" | "favicon", ext: string): string {
  const safeExt = ext.replace(/^\./, "").toLowerCase() || (kind === "favicon" ? "ico" : "png");
  return `/branding/${kind}.${safeExt}`;
}

export async function readIdentitySettings(): Promise<Record<string, unknown>> {
  const [row] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.category, "identity"))
    .limit(1);
  const stored = (row?.value ?? {}) as Record<string, unknown>;
  return { ...IDENTITY_DEFAULTS, ...stored };
}

export function toPublicBranding(value: Record<string, unknown>): PlatformBranding {
  return {
    platformName: String(value.platform_name ?? IDENTITY_DEFAULTS.platform_name),
    orgName: String(value.org_name ?? ""),
    logoUrl: String(value.logo_url ?? ""),
    faviconUrl: String(value.favicon_url ?? ""),
    primaryColor: String(value.primary_color ?? IDENTITY_DEFAULTS.primary_color),
    tagline: String(value.tagline ?? ""),
    supportEmail: String(value.support_email ?? ""),
    websiteUrl: String(value.website_url ?? ""),
  };
}

export async function getPublicPlatformBranding(): Promise<PlatformBranding> {
  const identity = await readIdentitySettings();
  return toPublicBranding(identity);
}

export async function saveBrandingAssetFile(
  kind: "logo" | "favicon",
  buffer: Buffer,
  originalFileName: string,
): Promise<{ publicPath: string; absolutePath: string }> {
  const ext = path.extname(originalFileName).toLowerCase() || (kind === "favicon" ? ".ico" : ".png");
  const dir = brandingPublicDir();
  const fileName = `${kind}${ext}`;
  const absolutePath = path.join(dir, fileName);
  fs.writeFileSync(absolutePath, buffer);
  return { publicPath: brandingAssetPath(kind, ext), absolutePath };
}

export async function upsertIdentityBrandingUrls(
  urls: Partial<{ logo_url: string; favicon_url: string }>,
  updatedBy: number | null,
): Promise<PlatformBranding> {
  const current = await readIdentitySettings();
  const merged = { ...current, ...urls };
  await db
    .insert(platformSettingsTable)
    .values({ category: "identity", value: merged, updatedBy })
    .onConflictDoUpdate({
      target: platformSettingsTable.category,
      set: { value: merged, updatedBy, updatedAt: new Date() },
    });
  return toPublicBranding(merged);
}
