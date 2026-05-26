-- F9.2 — Composite indexes for common list/inbox filters (additive)

CREATE INDEX IF NOT EXISTS "idx_leave_requests_ws_status"
  ON "leave_requests" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "idx_employees_ws_status"
  ON "employees" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "idx_tickets_ws_status"
  ON "tickets" ("workspace_id", "status");

CREATE INDEX IF NOT EXISTS "idx_event_outbox_ws_status"
  ON "event_outbox" ("workspace_id", "status", "created_at" DESC);
