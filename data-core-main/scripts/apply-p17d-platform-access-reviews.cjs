/**
 * P17-D - platform_user_access_reviews table
 */
const pg = require("pg");

const sql = `
CREATE TABLE IF NOT EXISTS platform_user_access_reviews (
  id serial PRIMARY KEY,
  platform_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewed_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  review_status text NOT NULL CHECK (review_status IN ('reviewed', 'needs_follow_up', 'exception_accepted')),
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_user_access_review_user_idx
  ON platform_user_access_reviews (platform_user_id);
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
    console.log("P17-D platform_user_access_reviews applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
