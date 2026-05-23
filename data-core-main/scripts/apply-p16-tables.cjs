const pg = require("pg");
const fs = require("fs");
const path = require("path");

const sql = `
CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  commercial_account_id integer,
  active_contract_term_id integer,
  subscription_code text NOT NULL,
  subscription_name text NOT NULL,
  status text NOT NULL DEFAULT 'trial',
  status_reason text,
  start_date date,
  end_date date,
  renewal_date date,
  grace_period_ends_at timestamptz,
  suspension_started_at timestamptz,
  termination_date date,
  plan_name text,
  internal_notes text,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_subscriptions_code_workspace_uidx
  ON workspace_subscriptions (workspace_id, subscription_code);
CREATE INDEX IF NOT EXISTS workspace_subscriptions_workspace_id_idx
  ON workspace_subscriptions (workspace_id);

CREATE TABLE IF NOT EXISTS workspace_entitlements (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id integer REFERENCES workspace_subscriptions(id) ON DELETE SET NULL,
  module_key text NOT NULL,
  feature_key text NOT NULL DEFAULT '',
  is_enabled boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'system_default',
  effective_from date,
  effective_until date,
  reason text,
  internal_notes text,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_entitlements_workspace_module_feature_uidx
  ON workspace_entitlements (workspace_id, module_key, feature_key);
CREATE INDEX IF NOT EXISTS workspace_entitlements_workspace_id_idx
  ON workspace_entitlements (workspace_id);

CREATE TABLE IF NOT EXISTS workspace_quota_limits (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id integer REFERENCES workspace_subscriptions(id) ON DELETE SET NULL,
  quota_key text NOT NULL,
  limit_value integer,
  warning_threshold_percent integer NOT NULL DEFAULT 80,
  is_hard_limit boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'system_default',
  effective_from date,
  effective_until date,
  reason text,
  internal_notes text,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_quota_limits_workspace_quota_uidx
  ON workspace_quota_limits (workspace_id, quota_key);
CREATE INDEX IF NOT EXISTS workspace_quota_limits_workspace_id_idx
  ON workspace_quota_limits (workspace_id);

CREATE TABLE IF NOT EXISTS workspace_subscription_policies (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id integer REFERENCES workspace_subscriptions(id) ON DELETE SET NULL,
  policy_name text NOT NULL,
  grace_period_days integer NOT NULL DEFAULT 7,
  past_due_after_days integer NOT NULL DEFAULT 14,
  suspension_after_days integer NOT NULL DEFAULT 30,
  termination_after_days integer,
  allow_read_only_during_suspension boolean NOT NULL DEFAULT true,
  allow_admin_access_during_suspension boolean NOT NULL DEFAULT true,
  allow_data_export_during_suspension boolean NOT NULL DEFAULT true,
  enforcement_mode text NOT NULL DEFAULT 'advisory_only',
  is_active boolean NOT NULL DEFAULT true,
  reason text,
  internal_notes text,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_subscription_policies_workspace_uidx
  ON workspace_subscription_policies (workspace_id);
CREATE INDEX IF NOT EXISTS workspace_subscription_policies_workspace_id_idx
  ON workspace_subscription_policies (workspace_id);

CREATE TABLE IF NOT EXISTS workspace_access_enforcement (
  id serial PRIMARY KEY,
  workspace_id integer NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id integer REFERENCES workspace_subscriptions(id) ON DELETE SET NULL,
  enforcement_status text NOT NULL DEFAULT 'normal',
  enforcement_reason text,
  source text NOT NULL DEFAULT 'manual',
  applied_by integer REFERENCES users(id) ON DELETE SET NULL,
  applied_at timestamptz,
  expires_at timestamptz,
  allow_login boolean NOT NULL DEFAULT true,
  allow_read boolean NOT NULL DEFAULT true,
  allow_create boolean NOT NULL DEFAULT true,
  allow_update boolean NOT NULL DEFAULT true,
  allow_delete boolean NOT NULL DEFAULT true,
  allow_export boolean NOT NULL DEFAULT true,
  allow_admin_access boolean NOT NULL DEFAULT true,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_access_enforcement_workspace_uidx
  ON workspace_access_enforcement (workspace_id);
CREATE INDEX IF NOT EXISTS workspace_access_enforcement_workspace_id_idx
  ON workspace_access_enforcement (workspace_id);
`;

const pg = require("pg");
const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

async function main() {
  const p = new pg.Pool({
    connectionString: resolveDatabaseUrl(),
  });
  await p.query(sql);
  const r = await p.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('workspace_subscriptions','workspace_entitlements','workspace_quota_limits','workspace_subscription_policies','workspace_access_enforcement')
     ORDER BY 1`,
  );
  console.log("Tables:", r.rows.map((x) => x.table_name).join(", "));
  await p.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
