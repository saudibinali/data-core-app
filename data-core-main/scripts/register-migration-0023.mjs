import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "..");
const envLine = fs.readFileSync(path.join(root, ".env"), "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
const databaseUrl = envLine.slice("DATABASE_URL=".length).trim();
const sqlPath = path.join(root, "lib/db/drizzle/0023_platform_user_extensions.sql");
const hash = crypto.createHash("sha256").update(fs.readFileSync(sqlPath)).digest("hex");

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const { rowCount } = await pool.query(
    `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [hash, 1781400000000],
  );
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations`,
  );
  console.log("inserted rows:", rowCount, "total migrations:", rows[0].n);
} finally {
  await pool.end();
}
