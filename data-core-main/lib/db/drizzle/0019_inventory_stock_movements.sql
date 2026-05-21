-- P25-B: Immutable inventory stock movement ledger (no GL posting)

CREATE TABLE IF NOT EXISTS "inventory_stock_movements" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "movement_number" text NOT NULL,
  "movement_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'posted',
  "item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
  "variant_id" integer REFERENCES "inventory_item_variants"("id") ON DELETE SET NULL,
  "warehouse_id" integer NOT NULL REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT,
  "from_location_id" integer REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
  "to_location_id" integer REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
  "quantity" numeric(19,4) NOT NULL,
  "uom" text,
  "unit_cost" numeric(19,4),
  "total_cost" numeric(19,4),
  "source_entity_type" text NOT NULL,
  "source_entity_id" text NOT NULL,
  "transfer_group_id" text,
  "correction_of_movement_id" integer REFERENCES "inventory_stock_movements"("id") ON DELETE SET NULL,
  "cost_center_id" integer REFERENCES "finance_cost_centers"("id") ON DELETE SET NULL,
  "dimension_json" text,
  "gl_impact_readiness" text NOT NULL DEFAULT 'not_applicable',
  "policy_snapshot_json" text,
  "idempotency_key" text,
  "metadata_json" text,
  "posted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "posted_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_movements_ws_number" ON "inventory_stock_movements" ("workspace_id", "movement_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_movements_ws_idempotency" ON "inventory_stock_movements" ("workspace_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_ws_type" ON "inventory_stock_movements" ("workspace_id", "movement_type", "posted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_ws_source" ON "inventory_stock_movements" ("workspace_id", "source_entity_type", "source_entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_ws_item" ON "inventory_stock_movements" ("workspace_id", "item_id", "posted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_ws_transfer_group" ON "inventory_stock_movements" ("workspace_id", "transfer_group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_ws_correction" ON "inventory_stock_movements" ("workspace_id", "correction_of_movement_id");

-- P25-B operational headers (transfer/issue runtime)
CREATE TABLE IF NOT EXISTS "inventory_transfers" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "transfer_number" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "transfer_group_id" text NOT NULL,
  "from_warehouse_id" integer NOT NULL REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT,
  "to_warehouse_id" integer NOT NULL REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT,
  "from_location_id" integer NOT NULL REFERENCES "inventory_locations"("id") ON DELETE RESTRICT,
  "to_location_id" integer NOT NULL REFERENCES "inventory_locations"("id") ON DELETE RESTRICT,
  "in_transit_location_id" integer REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
  "item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
  "variant_id" integer REFERENCES "inventory_item_variants"("id") ON DELETE SET NULL,
  "quantity" numeric(19,4) NOT NULL,
  "uom" text,
  "policy_snapshot_json" text,
  "idempotency_key" text,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_transfers_ws_number" ON "inventory_transfers" ("workspace_id", "transfer_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_transfers_ws_group" ON "inventory_transfers" ("workspace_id", "transfer_group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_transfers_ws_status" ON "inventory_transfers" ("workspace_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "inventory_issues" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "issue_number" text NOT NULL,
  "status" text NOT NULL DEFAULT 'posted',
  "warehouse_id" integer NOT NULL REFERENCES "inventory_warehouses"("id") ON DELETE RESTRICT,
  "location_id" integer NOT NULL REFERENCES "inventory_locations"("id") ON DELETE RESTRICT,
  "item_id" integer NOT NULL REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
  "variant_id" integer REFERENCES "inventory_item_variants"("id") ON DELETE SET NULL,
  "quantity" numeric(19,4) NOT NULL,
  "uom" text,
  "unit_cost" numeric(19,4),
  "reason_code" text,
  "cost_center_id" integer REFERENCES "finance_cost_centers"("id") ON DELETE SET NULL,
  "dimension_json" text,
  "policy_snapshot_json" text,
  "movement_id" integer,
  "voided_movement_id" integer,
  "idempotency_key" text,
  "posted_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "voided_at" timestamp with time zone,
  "posted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_issues_ws_number" ON "inventory_issues" ("workspace_id", "issue_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_issues_ws_status" ON "inventory_issues" ("workspace_id", "status", "posted_at");
