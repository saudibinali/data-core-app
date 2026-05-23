/**
 * P17-B - platform_user_permission_overrides table
 */
const pg = require("pg");

const sql = `
CREATE TABLE IF NOT EXISTS platform_user_permission_overrides (
  id serial PRIMARY KEY,
  platform_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('grant', 'deny')),
  reason text NOT NULL,
  created_by integer NOT NULL,
  updated_by integer NOT NULL,
  removed_at timestamptz,
  removed_by integer,
  remove_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_user_perm_override_active_unique_idx
  ON platform_user_permission_overrides (platform_user_id, permission_code)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS platform_user_perm_override_user_idx
  ON platform_user_permission_overrides (platform_user_id);
`;

async function main() {
  const { resolveDatabaseUrl } = require("./lib/db-resolver.cjs");

let DATABASE_URL;
try {
  DATABASE_URL = resolveDatabaseUrl();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
    console.log("P17-B platform_user_permission_overrides applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
