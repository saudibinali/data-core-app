/**
 * P17-E - platform_user_invitations table
 */
const pg = require("pg");

const sql = `
CREATE TABLE IF NOT EXISTS platform_user_invitations (
  id serial PRIMARY KEY,
  platform_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by integer REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason text,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_user_invitation_one_pending_per_user_idx
  ON platform_user_invitations (platform_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS platform_user_invitation_user_idx
  ON platform_user_invitations (platform_user_id);

CREATE INDEX IF NOT EXISTS platform_user_invitation_status_idx
  ON platform_user_invitations (status);
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
    console.log("P17-E platform_user_invitations applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
