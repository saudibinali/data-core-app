#!/usr/bin/env node
/**
 * Safe migration: operational commercial fields + contract PDF table.
 * Does not delete legacy columns or customer rows.
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

const sql = `
ALTER TABLE commercial_contract_terms
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS responsible_person_name text,
  ADD COLUMN IF NOT EXISTS responsible_person_phone text,
  ADD COLUMN IF NOT EXISTS responsible_person_email text,
  ADD COLUMN IF NOT EXISTS notes text;

UPDATE commercial_contract_terms SET
  responsible_person_name = COALESCE(responsible_person_name, customer_decision_maker_name),
  responsible_person_email = COALESCE(responsible_person_email, customer_decision_maker_email),
  notes = COALESCE(notes, renewal_notes)
WHERE responsible_person_name IS NULL
   OR responsible_person_email IS NULL
   OR notes IS NULL;

ALTER TABLE commercial_invoices
  ADD COLUMN IF NOT EXISTS responsible_person_name text,
  ADD COLUMN IF NOT EXISTS responsible_person_phone text,
  ADD COLUMN IF NOT EXISTS responsible_person_email text,
  ADD COLUMN IF NOT EXISTS reminder_date date;

UPDATE commercial_invoices SET reminder_date = COALESCE(reminder_date, due_date)
WHERE reminder_date IS NULL AND due_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS commercial_contract_documents (
  id serial PRIMARY KEY,
  contract_id integer NOT NULL UNIQUE REFERENCES commercial_contract_terms(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  original_file_name text NOT NULL,
  file_size integer NOT NULL,
  mime_type text NOT NULL,
  storage_key text NOT NULL,
  checksum text,
  uploaded_by integer REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_contract_documents_contract_id_uidx
  ON commercial_contract_documents (contract_id);
CREATE INDEX IF NOT EXISTS commercial_contract_documents_storage_key_idx
  ON commercial_contract_documents (storage_key);
`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(JSON.stringify({ ok: true }, null, 2));
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
