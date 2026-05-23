"use strict";
/**
 * Records drizzle journal entry for 0001_leave_canonical when tables already exist
 * (e.g. after drizzle-kit push). Safe to run multiple times.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const MIGRATION_TAG = "0001_leave_canonical";
const MIGRATION_WHEN = "1779200000000";

async function main() {
  const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

let DATABASE_URL;
try {
  DATABASE_URL = resolveDatabaseUrl();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
  const sqlPath = path.join(__dirname, "../lib/db/drizzle/0001_leave_canonical.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const hash = crypto.createHash("sha256").update(sql).digest("hex");

  const pool = new Pool({ connectionString: url });
  try {
    const existing = await pool.query(
      `SELECT hash FROM drizzle.__drizzle_migrations WHERE hash = $1`,
      [hash],
    );
    if (existing.rowCount > 0) {
      console.log("Journal entry already present for 0001_leave_canonical");
      return;
    }

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('leave_requests', 'leave_approval_steps')`,
    );
    if (tables.rowCount < 2) {
      console.error("leave_requests / leave_approval_steps not found — run pnpm run migrate in lib/db first");
      process.exit(1);
    }

    await pool.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      [hash, MIGRATION_WHEN],
    );
    console.log(`Stamped journal: ${MIGRATION_TAG} hash=${hash.slice(0, 12)}...`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
