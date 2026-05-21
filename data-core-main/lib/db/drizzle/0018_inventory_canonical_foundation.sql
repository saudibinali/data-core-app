-- P25-A: Canonical inventory foundation + procurement PO receiving columns (no movements, no posting)

-- ── inventory_warehouses ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_warehouses" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'active',
  "warehouse_type" text NOT NULL DEFAULT 'standard',
  "parent_warehouse_id" integer REFERENCES "inventory_warehouses"("id") ON DELETE SET NULL,
  "default_receiving_location_id" integer,
  "cost_center_id" integer REFERENCES "finance_cost_centers"("id") ON DELETE SET NULL,
  "dimension_json" text,
  "address_json" text,
  "timezone" text,
  "metadata_json" text,
  "policy_snapshot_json" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_warehouses_ws_code" ON "inventory_warehouses" ("workspace_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_warehouses_ws_status" ON "inventory_warehouses" ("workspace_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_warehouses_ws_parent" ON "inventory_warehouses" ("workspace_id", "parent_warehouse_id");

-- ── inventory_locations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_locations" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "warehouse_id" integer NOT NULL REFERENCES "inventory_warehouses"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "location_type" text NOT NULL DEFAULT 'bin',
  "is_pickable" boolean NOT NULL DEFAULT true,
  "is_receivable" boolean NOT NULL DEFAULT true,
  "is_active" boolean NOT NULL DEFAULT true,
  "parent_location_id" integer REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "metadata_json" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_locations_ws_wh_code" ON "inventory_locations" ("workspace_id", "warehouse_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_locations_ws_wh" ON "inventory_locations" ("workspace_id", "warehouse_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_locations_ws_type" ON "inventory_locations" ("workspace_id", "location_type");

-- ── inventory_items ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "sku" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'active',
  "item_type" text NOT NULL DEFAULT 'stocked',
  "base_uom" text NOT NULL DEFAULT 'EA',
  "uom_conversion_json" text,
  "tracking_policy" text NOT NULL DEFAULT 'none',
  "valuation_method" text NOT NULL DEFAULT 'moving_average',
  "standard_cost" numeric(19,4),
  "default_warehouse_id" integer REFERENCES "inventory_warehouses"("id") ON DELETE SET NULL,
  "default_location_id" integer,
  "metadata_json" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_items_ws_sku" ON "inventory_items" ("workspace_id", "sku");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_items_ws_status" ON "inventory_items" ("workspace_id", "status");

-- ── procurement_po_items receiving columns (additive) ─────────────────────────
ALTER TABLE "procurement_po_items" ADD COLUMN IF NOT EXISTS "inventory_item_id" integer REFERENCES "inventory_items"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "procurement_po_items" ADD COLUMN IF NOT EXISTS "quantity_received" numeric(19,4) NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "procurement_po_items" ADD COLUMN IF NOT EXISTS "receiving_status" text NOT NULL DEFAULT 'not_started';

-- ── inventory_item_variants ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_item_variants" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "variant_sku" text NOT NULL,
  "name" text,
  "attributes_json" text,
  "status" text NOT NULL DEFAULT 'active',
  "barcode" text,
  "standard_cost" numeric(19,4),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_variants_ws_sku" ON "inventory_item_variants" ("workspace_id", "variant_sku");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_variants_ws_item" ON "inventory_item_variants" ("workspace_id", "item_id");

-- ── inventory_stock_balances ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_stock_balances" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "warehouse_id" integer NOT NULL REFERENCES "inventory_warehouses"("id") ON DELETE CASCADE,
  "location_id" integer NOT NULL REFERENCES "inventory_locations"("id") ON DELETE CASCADE,
  "item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE CASCADE,
  "variant_id" integer REFERENCES "inventory_item_variants"("id") ON DELETE SET NULL,
  "quantity_on_hand" numeric(19,4) NOT NULL DEFAULT '0',
  "quantity_reserved" numeric(19,4) NOT NULL DEFAULT '0',
  "quantity_available" numeric(19,4) NOT NULL DEFAULT '0',
  "average_unit_cost" numeric(19,4),
  "valuation_readiness_status" text,
  "version" integer NOT NULL DEFAULT 1,
  "last_updated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_balances_ws_loc_item" ON "inventory_stock_balances" ("workspace_id", "warehouse_id", "location_id", "item_id", "variant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_balances_ws_wh" ON "inventory_stock_balances" ("workspace_id", "warehouse_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_balances_ws_item" ON "inventory_stock_balances" ("workspace_id", "item_id");

-- ── inventory_receipts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_receipts" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "receipt_number" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "receipt_type" text NOT NULL DEFAULT 'po',
  "procurement_purchase_order_id" integer REFERENCES "procurement_purchase_orders"("id") ON DELETE SET NULL,
  "procurement_vendor_id" integer REFERENCES "procurement_vendors"("id") ON DELETE SET NULL,
  "warehouse_id" integer NOT NULL REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT,
  "default_location_id" integer REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
  "received_at" timestamp with time zone,
  "received_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "valuation_readiness_status" text,
  "valuation_readiness_json" text,
  "policy_snapshot_json" text,
  "idempotency_key" text,
  "notes" text,
  "metadata_json" text,
  "posted_at" timestamp with time zone,
  "voided_at" timestamp with time zone,
  "void_reason" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_receipts_ws_number" ON "inventory_receipts" ("workspace_id", "receipt_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_receipts_ws_idempotency" ON "inventory_receipts" ("workspace_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_receipts_ws_status" ON "inventory_receipts" ("workspace_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_receipts_ws_po" ON "inventory_receipts" ("workspace_id", "procurement_purchase_order_id");

-- ── inventory_receipt_items ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_receipt_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "receipt_id" integer NOT NULL REFERENCES "inventory_receipts"("id") ON DELETE CASCADE,
  "line_number" integer NOT NULL,
  "item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
  "variant_id" integer REFERENCES "inventory_item_variants"("id") ON DELETE SET NULL,
  "procurement_po_item_id" integer REFERENCES "procurement_po_items"("id") ON DELETE SET NULL,
  "quantity_ordered" numeric(19,4),
  "quantity_received" numeric(19,4) NOT NULL DEFAULT '0',
  "quantity_rejected" numeric(19,4) NOT NULL DEFAULT '0',
  "uom" text,
  "unit_cost" numeric(19,4),
  "to_location_id" integer REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
  "cost_center_id" integer REFERENCES "finance_cost_centers"("id") ON DELETE SET NULL,
  "dimension_json" text,
  "rejection_reason" text,
  "metadata_json" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_receipt_items_ws_rcpt_line" ON "inventory_receipt_items" ("workspace_id", "receipt_id", "line_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_receipt_items_ws_receipt" ON "inventory_receipt_items" ("workspace_id", "receipt_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_receipt_items_ws_po_item" ON "inventory_receipt_items" ("workspace_id", "procurement_po_item_id");

-- ── inventory_receipt_documents ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_receipt_documents" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "receipt_id" integer NOT NULL REFERENCES "inventory_receipts"("id") ON DELETE CASCADE,
  "document_id" integer NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "document_type" text NOT NULL,
  "is_confidential" boolean NOT NULL DEFAULT false,
  "classification" text NOT NULL DEFAULT 'internal',
  "metadata_json" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_receipt_docs_ws_rcpt_doc" ON "inventory_receipt_documents" ("workspace_id", "receipt_id", "document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_receipt_docs_ws_receipt" ON "inventory_receipt_documents" ("workspace_id", "receipt_id");

-- ── inventory_reservations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_reservations" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "reservation_number" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "reservation_type" text NOT NULL DEFAULT 'po_commitment',
  "item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
  "variant_id" integer REFERENCES "inventory_item_variants"("id") ON DELETE SET NULL,
  "warehouse_id" integer NOT NULL REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT,
  "location_id" integer REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
  "quantity" numeric(19,4) NOT NULL,
  "uom" text,
  "source_entity_type" text,
  "source_entity_id" text,
  "expires_at" timestamp with time zone,
  "policy_snapshot_json" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "released_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "released_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_reservations_ws_number" ON "inventory_reservations" ("workspace_id", "reservation_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_reservations_ws_status" ON "inventory_reservations" ("workspace_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_reservations_ws_source" ON "inventory_reservations" ("workspace_id", "source_entity_type", "source_entity_id");

-- ── inventory_adjustments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_adjustments" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "adjustment_number" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "adjustment_type" text NOT NULL,
  "reason_code" text,
  "notes" text,
  "warehouse_id" integer NOT NULL REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT,
  "policy_snapshot_json" text,
  "valuation_readiness_status" text,
  "posted_at" timestamp with time zone,
  "posted_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_adjustments_ws_number" ON "inventory_adjustments" ("workspace_id", "adjustment_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_adjustments_ws_status" ON "inventory_adjustments" ("workspace_id", "status", "created_at");

-- ── inventory_adjustment_items ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_adjustment_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "adjustment_id" integer NOT NULL REFERENCES "inventory_adjustments"("id") ON DELETE CASCADE,
  "line_number" integer NOT NULL,
  "item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
  "variant_id" integer REFERENCES "inventory_item_variants"("id") ON DELETE SET NULL,
  "from_location_id" integer REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
  "to_location_id" integer REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
  "quantity" numeric(19,4) NOT NULL,
  "uom" text,
  "unit_cost" numeric(19,4),
  "cost_center_id" integer REFERENCES "finance_cost_centers"("id") ON DELETE SET NULL,
  "dimension_json" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_adj_items_ws_adj_line" ON "inventory_adjustment_items" ("workspace_id", "adjustment_id", "line_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_adj_items_ws_adj" ON "inventory_adjustment_items" ("workspace_id", "adjustment_id");

-- ── inventory_count_sessions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_count_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "session_number" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "count_type" text NOT NULL DEFAULT 'cycle',
  "warehouse_id" integer NOT NULL REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT,
  "location_scope_json" text,
  "scheduled_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "policy_snapshot_json" text,
  "assigned_to_user_ids_json" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_count_sessions_ws_number" ON "inventory_count_sessions" ("workspace_id", "session_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_count_sessions_ws_status" ON "inventory_count_sessions" ("workspace_id", "status", "created_at");

-- ── inventory_count_items ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_count_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "session_id" integer NOT NULL REFERENCES "inventory_count_sessions"("id") ON DELETE CASCADE,
  "item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
  "variant_id" integer REFERENCES "inventory_item_variants"("id") ON DELETE SET NULL,
  "location_id" integer NOT NULL REFERENCES "inventory_locations"("id") ON DELETE RESTRICT,
  "system_quantity" numeric(19,4) NOT NULL DEFAULT '0',
  "counted_quantity" numeric(19,4),
  "variance_quantity" numeric(19,4),
  "count_status" text NOT NULL DEFAULT 'pending',
  "counted_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "counted_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_count_items_ws_session" ON "inventory_count_items" ("workspace_id", "session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_count_items_ws_loc" ON "inventory_count_items" ("workspace_id", "location_id");

-- ── inventory_inventory_policies ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_inventory_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "policy_key" text NOT NULL DEFAULT 'default',
  "status" text NOT NULL DEFAULT 'draft',
  "policy_json" text,
  "version" integer NOT NULL DEFAULT 1,
  "effective_from" timestamp with time zone,
  "effective_to" timestamp with time zone,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "activated_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_policies_ws_key_status" ON "inventory_inventory_policies" ("workspace_id", "policy_key", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_policies_ws_status" ON "inventory_inventory_policies" ("workspace_id", "status", "created_at");

-- ── inventory_approval_links ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_approval_links" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_approval_links_ws_entity" ON "inventory_approval_links" ("workspace_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_approval_links_ws_idempotency" ON "inventory_approval_links" ("workspace_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_approval_links_ws_status" ON "inventory_approval_links" ("workspace_id", "status", "created_at");
