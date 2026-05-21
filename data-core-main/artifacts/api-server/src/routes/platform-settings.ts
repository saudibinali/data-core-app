import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireSuperAdmin } from "../middlewares/requireAuth";
import { parseBrandingUpload } from "../lib/parse-branding-upload";
import {
  getPublicPlatformBranding,
  saveBrandingAssetFile,
  upsertIdentityBrandingUrls,
} from "../lib/platform-branding";

const router: IRouter = Router();

const DEFAULTS: Record<string, Record<string, unknown>> = {
  identity: {
    platform_name:  "OpsPlatform",
    org_name:       "",
    logo_url:       "",
    favicon_url:    "",
    primary_color:  "#3b82f6",
    tagline:        "",
    support_email:  "",
    website_url:    "",
  },
  smtp: {
    enabled:    false,
    host:       "",
    port:       587,
    username:   "",
    password:   "",
    from_email: "",
    from_name:  "OpsPlatform",
    secure:     false,
    provider:   "smtp",
  },
  security: {
    session_duration_hours:       24,
    password_min_length:          8,
    password_require_uppercase:   false,
    password_require_special:     false,
    password_require_number:      true,
    max_login_attempts:           10,
    lockout_duration_minutes:     30,
    require_mfa:                  false,
    allowed_email_domains:        [],
    ip_whitelist_enabled:         false,
    ip_whitelist:                 [],
  },
  network: {
    app_url:          "",
    cors_origins:     [],
    trusted_proxies:  "loopback",
    websocket_enabled: true,
  },
  features: {
    maintenance_mode:        false,
    maintenance_message:     "System is under scheduled maintenance. Please check back shortly.",
    allow_public_registration: false,
    guest_access_enabled:    false,
  },
};

const SENSITIVE_KEYS = new Set(["password", "smtp_password"]);

function maskSensitive(category: string, value: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...value };
  for (const key of Object.keys(masked)) {
    if (SENSITIVE_KEYS.has(key) && masked[key]) {
      masked[key] = "••••••••";
    }
  }
  return masked;
}

async function getAllSettings(): Promise<Record<string, Record<string, unknown>>> {
  const rows = await db.select().from(platformSettingsTable);
  const result: Record<string, Record<string, unknown>> = {};

  for (const [cat, defaults] of Object.entries(DEFAULTS)) {
    const row = rows.find((r) => r.category === cat);
    const stored = (row?.value ?? {}) as Record<string, unknown>;
    result[cat] = maskSensitive(cat, { ...defaults, ...stored });
  }
  return result;
}

/** Public branding for sign-in page and browser tab (no auth). */
router.get("/platform/branding", async (_req, res): Promise<void> => {
  try {
    const branding = await getPublicPlatformBranding();
    res.json(branding);
  } catch (err) {
    res.status(500).json({ error: "Failed to load platform branding" });
  }
});

/** Upload logo or favicon file; updates identity settings. */
router.post(
  "/platform/settings/branding/upload",
  requireAuth,
  requireSuperAdmin,
  parseBrandingUpload,
  async (req: AuthRequest, res): Promise<void> => {
    const kind = String(req.query["kind"] ?? "");
    if (kind !== "logo" && kind !== "favicon") {
      res.status(400).json({ error: "Query kind must be logo or favicon" });
      return;
    }
    const upload = req.brandingUpload;
    if (!upload) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    try {
      const { publicPath } = await saveBrandingAssetFile(
        kind,
        upload.buffer,
        upload.originalFileName,
      );
      const cacheBust = `${publicPath}?v=${Date.now()}`;
      const patch =
        kind === "logo"
          ? { logo_url: cacheBust }
          : { favicon_url: cacheBust };
      const branding = await upsertIdentityBrandingUrls(patch, req.userId ?? null);
      const all = await getAllSettings();
      res.json({ branding, settings: all, uploadedUrl: cacheBust });
    } catch (err) {
      req.log?.error({ err }, "Branding upload failed");
      res.status(500).json({ error: "Failed to save branding file" });
    }
  },
);

router.get("/platform/settings", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const all = await getAllSettings();
  res.json(all);
});

router.patch("/platform/settings/:category", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const category = String(req.params["category"] ?? "");

  if (!DEFAULTS[category]) {
    res.status(400).json({ error: `Unknown settings category: ${category}` });
    return;
  }

  const incoming = req.body as Record<string, unknown>;

  const existing = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.category, category));
  const currentValue = ((existing[0]?.value ?? {}) as Record<string, unknown>);

  const updated: Record<string, unknown> = { ...currentValue };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === "••••••••" && SENSITIVE_KEYS.has(k)) continue;
    updated[k] = v;
  }

  await db
    .insert(platformSettingsTable)
    .values({ category, value: updated, updatedBy: req.userId ?? null })
    .onConflictDoUpdate({
      target: platformSettingsTable.category,
      set: { value: updated, updatedBy: req.userId ?? null, updatedAt: new Date() },
    });

  const all = await getAllSettings();
  res.json(all);
});

export default router;
