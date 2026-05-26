import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

/** H7 — alias mapping for master data codes during import/matching. */
export const hrMasterDataAliasesTable = pgTable(
  "hr_master_data_aliases",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    aliasCode: text("alias_code").notNull(),
    canonicalCode: text("canonical_code").notNull(),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_hr_master_data_alias_ws_type_alias").on(t.workspaceId, t.entityType, t.aliasCode),
    index("idx_hr_master_data_alias_ws_type_canonical").on(t.workspaceId, t.entityType, t.canonicalCode),
  ],
);

export const hrImportSessionsTable = pgTable(
  "hr_import_sessions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    importType: text("import_type").notNull(),
    status: text("status").notNull().default("draft"),
    templateKey: text("template_key"),
    templateVersion: text("template_version"),
    runtimeMode: text("runtime_mode").notNull().default("legacy"),
    dryRun: boolean("dry_run").notNull().default(true),
    mappingJson: jsonb("mapping_json"),
    revertToken: text("revert_token"),
    sourcePath: text("source_path"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    summary: jsonb("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_import_sessions_ws_status").on(t.workspaceId, t.status, t.createdAt),
    index("idx_hr_import_sessions_type").on(t.importType, t.createdAt),
  ],
);

export const hrImportSessionRowsTable = pgTable(
  "hr_import_session_rows",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => hrImportSessionsTable.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    rawRow: jsonb("raw_row"),
    normalizedRow: jsonb("normalized_row"),
    validationResult: jsonb("validation_result"),
    action: text("action"),
    status: text("status").notNull().default("pending"),
    errors: jsonb("errors"),
    warnings: jsonb("warnings"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_hr_import_session_rows_session_row").on(t.sessionId, t.rowNumber),
    index("idx_hr_import_session_rows_session").on(t.sessionId),
  ],
);

export const hrImportSessionEntitiesTable = pgTable(
  "hr_import_session_entities",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => hrImportSessionsTable.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    canonicalKey: text("canonical_key"),
    action: text("action").notNull().default("resolved"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_hr_import_session_entities_session").on(t.sessionId)],
);

export const hrImportRollbackSnapshotsTable = pgTable(
  "hr_import_rollback_snapshots",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => hrImportSessionsTable.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    action: text("action").notNull(),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_hr_import_rollback_session").on(t.sessionId)],
);

export const hrMasterDataRegistryTable = pgTable(
  "hr_master_data_registry",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    autoCreatePolicy: text("auto_create_policy").notNull().default("off"),
    autoCreateMode: text("auto_create_mode").notNull().default("disabled"),
    approvalRequired: boolean("approval_required").notNull().default(true),
    canonicalStrategy: text("canonical_strategy").notNull().default("slug_from_name"),
    duplicateStrategy: text("duplicate_strategy").notNull().default("reject"),
    reconciliationMode: text("reconciliation_mode").notNull().default("report_only"),
    canonicalKeyField: text("canonical_key_field").notNull().default("code"),
    isRuntimeSensitive: boolean("is_runtime_sensitive").notNull().default(false),
    metadata: jsonb("metadata"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("uq_hr_master_data_registry_ws_entity").on(t.workspaceId, t.entityType)],
);

export const hrImportAutoCreatePendingTable = pgTable(
  "hr_import_auto_create_pending",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").references(() => hrImportSessionsTable.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    proposedCode: text("proposed_code"),
    proposedName: text("proposed_name").notNull(),
    proposedNameAr: text("proposed_name_ar"),
    status: text("status").notNull().default("pending"),
    duplicateKey: text("duplicate_key"),
    policySnapshot: jsonb("policy_snapshot"),
    metadata: jsonb("metadata"),
    requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdEntityId: integer("created_entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_import_auto_create_pending_ws_status").on(t.workspaceId, t.status, t.createdAt),
    index("idx_hr_import_auto_create_pending_session").on(t.sessionId),
  ],
);

export const hrImportPilotWorkspacesTable = pgTable(
  "hr_import_pilot_workspaces",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    pilotStatus: text("pilot_status").notNull().default("inactive"),
    rolloutPhase: text("rollout_phase").notNull().default("phase_5"),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    enabledByUserId: integer("enabled_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("uq_hr_import_pilot_workspaces_ws").on(t.workspaceId)],
);

export const platformEntityRuntimeRegistryTable = pgTable(
  "platform_entity_runtime_registry",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    displayName: text("display_name").notNull(),
    templateKey: text("template_key"),
    validationKey: text("validation_key"),
    importEnabled: boolean("import_enabled").notNull().default(false),
    exportEnabled: boolean("export_enabled").notNull().default(false),
    rolloutReadiness: text("rollout_readiness").notNull().default("future"),
    runtimeCompatibility: jsonb("runtime_compatibility"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("uq_platform_entity_runtime_registry_type").on(t.entityType)],
);

export const hrImportWorkspaceRolloutTable = pgTable(
  "hr_import_workspace_rollout",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    rolloutStatus: text("rollout_status").notNull().default("pending"),
    runtimeModeTarget: text("runtime_mode_target").notNull().default("active"),
    runtimeModePrevious: text("runtime_mode_previous"),
    rolloutSequence: integer("rollout_sequence").notNull().default(0),
    parityScore: numeric("parity_score", { precision: 5, scale: 4 }),
    readinessScore: numeric("readiness_score", { precision: 5, scale: 4 }),
    activationBlockedReason: text("activation_blocked_reason"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    activatedByUserId: integer("activated_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    rollbackByUserId: integer("rollback_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    diagnostics: jsonb("diagnostics"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("uq_hr_import_workspace_rollout_ws").on(t.workspaceId),
    index("idx_hr_import_workspace_rollout_status").on(t.rolloutStatus, t.rolloutSequence),
  ],
);

/** H6 — employee rows held when master data does not match Foundation (match-only import). */
export const hrEmployeeImportStagingTable = pgTable(
  "hr_employee_import_staging",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    batchId: text("batch_id").notNull(),
    rowIndex: integer("row_index").notNull(),
    status: text("status").notNull().default("pending_review"),
    rawRow: jsonb("raw_row"),
    normalizedRow: jsonb("normalized_row").notNull(),
    mismatchFields: jsonb("mismatch_fields").notNull().default([]),
    errors: jsonb("errors").notNull().default([]),
    warnings: jsonb("warnings").notNull().default([]),
    existingEmployeeId: integer("existing_employee_id"),
    promotedEmployeeId: integer("promoted_employee_id"),
    reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_hr_employee_import_staging_ws_status").on(t.workspaceId, t.status, t.createdAt),
    index("idx_hr_employee_import_staging_batch").on(t.workspaceId, t.batchId),
  ],
);

export type HrEmployeeImportStagingRow = typeof hrEmployeeImportStagingTable.$inferSelect;
export type HrMasterDataAlias = typeof hrMasterDataAliasesTable.$inferSelect;

export type HrImportSession = typeof hrImportSessionsTable.$inferSelect;
export type HrImportSessionRow = typeof hrImportSessionRowsTable.$inferSelect;
export type HrMasterDataRegistryEntry = typeof hrMasterDataRegistryTable.$inferSelect;
export type HrImportAutoCreatePending = typeof hrImportAutoCreatePendingTable.$inferSelect;
export type HrImportPilotWorkspace = typeof hrImportPilotWorkspacesTable.$inferSelect;
export type PlatformEntityRuntimeRegistryEntry = typeof platformEntityRuntimeRegistryTable.$inferSelect;
export type HrImportWorkspaceRollout = typeof hrImportWorkspaceRolloutTable.$inferSelect;
