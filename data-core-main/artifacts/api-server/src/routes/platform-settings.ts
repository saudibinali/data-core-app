import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { platformSettingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireSuperAdmin } from "../middlewares/requireAuth";
import { platformMailer } from "../lib/mail/platform-mailer";
import { parseBrandingUpload } from "../lib/parse-branding-upload";
import {
  getPublicPlatformBranding,
  saveBrandingAssetFile,
  upsertIdentityBrandingUrls,
} from "../lib/platform-branding";
import { processBrandingImage } from "../lib/branding-image-process";

const router: IRouter = Router();

const DEFAULTS: Record<string, Record<string, unknown>> = {
  identity: {
    platform_name:  "Data Core Center",
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
    from_name:  "Data Core Center",
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
      const processed = await processBrandingImage(
        upload.buffer,
        upload.originalFileName,
        kind,
      );
      const { publicPath } = await saveBrandingAssetFile(
        kind,
        processed.buffer,
        `asset${processed.ext}`,
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Verify platform SMTP from server env (SMTP_HOST, SMTP_USER, SMTP_PASS, …).
 * Used by contact form and platform mailer. Optional body.sendTest sends a message to `to`
 * or the signed-in super admin email.
 */
router.post("/platform/smtp/test", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  if (!platformMailer.isConfigured()) {
    res.status(503).json({
      success: false,
      error: "SMTP_NOT_CONFIGURED",
      message:
        "Platform SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in the server environment (.env), then restart the API.",
    });
    return;
  }

  const body = (req.body ?? {}) as { to?: unknown; sendTest?: unknown };
  const sendTest = body.sendTest === true || body.sendTest === "true";
  let to: string | undefined =
    typeof body.to === "string" && body.to.trim() ? body.to.trim().toLowerCase() : undefined;

  if (to && (!EMAIL_RE.test(to) || to.length > 254)) {
    res.status(400).json({ success: false, error: "INVALID_EMAIL", message: "Invalid test recipient email." });
    return;
  }

  try {
    await platformMailer.verifyConnection();

    if (!sendTest && !to) {
      res.json({
        success: true,
        message: "SMTP connection verified (server environment).",
        configured: true,
      });
      return;
    }

    if (!to && req.userId) {
      const [user] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, req.userId))
        .limit(1);
      to = user?.email?.trim().toLowerCase() || undefined;
    }

    if (!to) {
      res.status(400).json({
        success: false,
        error: "NO_RECIPIENT",
        message: "Provide body.to or sign in with an account that has an email address.",
      });
      return;
    }

    const platformName =
      ((await getAllSettings()).identity?.platform_name as string | undefined) ?? "Data Core Center";
    const result = await platformMailer.send({
      to,
      subject: `[${platformName}] SMTP test`,
      html: `<p>This is a test message from <strong>${platformName}</strong> platform SMTP (server environment).</p><p>If you received this, outbound mail is working.</p>`,
      text: `SMTP test from ${platformName}. If you received this, outbound mail is working.`,
    });

    if (!result) {
      res.status(503).json({ success: false, error: "SMTP_SEND_FAILED", message: "Test email was not sent." });
      return;
    }

    res.json({
      success: true,
      message: "SMTP connection verified and test email sent.",
      configured: true,
      sentTo: to,
      messageId: result.messageId ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SMTP test failed";
    req.log?.warn({ err }, "Platform SMTP test failed");
    res.status(422).json({ success: false, error: "SMTP_TEST_FAILED", message });
  }
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
