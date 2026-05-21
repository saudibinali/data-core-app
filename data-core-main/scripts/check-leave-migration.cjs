"use strict";
const { Pool } = require("pg");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    const mig = await pool.query(
      `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`,
    ).catch(() => ({ rows: [] }));
    console.log("migrations:", mig.rows);

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('leave_requests', 'leave_approval_steps')`,
    );
    console.log("leave_tables:", tables.rows.map((r) => r.table_name));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
