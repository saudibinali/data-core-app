-- P22-C: Prepare engine metadata & batch lifecycle expansion

ALTER TABLE "finance_posting_batches" ADD COLUMN IF NOT EXISTS "readiness_status" text;
--> statement-breakpoint
ALTER TABLE "finance_posting_batches" ADD COLUMN IF NOT EXISTS "validation_json" text;
--> statement-breakpoint
ALTER TABLE "finance_posting_batches" ADD COLUMN IF NOT EXISTS "reconciliation_json" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_finance_batches_status" ON "finance_posting_batches" ("workspace_id", "status");
