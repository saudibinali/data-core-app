import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const root = path.resolve(import.meta.dirname, "..");
const envLine = fs
  .readFileSync(path.join(root, ".env"), "utf8")
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="));
if (!envLine) throw new Error("DATABASE_URL missing in .env");
const databaseUrl = envLine.slice("DATABASE_URL=".length).trim();

const migrationsFolder = path.join(root, "lib/db/drizzle");
const journal = JSON.parse(
  fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
);

function migrationHash(tag) {
  const sqlPath = path.join(migrationsFolder, `${tag}.sql`);
  const content = fs.readFileSync(sqlPath).toString();
  return crypto.createHash("sha256").update(content).digest("hex");
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const { rows: existing } = await pool.query(
    `SELECT hash FROM drizzle.__drizzle_migrations`,
  );
  const have = new Set(existing.map((r) => r.hash));

  let inserted = 0;
  for (const entry of journal.entries) {
    const hash = migrationHash(entry.tag);
    if (have.has(hash)) continue;
    await pool.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      [hash, entry.when],
    );
    inserted++;
    console.log("inserted", entry.tag);
  }

  const { rows: count } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations`,
  );
  console.log("migration records:", count[0].n, "newly inserted:", inserted);
} finally {
  await pool.end();
}
