-- P24-B: Canonical procurement foundation (no inventory, no AP, no payments, no posting)

-- Prerequisite: approval-link tables reference workflow_approvals (defined in schema, missing from 0000 journal)
CREATE TABLE IF NOT EXISTS "workflow_approvals" (
  "id" serial PRIMARY KEY NOT NULL,
  "execution_id" integer NOT NULL REFERENCES "workflow_executions"("id") ON DELETE CASCADE,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "workflow_id" integer REFERENCES "workflow_definitions"("id") ON DELETE SET NULL,
  "workflow_version" integer,
  "step_index" integer NOT NULL,
  "step_name" text NOT NULL,
  "step_snapshot" jsonb,
  "action" text NOT NULL,
  "decided_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "notes" text,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  "execution_timeout_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wf_approval_execution" ON "workflow_approvals" ("execution_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wf_approval_workspace" ON "workflow_approvals" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wf_approval_decider" ON "workflow_approvals" ("decided_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wf_approval_decided_at" ON "workflow_approvals" ("decided_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wf_approval_workflow" ON "workflow_approvals" ("workflow_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wf_approval_version" ON "workflow_approvals" ("workflow_id", "workflow_version");

-- ── procurement_vendors ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procurement_vendors" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "vendor_code" text NOT NULL,
  "legal_name" text NOT NULL,
  "display_name" text,
  "status" text NOT NULL DEFAULT 'draft',
  "status_reason" text,
  "risk_level" text NOT NULL DEFAULT 'low',
  "risk_flags_json" text,
  "is_preferred" boolean NOT NULL DEFAULT false,
  "preferred_rank" integer,
  "external_vendor_ref" text,
  "default_currency_code" text NOT NULL DEFAULT 'SAR',
  "notes" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_procurement_vendors_ws_code" ON "procurement_vendors" ("workspace_id", "vendor_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_procurement_vendors_ws_status" ON "procurement_vendors" ("workspace_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_procurement_vendors_ws_preferred" ON "procurement_vendors" ("workspace_id", "is_preferred");

-- ── procurement_vendor_contacts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procurement_vendor_contacts" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "vendor_id" integer NOT NULL REFERENCES "procurement_vendors"("id") ON DELETE CASCADE,
  "contact_name" text NOT NULL,
  "contact_email" text,
  "contact_phone" text,
  "contact_role" text NOT NULL DEFAULT 'other',
  "is_primary" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'active',
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_vendor_contacts_ws_vendor" ON "procurement_vendor_contacts" ("workspace_id", "vendor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_vendor_contacts_ws_primary" ON "procurement_vendor_contacts" ("workspace_id", "vendor_id", "is_primary");

-- ── procurement_vendor_documents ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procurement_vendor_documents" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "vendor_id" integer NOT NULL REFERENCES "procurement_vendors"("id") ON DELETE CASCADE,
  "document_id" integer NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "document_type" text NOT NULL,
  "issued_at" date,
  "expires_at" date,
  "status" text NOT NULL DEFAULT 'active',
  "is_confidential" boolean NOT NULL DEFAULT false,
  "classification" text NOT NULL DEFAULT 'internal',
  "metadata_json" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_proc_vendor_docs_ws_vendor_doc" ON "procurement_vendor_documents" ("workspace_id", "vendor_id", "document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_vendor_docs_ws_vendor" ON "procurement_vendor_documents" ("workspace_id", "vendor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_vendor_docs_ws_expires" ON "procurement_vendor_documents" ("workspace_id", "expires_at");

-- ── procurement_purchase_requests ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procurement_purchase_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "request_number" text NOT NULL,
  "title" text NOT NULL,
  "reason" text,
  "needed_by_date" date,
  "status" text NOT NULL DEFAULT 'draft',
  "currency_code" text NOT NULL DEFAULT 'SAR',
  "estimated_total" numeric(19,4) NOT NULL DEFAULT '0',
  "cost_center_id" integer REFERENCES "finance_cost_centers"("id") ON DELETE SET NULL,
  "dimension_json" text,
  "policy_snapshot_json" text,
  "version" integer NOT NULL DEFAULT 1,
  "idempotency_key" text,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "submitted_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "cancel_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_proc_pr_ws_number" ON "procurement_purchase_requests" ("workspace_id", "request_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_proc_pr_ws_idempotency" ON "procurement_purchase_requests" ("workspace_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_pr_ws_status" ON "procurement_purchase_requests" ("workspace_id", "status", "created_at");

-- ── procurement_request_items ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procurement_request_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "purchase_request_id" integer NOT NULL REFERENCES "procurement_purchase_requests"("id") ON DELETE CASCADE,
  "line_number" integer NOT NULL,
  "item_type" text NOT NULL DEFAULT 'goods',
  "description" text NOT NULL,
  "quantity" numeric(19,4) NOT NULL DEFAULT '1',
  "uom" text,
  "estimated_unit_price" numeric(19,4) NOT NULL DEFAULT '0',
  "estimated_line_total" numeric(19,4) NOT NULL DEFAULT '0',
  "currency_code" text NOT NULL DEFAULT 'SAR',
  "preferred_vendor_id" integer REFERENCES "procurement_vendors"("id") ON DELETE SET NULL,
  "specification_json" text,
  "dimension_json" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_proc_pr_items_ws_pr_line" ON "procurement_request_items" ("workspace_id", "purchase_request_id", "line_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_pr_items_ws_pr" ON "procurement_request_items" ("workspace_id", "purchase_request_id");

-- ── procurement_rfq ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procurement_rfq" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "rfq_number" text NOT NULL,
  "title" text NOT NULL,
  "instructions" text,
  "response_deadline" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "source_purchase_request_id" integer REFERENCES "procurement_purchase_requests"("id") ON DELETE SET NULL,
  "sent_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "awarded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_proc_rfq_ws_number" ON "procurement_rfq" ("workspace_id", "rfq_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_rfq_ws_status" ON "procurement_rfq" ("workspace_id", "status", "created_at");

-- ── procurement_rfq_responses ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procurement_rfq_responses" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "rfq_id" integer NOT NULL REFERENCES "procurement_rfq"("id") ON DELETE CASCADE,
  "vendor_id" integer NOT NULL REFERENCES "procurement_vendors"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'submitted',
  "currency_code" text NOT NULL DEFAULT 'SAR',
  "quoted_total" numeric(19,4) NOT NULL DEFAULT '0',
  "valid_until" date,
  "comparison_json" text,
  "notes" text,
  "submitted_at" timestamp with time zone DEFAULT now(),
  "selected_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_proc_rfq_resp_ws_rfq_vendor" ON "procurement_rfq_responses" ("workspace_id", "rfq_id", "vendor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_rfq_resp_ws_rfq" ON "procurement_rfq_responses" ("workspace_id", "rfq_id");

-- ── procurement_purchase_orders ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procurement_purchase_orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "po_number" text NOT NULL,
  "vendor_id" integer NOT NULL REFERENCES "procurement_vendors"("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'draft',
  "currency_code" text NOT NULL DEFAULT 'SAR',
  "sub_total" numeric(19,4) NOT NULL DEFAULT '0',
  "tax_total" numeric(19,4) NOT NULL DEFAULT '0',
  "grand_total" numeric(19,4) NOT NULL DEFAULT '0',
  "source_rfq_id" integer REFERENCES "procurement_rfq"("id") ON DELETE SET NULL,
  "source_purchase_request_id" integer REFERENCES "procurement_purchase_requests"("id") ON DELETE SET NULL,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "buyer_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "cost_center_id" integer REFERENCES "finance_cost_centers"("id") ON DELETE SET NULL,
  "dimension_json" text,
  "gl_readiness_status" text,
  "gl_readiness_json" text,
  "commitment_status" text NOT NULL DEFAULT 'none',
  "commitment_amount" numeric(19,4) NOT NULL DEFAULT '0',
  "version" integer NOT NULL DEFAULT 1,
  "idempotency_key" text,
  "policy_snapshot_json" text,
  "submitted_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "acknowledged_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "cancel_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_proc_po_ws_number" ON "procurement_purchase_orders" ("workspace_id", "po_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_proc_po_ws_idempotency" ON "procurement_purchase_orders" ("workspace_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_po_ws_status" ON "procurement_purchase_orders" ("workspace_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_po_ws_vendor" ON "procurement_purchase_orders" ("workspace_id", "vendor_id");

-- ── procurement_po_items ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procurement_po_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "purchase_order_id" integer NOT NULL REFERENCES "procurement_purchase_orders"("id") ON DELETE CASCADE,
  "line_number" integer NOT NULL,
  "description" text NOT NULL,
  "quantity" numeric(19,4) NOT NULL DEFAULT '1',
  "uom" text,
  "unit_price" numeric(19,4) NOT NULL DEFAULT '0',
  "line_total" numeric(19,4) NOT NULL DEFAULT '0',
  "currency_code" text NOT NULL DEFAULT 'SAR',
  "delivery_date" date,
  "dimension_json" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_proc_po_items_ws_po_line" ON "procurement_po_items" ("workspace_id", "purchase_order_id", "line_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_po_items_ws_po" ON "procurement_po_items" ("workspace_id", "purchase_order_id");

-- ── procurement_procurement_policies ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procurement_procurement_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'draft',
  "approval_thresholds_json" text,
  "preferred_vendor_rules_json" text,
  "emergency_procurement_json" text,
  "duplicate_prevention_json" text,
  "vendor_restrictions_json" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "activated_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_policies_ws_status" ON "procurement_procurement_policies" ("workspace_id", "status", "created_at");

-- ── procurement_approval_links ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "procurement_approval_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "approval_system" text NOT NULL DEFAULT 'workflow',
  "workflow_execution_id" integer REFERENCES "workflow_executions"("id") ON DELETE SET NULL,
  "workflow_step_index" integer,
  "workflow_approval_id" integer REFERENCES "workflow_approvals"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamp with time zone,
  "notes" text,
  "reason_code" text,
  "policy_snapshot_json" text,
  "idempotency_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_proc_approval_links_ws_entity" ON "procurement_approval_links" ("workspace_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_proc_approval_links_ws_idempotency" ON "procurement_approval_links" ("workspace_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_approval_links_ws_status" ON "procurement_approval_links" ("workspace_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proc_approval_links_ws_workflow" ON "procurement_approval_links" ("workspace_id", "workflow_execution_id");

