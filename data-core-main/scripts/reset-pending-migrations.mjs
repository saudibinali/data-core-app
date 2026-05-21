import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const root = path.resolve(import.meta.dirname, "..");
const envLine = fs
  .readFileSync(path.join(root, ".env"), "utf8")
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="));
const databaseUrl = envLine.slice("DATABASE_URL=".length).trim();

const migrationsFolder = path.join(root, "lib/db/drizzle");
const journal = JSON.parse(
  fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
);

function migrationHash(tag) {
  const sqlPath = path.join(migrationsFolder, `${tag}.sql`);
  return crypto.createHash("sha256").update(fs.readFileSync(sqlPath).toString()).digest("hex");
}

/** First migration tag that was marked applied but schema is missing (reporting). */
const ROLLBACK_FROM_TAG = "0004_reporting_infrastructure";

const rollbackFrom = journal.entries.findIndex((e) => e.tag === ROLLBACK_FROM_TAG);
if (rollbackFrom < 0) throw new Error(`Tag not found: ${ROLLBACK_FROM_TAG}`);

const hashesToRemove = journal.entries.slice(rollbackFrom).map((e) => migrationHash(e.tag));

const pool = new Pool({ connectionString: databaseUrl });
try {
  const { rowCount } = await pool.query(
    `DELETE FROM drizzle.__drizzle_migrations WHERE hash = ANY($1::text[])`,
    [hashesToRemove],
  );
  console.log("removed migration records:", rowCount);

  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
  console.log("migrate complete");
} finally {
  await pool.end();
}
