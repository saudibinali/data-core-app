-- P-HCM2: Workspace-driven leave runtime mode (Employee Central–style phased cutover)

ALTER TABLE "hr_workspace_settings"
  ADD COLUMN IF NOT EXISTS "leave_runtime_mode" text NOT NULL DEFAULT 'transition';

COMMENT ON COLUMN "hr_workspace_settings"."leave_runtime_mode" IS 'legacy | transition | canonical — controls canonical leave path vs legacy freeze';
