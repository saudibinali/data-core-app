const { Pool } = require("pg");

/**
 * Probes DATABASE_URL once before test workers start.
 * Sets SMOKE_DB_REACHABLE=1|0 so integration smokes skip cleanly when DB is down.
 */
module.exports = async function globalSetup() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    process.env.SMOKE_DB_REACHABLE = "0";
    return;
  }

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 4000 });
  try {
    await pool.query("SELECT 1");
    process.env.SMOKE_DB_REACHABLE = "1";
  } catch {
    process.env.SMOKE_DB_REACHABLE = "0";
  } finally {
    await pool.end().catch(() => undefined);
  }
};
