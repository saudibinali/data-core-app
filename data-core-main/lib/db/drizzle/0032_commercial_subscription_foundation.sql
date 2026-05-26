-- P15/P16 — Commercial accounts, billing, subscriptions, entitlements (additive, idempotent)
-- Ops: take a full backup before applying in production (pg_dump / managed snapshot).

CREATE TABLE IF NOT EXISTS "commercial_accounts" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL UNIQUE REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "commercial_account_name" text,
  "legal_entity_name" text,
  "account_manager_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "finance_owner_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "contract_owner_name" text,
  "contract_owner_email" text,
  "billing_email" text,
  "billing_phone" text,
  "company_tax_number_placeholder" text,
  "commercial_notes" text,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "commercial_accounts_workspace_id_idx"
  ON "commercial_accounts" ("workspace_id");

CREATE TABLE IF NOT EXISTS "commercial_billing_contacts" (
  "id" serial PRIMARY KEY,
  "commercial_account_id" integer NOT NULL REFERENCES "commercial_accounts"("id") ON DELETE CASCADE,
  "contact_name" text NOT NULL,
  "contact_email" text NOT NULL,
  "contact_phone" text,
  "contact_role" text NOT NULL DEFAULT 'other',
  "is_primary" boolean NOT NULL DEFAULT false,
  "notes" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "commercial_billing_contacts_account_id_idx"
  ON "commercial_billing_contacts" ("commercial_account_id");

CREATE TABLE IF NOT EXISTS "commercial_contract_terms" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "commercial_account_id" integer NOT NULL REFERENCES "commercial_accounts"("id") ON DELETE CASCADE,
  "contract_number" text,
  "contract_title" text,
  "company_name" text,
  "responsible_person_name" text,
  "responsible_person_phone" text,
  "responsible_person_email" text,
  "notes" text,
  "contract_start_date" date,
  "contract_end_date" date,
  "renewal_date" date,
  "renewal_notice_days" integer,
  "contract_term_months" integer,
  "renewal_type" text NOT NULL DEFAULT 'manual',
  "renewal_commitment_status" text NOT NULL DEFAULT 'not_started',
  "contract_value" numeric(14, 2),
  "currency" text,
  "billing_cycle" text,
  "payment_terms" text,
  "internal_owner_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "customer_decision_maker_name" text,
  "customer_decision_maker_email" text,
  "renewal_notes" text,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "commercial_contract_terms_workspace_id_idx"
  ON "commercial_contract_terms" ("workspace_id");
CREATE INDEX IF NOT EXISTS "commercial_contract_terms_account_id_idx"
  ON "commercial_contract_terms" ("commercial_account_id");
CREATE INDEX IF NOT EXISTS "commercial_contract_terms_status_idx"
  ON "commercial_contract_terms" ("workspace_id", "status");

CREATE TABLE IF NOT EXISTS "commercial_contract_documents" (
  "id" serial PRIMARY KEY,
  "contract_id" integer NOT NULL REFERENCES "commercial_contract_terms"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL,
  "original_file_name" text NOT NULL,
  "file_size" integer NOT NULL,
  "mime_type" text NOT NULL,
  "storage_key" text NOT NULL,
  "checksum" text,
  "uploaded_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "uploaded_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "commercial_contract_documents_contract_id_uidx"
  ON "commercial_contract_documents" ("contract_id");
CREATE INDEX IF NOT EXISTS "commercial_contract_documents_storage_key_idx"
  ON "commercial_contract_documents" ("storage_key");

CREATE TABLE IF NOT EXISTS "commercial_invoices" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "commercial_account_id" integer NOT NULL REFERENCES "commercial_accounts"("id") ON DELETE CASCADE,
  "contract_term_id" integer REFERENCES "commercial_contract_terms"("id") ON DELETE SET NULL,
  "invoice_number" text NOT NULL,
  "invoice_title" text,
  "responsible_person_name" text,
  "responsible_person_phone" text,
  "responsible_person_email" text,
  "reminder_date" date,
  "invoice_date" date,
  "due_date" date,
  "invoice_amount" numeric(14, 2),
  "currency" text,
  "billing_period_start" date,
  "billing_period_end" date,
  "status" text NOT NULL DEFAULT 'draft',
  "external_accounting_system_name" text,
  "external_accounting_reference" text,
  "notes" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "commercial_invoices_workspace_id_idx"
  ON "commercial_invoices" ("workspace_id");
CREATE INDEX IF NOT EXISTS "commercial_invoices_account_id_idx"
  ON "commercial_invoices" ("commercial_account_id");
CREATE INDEX IF NOT EXISTS "commercial_invoices_contract_term_id_idx"
  ON "commercial_invoices" ("contract_term_id");
CREATE UNIQUE INDEX IF NOT EXISTS "commercial_invoices_workspace_invoice_number_uidx"
  ON "commercial_invoices" ("workspace_id", "invoice_number");

CREATE TABLE IF NOT EXISTS "commercial_invoice_documents" (
  "id" serial PRIMARY KEY,
  "invoice_id" integer NOT NULL REFERENCES "commercial_invoices"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL,
  "original_file_name" text NOT NULL,
  "file_size" integer NOT NULL,
  "mime_type" text NOT NULL,
  "storage_key" text NOT NULL,
  "checksum" text,
  "uploaded_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "uploaded_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "commercial_invoice_documents_invoice_id_uidx"
  ON "commercial_invoice_documents" ("invoice_id");
CREATE INDEX IF NOT EXISTS "commercial_invoice_documents_storage_key_idx"
  ON "commercial_invoice_documents" ("storage_key");

CREATE TABLE IF NOT EXISTS "commercial_payment_records" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "commercial_account_id" integer NOT NULL REFERENCES "commercial_accounts"("id") ON DELETE CASCADE,
  "invoice_id" integer NOT NULL REFERENCES "commercial_invoices"("id") ON DELETE CASCADE,
  "payment_reference" text NOT NULL,
  "payment_date" date NOT NULL,
  "received_amount" numeric(14, 2) NOT NULL,
  "currency" text NOT NULL,
  "payment_method" text NOT NULL,
  "collection_status" text NOT NULL DEFAULT 'pending_verification',
  "recorded_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "verified_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "verification_date" timestamptz,
  "internal_notes" text,
  "rejection_reason" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "commercial_payment_records_workspace_id_idx"
  ON "commercial_payment_records" ("workspace_id");
CREATE INDEX IF NOT EXISTS "commercial_payment_records_invoice_id_idx"
  ON "commercial_payment_records" ("invoice_id");
CREATE INDEX IF NOT EXISTS "commercial_payment_records_account_id_idx"
  ON "commercial_payment_records" ("commercial_account_id");
CREATE INDEX IF NOT EXISTS "commercial_payment_records_status_idx"
  ON "commercial_payment_records" ("collection_status");
CREATE INDEX IF NOT EXISTS "commercial_payment_records_payment_date_idx"
  ON "commercial_payment_records" ("payment_date");

CREATE TABLE IF NOT EXISTS "tenant_subscriptions" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL UNIQUE REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "plan_code" text,
  "subscription_status" text NOT NULL DEFAULT 'unknown',
  "billing_period_start" timestamptz,
  "billing_period_end" timestamptz,
  "renewal_due_at" timestamptz,
  "trial_started_at" timestamptz,
  "trial_ends_at" timestamptz,
  "grace_period_started_at" timestamptz,
  "grace_period_ends_at" timestamptz,
  "cancelled_at" timestamptz,
  "suspended_at" timestamptz,
  "metadata_json" jsonb,
  "reason" text,
  "updated_by" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "tenant_subscriptions_workspace_id_idx"
  ON "tenant_subscriptions" ("workspace_id");

CREATE TABLE IF NOT EXISTS "workspace_subscriptions" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL UNIQUE REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "commercial_account_id" integer REFERENCES "commercial_accounts"("id") ON DELETE SET NULL,
  "active_contract_term_id" integer REFERENCES "commercial_contract_terms"("id") ON DELETE SET NULL,
  "subscription_code" text NOT NULL,
  "subscription_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'trial',
  "status_reason" text,
  "start_date" date,
  "end_date" date,
  "renewal_date" date,
  "grace_period_ends_at" timestamptz,
  "suspension_started_at" timestamptz,
  "termination_date" date,
  "plan_name" text,
  "internal_notes" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workspace_subscriptions_workspace_id_idx"
  ON "workspace_subscriptions" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_subscriptions_code_workspace_uidx"
  ON "workspace_subscriptions" ("workspace_id", "subscription_code");

CREATE TABLE IF NOT EXISTS "workspace_entitlements" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "subscription_id" integer REFERENCES "workspace_subscriptions"("id") ON DELETE SET NULL,
  "module_key" text NOT NULL,
  "feature_key" text NOT NULL DEFAULT '',
  "is_enabled" boolean NOT NULL DEFAULT true,
  "source" text NOT NULL DEFAULT 'system_default',
  "effective_from" date,
  "effective_until" date,
  "reason" text,
  "internal_notes" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workspace_entitlements_workspace_id_idx"
  ON "workspace_entitlements" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_entitlements_workspace_module_feature_uidx"
  ON "workspace_entitlements" ("workspace_id", "module_key", "feature_key");

CREATE TABLE IF NOT EXISTS "workspace_quota_limits" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "subscription_id" integer REFERENCES "workspace_subscriptions"("id") ON DELETE SET NULL,
  "quota_key" text NOT NULL,
  "limit_value" integer,
  "warning_threshold_percent" integer NOT NULL DEFAULT 80,
  "is_hard_limit" boolean NOT NULL DEFAULT false,
  "source" text NOT NULL DEFAULT 'system_default',
  "effective_from" date,
  "effective_until" date,
  "reason" text,
  "internal_notes" text,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workspace_quota_limits_workspace_id_idx"
  ON "workspace_quota_limits" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_quota_limits_workspace_quota_uidx"
  ON "workspace_quota_limits" ("workspace_id", "quota_key");

CREATE TABLE IF NOT EXISTS "workspace_access_enforcement" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "subscription_id" integer REFERENCES "workspace_subscriptions"("id") ON DELETE SET NULL,
  "enforcement_status" text NOT NULL DEFAULT 'normal',
  "enforcement_reason" text,
  "source" text NOT NULL DEFAULT 'manual',
  "applied_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "applied_at" timestamptz,
  "expires_at" timestamptz,
  "allow_login" boolean NOT NULL DEFAULT true,
  "allow_read" boolean NOT NULL DEFAULT true,
  "allow_create" boolean NOT NULL DEFAULT true,
  "allow_update" boolean NOT NULL DEFAULT true,
  "allow_delete" boolean NOT NULL DEFAULT true,
  "allow_export" boolean NOT NULL DEFAULT true,
  "allow_admin_access" boolean NOT NULL DEFAULT true,
  "internal_notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_access_enforcement_workspace_uidx"
  ON "workspace_access_enforcement" ("workspace_id");
CREATE INDEX IF NOT EXISTS "workspace_access_enforcement_workspace_id_idx"
  ON "workspace_access_enforcement" ("workspace_id");

INSERT INTO "runtime_schema_registry" ("component", "expected_migration", "status")
VALUES ('commercial_subscription_foundation', '0032_commercial_subscription_foundation', 'pending')
ON CONFLICT ("component") DO UPDATE SET
  "expected_migration" = EXCLUDED."expected_migration",
  "status" = EXCLUDED."status";
