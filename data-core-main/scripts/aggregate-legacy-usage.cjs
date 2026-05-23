#!/usr/bin/env node
/** Phase 5: Daily rollup into legacy_cutover_snapshot. */
const { Pool } = require("pg");

const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

let DATABASE_URL;
try {
  DATABASE_URL = resolveDatabaseUrl();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL });
const today = new Date().toISOString().slice(0, 10);

async function main() {
  const { rows: workspaces } = await pool.query(`SELECT id FROM workspaces`);
  let upserted = 0;

  for (const ws of workspaces) {
    const { rows: hits } = await pool.query(
      `SELECT legacy_surface, count(*)::int AS cnt
       FROM legacy_compat_usage_events
       WHERE workspace_id = $1 AND recorded_at >= now() - interval '1 day'
       GROUP BY legacy_surface`,
      [ws.id],
    );
    const legacyHits = Object.fromEntries(hits.map((h) => [h.legacy_surface, h.cnt]));

    const { rows: settings } = await pool.query(
      `SELECT leave_runtime_mode, workforce_canonical_mode, workforce_sync_direction,
              org_runtime_mode, approval_runtime_mode, workforce_governance_mode, workforce_cleanup_stage
       FROM hr_workspace_settings WHERE workspace_id = $1`,
      [ws.id],
    );
    const modes = settings[0] ?? {};
    const stage = modes.workforce_cleanup_stage ?? "none";

    await pool.query(
      `INSERT INTO legacy_cutover_snapshot (workspace_id, snapshot_date, modes, legacy_hits, cleanup_stage, integrity)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, snapshot_date) DO UPDATE
       SET modes = EXCLUDED.modes, legacy_hits = EXCLUDED.legacy_hits,
           cleanup_stage = EXCLUDED.cleanup_stage, integrity = EXCLUDED.integrity`,
      [ws.id, today, JSON.stringify(modes), JSON.stringify(legacyHits), stage,
        JSON.stringify({ zeroActiveLegacyTraffic: Object.values(legacyHits).every((v) => v === 0) })],
    );
    upserted++;
  }

  console.log(JSON.stringify({ ok: true, snapshotDate: today, workspaces: upserted }, null, 2));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
