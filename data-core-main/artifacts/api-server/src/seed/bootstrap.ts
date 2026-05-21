/**
 * Auto-bootstrap: creates a default super_admin account on first run.
 *
 * Development mode  → creates admin/admin silently if no users exist.
 * Production mode   → skips auto-creation; the Setup Wizard handles it.
 *
 * This runs every time the server starts, but is a no-op when users exist.
 */
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { count } from "drizzle-orm";
import { logger } from "../lib/logger";

const DEV_EMPLOYEE_NUMBER = process.env["DEFAULT_ADMIN_EMP"]   ?? "admin";
const DEV_PASSWORD         = process.env["DEFAULT_ADMIN_PASS"]  ?? "admin";
const DEV_FULL_NAME        = process.env["DEFAULT_ADMIN_NAME"]  ?? "Platform Owner";
const DEV_EMAIL            = process.env["DEFAULT_ADMIN_EMAIL"] ?? "admin@platform.local";

export async function bootstrapDevAdmin(): Promise<void> {
  const isProduction = process.env["NODE_ENV"] === "production";

  // In production the Setup Wizard handles first-run - don't auto-seed.
  if (isProduction) return;

  // Check whether any user exists at all (not just super_admin).
  const [result] = await db.select({ n: count() }).from(usersTable);
  const total = Number(result?.n ?? 0);

  if (total > 0) return; // already initialized - nothing to do

  logger.info("No users found - bootstrapping default dev admin account");

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);
  const parts        = DEV_FULL_NAME.trim().split(/\s+/);
  const firstName    = parts[0] ?? "Platform";
  const lastName     = parts.slice(1).join(" ") || null;

  await db.insert(usersTable).values({
    fullName:          DEV_FULL_NAME,
    firstName,
    lastName,
    email:             DEV_EMAIL,
    employeeNumber:    DEV_EMPLOYEE_NUMBER,
    passwordHash,
    role:              "super_admin",
    status:            "active",
    workspaceId:       null,
    mustResetPassword: true,
  });

  logger.info(
    { employeeNumber: DEV_EMPLOYEE_NUMBER },
    "Default dev admin created - sign in with admin / admin and change your password",
  );
}
