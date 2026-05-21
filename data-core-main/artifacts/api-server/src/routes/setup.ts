import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db, isDatabaseConfigured, initializeDatabase, testDatabaseConnection } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { signToken } from "./auth";
import { loadPlatformConfig, savePlatformConfig } from "../lib/platform-config";
import { runInitSequence } from "../lib/init-sequence";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getSuperAdminCount(): Promise<number> {
  const [result] = await db
    .select({ n: count() })
    .from(usersTable)
    .where(eq(usersTable.role, "super_admin"));
  return Number(result?.n ?? 0);
}

interface DbParams {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: "disable" | "require" | "verify-full";
}

type ParseResult =
  | { ok: true;  params: DbParams }
  | { ok: false; error: string };

function buildConnectionString(p: DbParams): string {
  const sslParam =
    p.ssl === "disable"     ? "sslmode=disable" :
    p.ssl === "require"     ? "sslmode=require"  :
                              "sslmode=verify-full";
  const encodedPassword = encodeURIComponent(p.password);
  const encodedUser     = encodeURIComponent(p.user);
  return `postgresql://${encodedUser}:${encodedPassword}@${p.host}:${p.port}/${p.database}?${sslParam}`;
}

function parseDbParams(body: unknown): ParseResult {
  const b        = body as Record<string, unknown>;
  const host     = String(b["host"]     ?? "").trim();
  const port     = Number(b["port"]     ?? 5432);
  const database = String(b["database"] ?? "").trim();
  const user     = String(b["user"]     ?? "").trim();
  const password = String(b["password"] ?? "");
  const ssl      = (b["ssl"] ?? "disable") as DbParams["ssl"];

  if (!host)     return { ok: false, error: "Host is required" };
  if (!database) return { ok: false, error: "Database name is required" };
  if (!user)     return { ok: false, error: "Username is required" };
  if (isNaN(port) || port < 1 || port > 65535)
    return { ok: false, error: "Port must be between 1 and 65535" };
  if (!["disable", "require", "verify-full"].includes(ssl))
    return { ok: false, error: "Invalid SSL mode" };

  return { ok: true, params: { host, port, database, user, password, ssl } };
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /setup/status - public, no auth required.
 * Returns the current initialization state so the frontend can decide
 * which step of the wizard to show.
 */
router.get("/setup/status", async (_req: Request, res: Response): Promise<void> => {
  if (!isDatabaseConfigured()) {
    res.json({ initialized: false, databaseReady: false });
    return;
  }
  try {
    const n = await getSuperAdminCount();
    res.json({ initialized: n > 0, databaseReady: true });
  } catch {
    res.json({ initialized: false, databaseReady: true });
  }
});

/**
 * POST /setup/test-connection - public.
 * Validates DB connection parameters without persisting anything.
 */
router.post("/setup/test-connection", async (req: Request, res: Response): Promise<void> => {
  const parsed = parseDbParams(req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }

  const url = buildConnectionString(parsed.params);
  try {
    await testDatabaseConnection(url);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "Database connection test failed");
    res.status(400).json({ ok: false, error: `Connection failed: ${msg}` });
  }
});

/**
 * POST /setup/database - public, one-time only.
 * Validates, saves, and activates the database configuration.
 * After this completes the server is fully connected and migrations have run.
 * Returns 409 if the database is already configured and a super_admin exists.
 */
router.post("/setup/database", async (req: Request, res: Response): Promise<void> => {
  // Allow reconfiguration only when no admin exists yet
  if (isDatabaseConfigured()) {
    try {
      const n = await getSuperAdminCount();
      if (n > 0) {
        res.status(409).json({ error: "Platform is already fully initialized" });
        return;
      }
    } catch {
      // DB error - allow re-init attempt
    }
  }

  const parsed = parseDbParams(req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }

  const url = buildConnectionString(parsed.params);

  // 1. Validate the connection
  try {
    await testDatabaseConnection(url);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, error: `Connection failed: ${msg}` });
    return;
  }

  // 2. Activate in-process
  initializeDatabase(url);

  // 3. Persist so it survives restarts
  const existing = loadPlatformConfig();
  savePlatformConfig({ ...existing, databaseUrl: url });

  // 4. Run migrations + seeds (same sequence as normal startup)
  try {
    await runInitSequence();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: `Database initialized but migrations failed: ${msg}` });
    return;
  }

  logger.info("Database configured via setup wizard - platform ready");
  res.json({ ok: true });
});

/**
 * POST /setup/initialize - public, one-time only.
 * Creates the first super_admin / platform owner account.
 * Returns 409 if platform is already initialized.
 */
router.post("/setup/initialize", async (req: Request, res: Response): Promise<void> => {
  if (!isDatabaseConfigured()) {
    res.status(503).json({ error: "Database is not configured yet" });
    return;
  }

  const n = await getSuperAdminCount();
  if (n > 0) {
    res.status(409).json({ error: "Platform is already initialized" });
    return;
  }

  const { fullName, email, employeeNumber, password } = req.body as {
    fullName?: string;
    email?: string;
    employeeNumber?: string;
    password?: string;
  };

  if (!fullName || !email || !employeeNumber || !password) {
    res.status(400).json({ error: "fullName, email, employeeNumber, and password are required" });
    return;
  }

  const pwd = String(password);
  const errors: string[] = [];
  if (pwd.length < 8)            errors.push("at least 8 characters");
  if (!/[A-Z]/.test(pwd))        errors.push("at least one uppercase letter");
  if (!/[a-z]/.test(pwd))        errors.push("at least one lowercase letter");
  if (!/[0-9]/.test(pwd))        errors.push("at least one number");
  if (!/[^A-Za-z0-9]/.test(pwd)) errors.push("at least one special character");
  if (errors.length) {
    res.status(400).json({ error: `Password must contain ${errors.join(", ")}` });
    return;
  }

  const emailNorm  = String(email).trim().toLowerCase();
  const empNum     = String(employeeNumber).trim().toUpperCase();
  const fullNameTr = String(fullName).trim();

  const [byEmp] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.employeeNumber, empNum)).limit(1);
  if (byEmp) { res.status(400).json({ error: "Employee number is already in use" }); return; }

  const [byEmail] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, emailNorm)).limit(1);
  if (byEmail) { res.status(400).json({ error: "Email address is already in use" }); return; }

  const hash      = await bcrypt.hash(pwd, 12);
  const parts     = fullNameTr.split(/\s+/);
  const firstName = parts[0] ?? "";
  const lastName  = parts.slice(1).join(" ") || null;

  const [created] = await db
    .insert(usersTable)
    .values({
      fullName:          fullNameTr,
      firstName,
      lastName,
      email:             emailNorm,
      employeeNumber:    empNum,
      passwordHash:      hash,
      role:              "super_admin",
      status:            "active",
      workspaceId:       null,
      mustResetPassword: false,
    })
    .returning({ id: usersTable.id });

  if (!created) {
    res.status(500).json({ error: "Failed to create account" });
    return;
  }

  const accessToken = signToken(created.id, null, "super_admin");
  res.status(201).json({ accessToken, userId: created.id });
});

export default router;
