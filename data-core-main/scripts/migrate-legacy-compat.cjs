#!/usr/bin/env node
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

let DATABASE_URL;
try {
  DATABASE_URL = resolveDatabaseUrl();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL });
const SQL_PATH = path.join(__dirname, "..", "lib", "db", "drizzle", "0028_legacy_compat_stabilization.sql");

async function main() {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(JSON.stringify({ ok: true, migration: "0028_legacy_compat_stabilization" }, null, 2));
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
