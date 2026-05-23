#!/usr/bin/env node
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }

const pool = new Pool({ connectionString: DATABASE_URL });
const SQL_PATH = path.join(__dirname, "..", "lib", "db", "drizzle", "0029_hr_import_runtime_foundation.sql");

async function main() {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(JSON.stringify({ ok: true, migration: "0029_hr_import_runtime_foundation" }, null, 2));
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
