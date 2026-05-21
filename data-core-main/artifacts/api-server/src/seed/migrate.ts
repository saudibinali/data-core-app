/**
 * Auto-migration runner.
 *
 * Applies all pending SQL migrations from lib/db/drizzle/ at server startup.
 * Safe to call on every boot - drizzle tracks which migrations have already run
 * in the `drizzle.__drizzle_migrations` table.
 *
 * Baseline handling: if the database was created with `drizzle-kit push`
 * (no migration tracking) but all tables already exist, the function detects
 * this and marks the initial migration as already applied before running the
 * migrator, so subsequent schema changes can be tracked correctly.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, pool } from "@workspace/db";
import { logger } from "../lib/logger";

function getMigrationsFolder(): string {
  // __dirname is injected by the esbuild banner; dist/drizzle/ in production.
  return path.resolve(
    typeof __dirname !== "undefined" ? __dirname : process.cwd(),
    "drizzle",
  );
}

/**
 * Compute the SHA-256 hash of a migration SQL file - exactly as drizzle does.
 */
function migrationHash(sqlPath: string): string {
  const content = fs.readFileSync(sqlPath).toString();
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Seed the drizzle migration tracking table so the migrator treats all
 * existing SQL files as already applied.  Called only when tables exist
 * but migration history is missing (= database was set up via `push`).
 */
async function baselineMigrations(migrationsFolder: string): Promise<void> {
  const journalPath = path.join(migrationsFolder, "meta/_journal.json");
  if (!fs.existsSync(journalPath)) return;

  const journal = JSON.parse(fs.readFileSync(journalPath).toString()) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };

  // Ensure the drizzle schema and migrations table exist.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  // Insert a record for every migration file so the migrator skips them.
  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;

    const hash = migrationHash(sqlPath);
    await pool.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [hash, entry.when],
    );

    logger.info({ tag: entry.tag }, "Baselined migration as already applied");
  }
}

export async function runMigrations(): Promise<void> {
  const migrationsFolder = getMigrationsFolder();

  if (!fs.existsSync(migrationsFolder)) {
    logger.warn({ migrationsFolder }, "Migrations folder not found - skipping auto-migration");
    return;
  }

  logger.info({ migrationsFolder }, "Running database migrations");

  // Detect "push-created" databases: tables exist but no migration records.
  // This happens when the DB was set up with `drizzle-kit push` (which does
  // not write to __drizzle_migrations) or when a previous baseline attempt
  // created the tracking table but failed before inserting any records.
  const { rows: workspacesRows } = await pool.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'workspaces'
    LIMIT 1
  `);

  const dbHasTables = workspacesRows.length > 0;

  if (dbHasTables) {
    // Check if ANY migration records exist in the tracking table.
    let appliedCount = 0;
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS n FROM drizzle.__drizzle_migrations`,
      );
      appliedCount = Number(rows[0]?.n ?? 0);
    } catch {
      // Table may not exist yet - that's fine, baseline will create it.
      appliedCount = 0;
    }

    if (appliedCount === 0) {
      logger.info("Detected existing database with no migration history - baselining");
      await baselineMigrations(migrationsFolder);
    }
  }

  await migrate(db, { migrationsFolder });
  logger.info("Database migrations complete");
}
