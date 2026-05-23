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
const sqlPath = path.join(__dirname, "../lib/db/drizzle/0026_approval_runtime_foundation.sql");
const sql = fs.readFileSync(sqlPath, "utf8");
const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(JSON.stringify({ ok: true }, null, 2));
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
