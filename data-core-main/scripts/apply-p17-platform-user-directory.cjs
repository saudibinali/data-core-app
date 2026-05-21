/**
 * P17-A - Platform user directory columns on users table
 */
const pg = require("pg");
const path = require("path");

const sql = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_job_title text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_department text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_user_type text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_created_by integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_updated_by integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_disabled_by integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_disabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_disable_reason text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_reactivated_by integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_reactivated_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_reactivation_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
  ON users (lower(trim(email)))
  WHERE email IS NOT NULL AND trim(email) <> '';
`;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
    console.log("P17-A platform user directory columns applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
