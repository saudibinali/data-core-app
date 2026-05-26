#!/usr/bin/env node
/**
 * Optional pre-migration backup helper (F0.2 ops contract).
 * Requires pg_dump on PATH. Writes to ./backups/ by default.
 *
 *   DATABASE_URL=... node scripts/backup-database.cjs
 *   BACKUP_DIR=./backups node scripts/backup-database.cjs
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

let databaseUrl;
try {
  databaseUrl = resolveDatabaseUrl();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

const backupDir = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.resolve(process.cwd(), "backups");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outfile = path.join(backupDir, `pre-migrate-${stamp}.sql`);

fs.mkdirSync(backupDir, { recursive: true });

const result = spawnSync(
  "pg_dump",
  ["--no-owner", "--no-acl", "--format=plain", "--file", outfile, databaseUrl],
  { encoding: "utf8", shell: process.platform === "win32" },
);

if (result.status !== 0) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "PG_DUMP_FAILED",
        stderr: result.stderr || result.error?.message,
        hint: "Install PostgreSQL client tools or run a managed snapshot before migrate",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, backupFile: outfile }, null, 2));
