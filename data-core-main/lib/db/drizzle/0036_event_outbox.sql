-- F7.2 — Transactional event outbox (additive, drain optional via EVENT_OUTBOX_DRAIN)

CREATE TABLE IF NOT EXISTS "event_outbox" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "module" text NOT NULL,
  "payload" jsonb NOT NULL,
  "idempotency_key" text,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "next_retry_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_event_outbox_ws_idem"
  ON "event_outbox" ("workspace_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL AND "status" IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS "idx_event_outbox_pending"
  ON "event_outbox" ("status", "next_retry_at", "created_at")
  WHERE "status" IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS "idx_event_outbox_workspace"
  ON "event_outbox" ("workspace_id", "created_at" DESC);
