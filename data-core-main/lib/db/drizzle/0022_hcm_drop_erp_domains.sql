-- HCM Strategic Refactor: drop ERP domains (finance, procurement, inventory).
-- BACKUP DATABASE BEFORE APPLYING. Irreversible without restore.
-- Historical migrations 0013–0019 remain in journal for audit trail.

-- Inventory (movement layer first)
DROP TABLE IF EXISTS "inventory_issues" CASCADE;
DROP TABLE IF EXISTS "inventory_transfers" CASCADE;
DROP TABLE IF EXISTS "inventory_stock_movements" CASCADE;
DROP TABLE IF EXISTS "inventory_count_items" CASCADE;
DROP TABLE IF EXISTS "inventory_count_sessions" CASCADE;
DROP TABLE IF EXISTS "inventory_adjustment_items" CASCADE;
DROP TABLE IF EXISTS "inventory_adjustments" CASCADE;
DROP TABLE IF EXISTS "inventory_reservations" CASCADE;
DROP TABLE IF EXISTS "inventory_receipt_documents" CASCADE;
DROP TABLE IF EXISTS "inventory_receipt_items" CASCADE;
DROP TABLE IF EXISTS "inventory_receipts" CASCADE;
DROP TABLE IF EXISTS "inventory_stock_balances" CASCADE;
DROP TABLE IF EXISTS "inventory_item_variants" CASCADE;
DROP TABLE IF EXISTS "inventory_items" CASCADE;
DROP TABLE IF EXISTS "inventory_locations" CASCADE;
DROP TABLE IF EXISTS "inventory_warehouses" CASCADE;
DROP TABLE IF EXISTS "inventory_inventory_policies" CASCADE;
DROP TABLE IF EXISTS "inventory_approval_links" CASCADE;

-- Procurement
DROP TABLE IF EXISTS "procurement_approval_links" CASCADE;
DROP TABLE IF EXISTS "procurement_procurement_policies" CASCADE;
DROP TABLE IF EXISTS "procurement_po_items" CASCADE;
DROP TABLE IF EXISTS "procurement_purchase_orders" CASCADE;
DROP TABLE IF EXISTS "procurement_rfq_responses" CASCADE;
DROP TABLE IF EXISTS "procurement_rfq" CASCADE;
DROP TABLE IF EXISTS "procurement_request_items" CASCADE;
DROP TABLE IF EXISTS "procurement_purchase_requests" CASCADE;
DROP TABLE IF EXISTS "procurement_vendor_documents" CASCADE;
DROP TABLE IF EXISTS "procurement_vendor_contacts" CASCADE;
DROP TABLE IF EXISTS "procurement_vendors" CASCADE;

-- Finance / GL
DROP TABLE IF EXISTS "finance_reversal_plans" CASCADE;
DROP TABLE IF EXISTS "finance_exceptions" CASCADE;
DROP TABLE IF EXISTS "finance_audit_logs" CASCADE;
DROP TABLE IF EXISTS "finance_journal_entries" CASCADE;
DROP TABLE IF EXISTS "finance_posting_batches" CASCADE;
DROP TABLE IF EXISTS "finance_locks" CASCADE;
DROP TABLE IF EXISTS "finance_account_mappings" CASCADE;
DROP TABLE IF EXISTS "finance_dimension_values" CASCADE;
DROP TABLE IF EXISTS "finance_dimensions" CASCADE;
DROP TABLE IF EXISTS "finance_cost_centers" CASCADE;
DROP TABLE IF EXISTS "finance_journals" CASCADE;
DROP TABLE IF EXISTS "finance_chart_of_accounts" CASCADE;
DROP TABLE IF EXISTS "finance_periods" CASCADE;
DROP TABLE IF EXISTS "finance_fiscal_years" CASCADE;
DROP TABLE IF EXISTS "finance_workspace_settings" CASCADE;

-- Module catalog cleanup (ERP keys removed from HCM platform)
DELETE FROM "workspace_module_settings" WHERE "module_key" IN ('finance', 'procurement', 'inventory', 'billing');
DELETE FROM "platform_modules" WHERE "key" IN ('finance', 'procurement', 'inventory', 'billing');
