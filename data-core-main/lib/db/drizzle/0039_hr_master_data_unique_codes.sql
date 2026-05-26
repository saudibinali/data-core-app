-- H2 — enforce canonical identity at DB layer
-- Prevent duplicate master data codes within a workspace.
-- Note: Many code columns are nullable; UNIQUE allows multiple NULLs (acceptable until backfill).

-- Org units
CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_org_units_ws_code"
  ON "hr_org_units" ("workspace_id", "code");

-- Job grades
CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_job_grades_ws_code"
  ON "hr_job_grades" ("workspace_id", "code");

-- Job titles
CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_job_titles_ws_code"
  ON "hr_job_titles" ("workspace_id", "code");

-- Work locations
CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_work_locations_ws_code"
  ON "hr_work_locations" ("workspace_id", "code");

-- Positions
CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_positions_ws_code"
  ON "hr_positions" ("workspace_id", "code");

-- Document types
CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_document_types_ws_code"
  ON "hr_document_types" ("workspace_id", "code");

-- Leave policies
CREATE UNIQUE INDEX IF NOT EXISTS "uq_hr_leave_policies_ws_code"
  ON "hr_leave_policies" ("workspace_id", "code");

