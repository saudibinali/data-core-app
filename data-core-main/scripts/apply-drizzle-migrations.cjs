#!/usr/bin/env node
/**
 * Apply pending Drizzle journal migrations (additive).
 * Production: run scripts/backup-database.cjs before this script.
 */
const path = require("node:path");
const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
const { migrate } = require("drizzle-orm/node-postgres/migrator");

const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

const root = path.resolve(__dirname, "..");
const migrationsFolder = path.join(root, "lib/db/drizzle");

let databaseUrl;
try {
  databaseUrl = resolveDatabaseUrl();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    await migrate(db, { migrationsFolder });
    console.log(
      JSON.stringify(
        { ok: true, migrationsFolder, message: "Drizzle migrations applied" },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          hint: "Take a backup before retrying. See scripts/backup-database.cjs",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
