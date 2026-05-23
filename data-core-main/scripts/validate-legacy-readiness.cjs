#!/usr/bin/env node
/** Phase 5: Gate check — zero legacy traffic in window before cleanup stage promotion. */
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
const WORKSPACE_ID = parseInt(process.env.WORKSPACE_ID ?? "", 10);
const DAYS = parseInt(process.env.DAYS ?? "30", 10);

if (!DATABASE_URL || !WORKSPACE_ID) {
  console.error("DATABASE_URL and WORKSPACE_ID are required");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  const since = new Date();
  since.setDate(since.getDate() - DAYS);

  const { rows } = await pool.query(
    `SELECT legacy_surface, event_type, count(*)::int AS cnt
     FROM legacy_compat_usage_events
     WHERE workspace_id = $1 AND recorded_at >= $2
       AND event_type IN ('route_hit', 'adapter_write')
     GROUP BY legacy_surface, event_type
     ORDER BY cnt DESC`,
    [WORKSPACE_ID, since.toISOString()],
  );

  const total = rows.reduce((s, r) => s + r.cnt, 0);
  const ok = total === 0;

  console.log(JSON.stringify({
    ok,
    workspaceId: WORKSPACE_ID,
    days: DAYS,
    totalLegacyHits: total,
    breakdown: rows,
    message: ok ? "ZERO ACTIVE DEPENDENCIES in window" : "Legacy traffic still active — do not promote cleanup stage",
  }, null, 2));

  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
