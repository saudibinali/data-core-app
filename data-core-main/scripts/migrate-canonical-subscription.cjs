#!/usr/bin/env node
/**
 * One-time migration: tenant_subscriptions → workspace_subscriptions,
 * tenant_entitlement_overrides → workspace_module_settings.
 *
 * Safe: does not delete workspaces or commercial data.
 * Run: node scripts/migrate-canonical-subscription.cjs
 * Requires DATABASE_URL in environment or .env loaded by caller.
 */

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

function mapStatus(p13Status) {
  const m = {
    unknown: "trial",
    trialing: "trial",
    active: "active",
    renewal_due: "active",
    grace_period: "grace_period",
    expired: "past_due",
    suspended: "suspended",
    cancelled: "terminated",
  };
  return m[p13Status] ?? "trial";
}

function toDateOnly(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const legacy = await client.query(`SELECT * FROM tenant_subscriptions`);
    let migratedSubs = 0;
    let skippedSubs = 0;

    for (const row of legacy.rows) {
      const existing = await client.query(
        `SELECT id FROM workspace_subscriptions WHERE workspace_id = $1`,
        [row.workspace_id],
      );
      if (existing.rows.length > 0) {
        skippedSubs++;
        continue;
      }

      const code = row.plan_code
        ? `PLAN-${String(row.plan_code).replace(/[^a-zA-Z0-9_]/g, "")}`
        : `TENANT-${row.workspace_id}`;
      const [ws] = (
        await client.query(`SELECT name FROM workspaces WHERE id = $1`, [row.workspace_id])
      ).rows;
      const name =
        (row.plan_code ? `${row.plan_code} plan` : null) ??
        ws?.name ??
        `Workspace ${row.workspace_id}`;

      await client.query(
        `INSERT INTO workspace_subscriptions (
          workspace_id, subscription_code, subscription_name, status, status_reason,
          start_date, end_date, renewal_date, grace_period_ends_at, plan_name, internal_notes,
          created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
        [
          row.workspace_id,
          code.slice(0, 120),
          String(name).slice(0, 200),
          mapStatus(row.subscription_status),
          row.reason,
          toDateOnly(row.billing_period_start),
          toDateOnly(row.billing_period_end),
          toDateOnly(row.renewal_due_at),
          row.grace_period_ends_at,
          row.plan_code,
          row.metadata_json ? JSON.stringify(row.metadata_json) : null,
        ],
      );
      migratedSubs++;
    }

    const overrides = await client.query(`SELECT * FROM tenant_entitlement_overrides`);
    let moduleUpdates = 0;

    for (const ov of overrides.rows) {
      if (ov.override_type === "limit_override") continue;
      const enabled = ov.override_type === "enable";
      const key = String(ov.module_code).replace(/-/g, "_");
      await client.query(
        `INSERT INTO workspace_module_settings (workspace_id, module_key, enabled, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (workspace_id, module_key)
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [ov.workspace_id, key, enabled],
      );
      moduleUpdates++;
    }

    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          ok: true,
          workspaceSubscriptionsMigrated: migratedSubs,
          workspaceSubscriptionsSkippedExisting: skippedSubs,
          moduleSettingsFromOverrides: moduleUpdates,
        },
        null,
        2,
      ),
      );
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
