import {
  pgTable,
  text,
  serial,
  integer,
  jsonb,
  boolean,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

// ── Workflow Definitions ──────────────────────────────────────────────────────
//
// ── Governance lifecycle (Phase 3 - P3-E, P3-F) ──────────────────────────────
//
// Workflows go through a structured lifecycle to prevent unsafe publishing,
// runtime corruption, and cascading execution history loss.
//
// State machine:
//   draft        → Created or being edited.  Engine skips draft workflows.
//   active       → Validated and live.  Receives trigger events.
//                  IMMUTABLE: PATCH is blocked while status='active'.
//   deprecated   → Disabled by admin.  Engine skips.  Execution history kept.
//   archived     → Soft-deleted.  deletedAt is set.  Engine skips.
//
// Activation flow (POST /workflows/:id/activate):
//   1. Run governance validation (P3-A: unsafe step types → blocked).
//   2. If validation passes → status='active', isActive=true.
//   3. If validation fails → 422 with structured error list.
//
// Why 'active' is the column default:
//   All rows created before Phase 3 had isActive=true.  Defaulting status to
//   'active' ensures existing seeded and user-created workflows continue to
//   trigger without a data migration.  New rows created via POST /workflows
//   are set to 'draft' explicitly by the route handler.
//
// Soft delete (P3-E):
//   DELETE /workflows/:id sets deletedAt=now(), status='archived', isActive=false.
//   Hard delete is intentionally not allowed - execution history is audit data.
//   Engine and list endpoints filter: WHERE deleted_at IS NULL.
//
// isActive column:
//   Kept for backward compatibility with API clients and the datasources route.
//   Always synced with status: status='active' ↔ isActive=true.
//   The engine is authoritative on status; isActive is a display convenience.
//
// ── Immutable Publish Governance (P5-E) ──────────────────────────────────────
//
// POST /workflows/:id/activate is now the "publish" operation.  Every activation
// writes an immutable row to workflow_definition_versions and increments the
// version counter on this table.
//
// version column:
//   Monotonically increasing integer per definition, starting at 0 (not yet
//   published).  First publish → version=1.  Every subsequent publish increments.
//   Assigned atomically inside the activation transaction.
//
// currentVersionId column:
//   Plain integer (no FK, to avoid circular reference with versions table).
//   Points to the active workflow_definition_versions row.
//   Set at activation time, cleared (NULL) at deprecation time.
//   Application layer enforces the invariant:
//     status='active' ↔ currentVersionId IS NOT NULL
//     status!='active' ↔ currentVersionId IS NULL
//
// publishedAt / publishedBy columns:
//   Denormalized convenience copies from the current version row.
//   Set at activation, kept as-is after deprecation (record of last publish).
//   Authoritative publish metadata lives in workflow_definition_versions.

export const workflowDefinitionsTable = pgTable(
  "workflow_definitions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    description: text("description"),
    descriptionAr: text("description_ar"),
    module: text("module").notNull(),
    triggerEvent: text("trigger_event").notNull(),
    conditions: jsonb("conditions").notNull().default("[]"),
    steps: jsonb("steps").notNull().default("[]"),
    isActive: boolean("is_active").notNull().default(true),

    // ── Governance lifecycle status ──────────────────────────────────────────
    // Values: 'draft' | 'active' | 'deprecated' | 'archived'
    // Default 'active' preserves backward compat for pre-Phase-3 rows.
    status: text("status").notNull().default("active"),

    // ── P5-E: Publish version counter ────────────────────────────────────────
    // Monotonically increasing integer, incremented by each activation.
    // 0 = never published (draft, or pre-P5-E row that was never re-activated).
    // 1 = first publish, 2 = second publish, etc.
    // Combined with workflow_definition_versions for full version history.
    version: integer("version").notNull().default(0),

    // ── P5-E: Active version pointer ─────────────────────────────────────────
    // ID of the currently active workflow_definition_versions row.
    // NULL = no active version (draft, deprecated, or archived).
    // Plain integer (no FK) to avoid circular reference with the versions table.
    // Invariant enforced at application layer.
    currentVersionId: integer("current_version_id"),

    // ── P5-E: Last publish attribution (denormalized) ─────────────────────────
    // Convenience copies of the last activation's metadata.
    // Authoritative record lives in workflow_definition_versions.
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: integer("published_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    // ── Soft delete timestamp ────────────────────────────────────────────────
    // Set by DELETE /workflows/:id.  NULL = not deleted.
    // Engine filters: WHERE deleted_at IS NULL.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    // ── Archive timestamp ────────────────────────────────────────────────────
    // Set whenever status transitions to 'archived'.
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    createdBy: integer("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_wf_def_workspace").on(t.workspaceId),
    index("idx_wf_def_trigger").on(t.triggerEvent),
    index("idx_wf_def_key").on(t.workspaceId, t.key),
    // Engine query: find active, non-deleted workflows by workspace + status
    index("idx_wf_def_status").on(t.workspaceId, t.status),
  ],
);

// ── Workflow Definition Versions ──────────────────────────────────────────────
//
// P5-E: Immutable Publish Governance - Version History
//
// CORE INVARIANT:
//   Every activation of a workflow writes exactly ONE immutable row here.
//   This row is the permanent audit record of "what was deployed at this moment."
//   Rows are NEVER updated after INSERT (except for the additive deactivatedAt /
//   deactivatedBy columns which are set when the workflow is deprecated).
//
// Row lifecycle:
//   INSERT:  POST /workflows/:id/activate - one row per activation.
//   UPDATE:  PATCH /workflows/:id { status: 'deprecated' } - sets deactivatedAt.
//   DELETE:  NEVER.  ON DELETE RESTRICT from workflow_definitions prevents deletion
//            as long as version rows exist.  Soft-delete (archived) is the only
//            available path for hiding a workflow from list views.
//
// Immutability guarantees:
//   ① published_by, published_at, version, steps, conditions, trigger_event,
//     name, name_ar, change_notes are frozen at INSERT time - never updated.
//   ② deactivated_at and deactivated_by are the ONLY additive columns:
//     they start NULL and are set exactly once when the workflow is deprecated.
//   ③ ON DELETE RESTRICT on definition_id: a definition cannot be hard-deleted
//     if version rows exist.  Archived (soft-delete) is always available instead.
//
// Version numbering:
//   Monotonically increasing integer per definition, starting at 1.
//   First publish = 1, second = 2, etc.
//   UNIQUE(definition_id, version) enforces no duplicate version numbers.
//
// Active version invariant:
//   When status='active':  exactly one row for this definition has deactivatedAt IS NULL.
//   When status!='active': zero rows have deactivatedAt IS NULL.
//
// Execution linkage:
//   workflow_executions.workflow_version (integer, denormalized) = version number.
//   Combined with steps_snapshot (P5-A), provides full execution lineage.

export const workflowDefinitionVersionsTable = pgTable(
  "workflow_definition_versions",
  {
    id: serial("id").primaryKey(),

    // ── Parent definition ────────────────────────────────────────────────────
    // ON DELETE RESTRICT: definition cannot be hard-deleted while version rows exist.
    // This is the most important FK decision: version rows are permanent audit records.
    definitionId: integer("definition_id")
      .notNull()
      .references(() => workflowDefinitionsTable.id, { onDelete: "restrict" }),

    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    // ── Monotonically increasing version number per definition ───────────────
    // First publish of a definition = version 1.
    // Each activation increments by 1 (not related to semantic versioning).
    // UNIQUE(definition_id, version) enforced by the constraint below.
    version: integer("version").notNull(),

    // ── Immutable snapshot of the full definition at publish time ────────────
    // These columns are NEVER updated after INSERT.
    steps: jsonb("steps").notNull(),
    conditions: jsonb("conditions").notNull(),
    triggerEvent: text("trigger_event").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),

    // ── Publish attribution ──────────────────────────────────────────────────
    // SET NULL on user delete - record preserved without actor identity.
    publishedBy: integer("published_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // ── Optional governance metadata ─────────────────────────────────────────
    // Admin-provided description of what changed in this version.
    // NULL is acceptable - not all teams document publish reasons.
    changeNotes: text("change_notes"),

    // ── Deactivation record ──────────────────────────────────────────────────
    // Set when this version was superseded by a newer activation
    // or when the workflow was deprecated.
    // NULL = this is the currently active version (or the workflow is deprecated
    //        and this was the last active version).
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivatedBy: integer("deactivated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    // ── Validation summary snapshot ──────────────────────────────────────────
    // Serialised governance validation result captured at publish time.
    // Stored as JSONB for forward compatibility (new warning codes added later
    // can be read from the stored summary without re-running validation).
    validationSummary: jsonb("validation_summary"),
  },
  (t) => [
    // Enforce monotonic version numbers per definition.
    unique("uq_wf_version_def_ver").on(t.definitionId, t.version),
    // Compliance audit: "all publishes in workspace W between dates A and B."
    index("idx_wf_ver_workspace_published").on(t.workspaceId, t.publishedAt),
    // Active version lookup: WHERE definition_id=N AND deactivated_at IS NULL.
    index("idx_wf_ver_def_deactivated").on(t.definitionId, t.deactivatedAt),
    // Governance audit: who published what.
    index("idx_wf_ver_published_by").on(t.publishedBy),
  ],
);

// ── Workflow Executions ───────────────────────────────────────────────────────

export const workflowExecutionsTable = pgTable(
  "workflow_executions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    workflowId: integer("workflow_id")
      .notNull()
      .references(() => workflowDefinitionsTable.id, { onDelete: "cascade" }),
    triggerEventLogId: integer("trigger_event_log_id"),
    triggeredBy: integer("triggered_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending"),
    currentStepIndex: integer("current_step_index").notNull().default(0),
    context: jsonb("context").notNull().default("{}"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    // ── P4-B: Lazy TTL ────────────────────────────────────────────────────────
    //
    // The absolute deadline for this execution.  Set at execution creation time:
    //   timeoutAt = now() + DEFAULT_EXECUTION_TTL_HOURS
    //
    // The engine checks this value at every inter-step boundary (between steps,
    // never mid-step) and transitions the execution to status='timed_out' if
    // the deadline has passed.
    //
    // NULL = no deadline.  Applies to:
    //   • Legacy rows created before P4-B was deployed (backward compatible).
    //   • Any future execution intentionally created without a TTL.
    // The executor treats NULL as "never time out" - these rows are safe.
    //
    // Stuck detection: GET /workflows/executions/stuck finds all rows where
    //   status IN ('running', 'waiting_approval') AND timeout_at < now()
    //
    // Why no DB-level CHECK constraint?
    //   timeout_at is a soft deadline enforced at the application layer.
    //   DB constraints are reserved for invariants that must hold transactionally.
    //   Application-level enforcement keeps the schema flexible for future
    //   TTL extension logic (e.g., step-level overrides in Phase 5).
    timeoutAt: timestamp("timeout_at", { withTimezone: true }),

    // ── P4-C: Cooperative Cancellation ───────────────────────────────────────
    //
    // Flag set by POST /workflows/executions/:id/cancel.
    // The executor reads this at every inter-step boundary (after the TTL check).
    // If true, the execution transitions to status='cancelled' before the next
    // step is started.
    //
    // Design: flag-based, not direct status mutation.
    //   • The route handler sets cancel_requested = true WITHOUT changing status.
    //   • The executor is the ONLY component that transitions status → 'cancelled'.
    //   • This preserves the invariant: "running steps always complete first."
    //   • The route handler responds immediately (no waiting for the step to finish).
    //
    // Why not just set status='cancelled' directly from the route?
    //   If a step is currently executing and the route sets status='cancelled',
    //   the executor's final step-cleanup UPDATE would overwrite it with 'running'
    //   (or 'completed' after the loop). The flag model prevents this race.
    //   P4-D will add WHERE status='running' guards to the terminal UPDATEs;
    //   until then, the flag model provides a clean separation of concerns.
    //
    // Backward compatibility: DEFAULT FALSE - all existing rows behave as before.
    cancelRequested: boolean("cancel_requested").notNull().default(false),

    // ── P5-A: Immutable Execution Steps Snapshot ──────────────────────────────
    //
    // WHY DEFINITION DRIFT IS CATASTROPHIC:
    //   resumeExecution() re-enters the step loop after an approval pause.
    //   Without a snapshot, it reads the live workflow_definitions.steps at
    //   resume time.  If an admin edited the workflow between the approval pause
    //   and the resume, the resumed execution runs from a DIFFERENT step
    //   configuration than what originally triggered it - silently.
    //
    //   Example: workflow had steps [notify(0), approve(1), send_email(2)].
    //   Admin edits it to [notify(0), approve(1), delete_record(2)] while paused.
    //   Without snapshot: resume executes delete_record - wrong, destructive.
    //   With snapshot: resume uses the original send_email - correct, safe.
    //
    // WHY STORED PER EXECUTION (NOT PER DEFINITION):
    //   Each execution must be independent of definition changes that occur after
    //   the execution was triggered.  Storing the snapshot in the execution record
    //   gives every execution its own frozen copy that survives definition edits,
    //   deprecations, and even definition deletion (soft-delete).
    //
    // SNAPSHOT IMMUTABILITY BY CONVENTION:
    //   The snapshot is written once at INSERT time and never updated.
    //   No application code should UPDATE steps_snapshot on an existing row.
    //
    // LEGACY COMPATIBILITY (rows created before P5-A):
    //   steps_snapshot = NULL for all pre-P5-A executions.
    //   resumeExecution() treats NULL as "use live definition" (legacy fallback)
    //   and emits a structured warning to surface the potential drift risk.
    //
    // STORAGE IMPACT:
    //   Typical step config: 0.5-5 KB per workflow.
    //   At 1,000 executions/day × 2 KB avg = 2 MB/day overhead.
    //   Negligible compared to workflow_execution_steps.input which stores the
    //   full ExecutionContext per step.
    stepsSnapshot: jsonb("steps_snapshot"),

    // ── P5-A / P5-E: Workflow Version at Trigger Time ─────────────────────────
    //
    // Denormalized version number from workflow_definitions.version at the moment
    // the execution was triggered.  Written by engine.ts at INSERT time.
    //
    // Before P5-E: NULL for all rows (version counter did not exist).
    // After P5-E: set to def.version (the activated version number).
    //
    // Diagnostic use: "this execution ran version N of workflow W."
    // Combined with workflow_definition_versions (JOIN on definitionId + version),
    // provides full publish attribution: who published it, when, and with what notes.
    workflowVersion: integer("workflow_version"),

    // ── P6-A: Delay Scheduling Fields ─────────────────────────────────────────
    //
    // These four columns implement the persisted wake-up model for delay steps.
    // No in-memory timers - the scheduler polls the DB and uses these columns
    // to find and resume delayed executions after their deadline has passed.
    //
    // Lifecycle:
    //   1. Delay step executes → executor sets:
    //        status='waiting_delay', wakeAt=<computed>, waitingReason='delay',
    //        scheduledStepIndex=<cursor+1>
    //   2. Scheduler polls: WHERE status='waiting_delay' AND wake_at <= now()
    //   3. Guarded acquisition: UPDATE SET status='running', resumedAt=now()
    //      WHERE status='waiting_delay'  → exactly-once wake-up
    //   4. resumeDelayedExecution() re-enters runStepLoop from scheduledStepIndex.
    //
    // Restart safety:
    //   On server restart, wakeAt/scheduledStepIndex remain in DB.  The scheduler
    //   picks them up on the next poll cycle - no timer registration needed.
    //
    // NULL semantics:
    //   All four columns are NULL for executions not currently in waiting_delay
    //   state.  They are set atomically when entering waiting_delay and remain
    //   set (non-NULL) as a historical record after the execution resumes.
    //   resumedAt is set only when the scheduler successfully acquires the execution.

    // When to wake up and resume this execution.
    // Computed by executeDelayStep from the step's delayForMinutes or
    // delayUntilTimestamp config.  Persisted immediately in the waiting_delay
    // transition - the scheduler queries this column.
    wakeAt: timestamp("wake_at", { withTimezone: true }),

    // Human-readable reason for the waiting_delay pause.
    // Currently always "delay".  Reserved for future extension (e.g. "timer",
    // "schedule", "throttle") without schema migration.
    waitingReason: text("waiting_reason"),

    // Array cursor position of the FIRST step to run after wake-up.
    // Set to cursor + 1 when the delay step pauses the execution.
    // Mirrors the approval resume model: the delay step itself is NEVER re-run.
    scheduledStepIndex: integer("scheduled_step_index"),

    // When the scheduler successfully acquired this execution and set it running.
    // NULL = not yet resumed (still waiting, or resumed before P6-A deployment).
    // Set atomically by the guarded acquisition UPDATE in resumeDelayedExecution.
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_wf_exec_workspace").on(t.workspaceId),
    index("idx_wf_exec_workflow").on(t.workflowId),
    index("idx_wf_exec_status").on(t.status),
    index("idx_wf_exec_started").on(t.startedAt),
    // Enables: "which workflow executions were triggered by event log row X?"
    // Used by GET /events/:id enrichment (trigger_event_log_id lookup) and
    // GET /workflows/executions/:id (linking back to the triggering event).
    index("idx_wf_exec_trigger").on(t.triggerEventLogId),
    // P4-B: Enables the "stuck executions" query:
    //   WHERE status IN ('running', 'waiting_approval') AND timeout_at < now()
    // Composite index on (status, timeout_at) makes this sub-second at scale.
    index("idx_wf_exec_timeout").on(t.status, t.timeoutAt),
    // P6-A: Enables the scheduler pickup query:
    //   WHERE status='waiting_delay' AND wake_at <= now()
    // Composite on (status, wake_at) ensures the scheduler scan is sub-second.
    index("idx_wf_exec_wake").on(t.status, t.wakeAt),
  ],
);

// ── Workflow Execution Steps ──────────────────────────────────────────────────

export const workflowExecutionStepsTable = pgTable(
  "workflow_execution_steps",
  {
    id: serial("id").primaryKey(),
    executionId: integer("execution_id")
      .notNull()
      .references(() => workflowExecutionsTable.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    stepType: text("step_type").notNull(),
    stepName: text("step_name").notNull(),
    status: text("status").notNull().default("pending"),
    input: jsonb("input").notNull().default("{}"),
    output: jsonb("output"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_wf_step_execution").on(t.executionId),
    index("idx_wf_step_status").on(t.status),
  ],
);

// ── Workflow Tasks ────────────────────────────────────────────────────────────

export const workflowTasksTable = pgTable(
  "workflow_tasks",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    executionId: integer("execution_id")
      .notNull()
      .references(() => workflowExecutionsTable.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    assigneeId: integer("assignee_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_wf_task_workspace").on(t.workspaceId),
    index("idx_wf_task_assignee").on(t.assigneeId),
    index("idx_wf_task_status").on(t.status),
  ],
);

// ── Workflow Approvals ────────────────────────────────────────────────────────
//
// P4-E: Records every approval decision made on a workflow execution that is
// paused at an approval step (status='waiting_approval').
//
// Lifecycle:
//   1. Approval step runs → executor sets status='waiting_approval', returns.
//   2. Authorized user calls POST /executions/:id/approve or /reject.
//   3. Route handler performs the guarded status UPDATE first (P4-D model).
//   4. If the UPDATE wins → this record is inserted (action='approved'/'rejected').
//   5. If action='approved' → resumeExecution() re-enters the step loop.
//   6. If action='rejected' → execution status becomes 'failed'.
//
// One record per (executionId, stepIndex):
//   An execution may have multiple sequential approval steps in the future.
//   stepIndex identifies which step the decision applies to.
//   The route handler checks for an existing record (409 ALREADY_DECIDED)
//   before proceeding - backed by the guarded UPDATE as the true atomicity gate.
//
// decidedBy is SET NULL on user delete - the decision record is preserved for
// audit purposes even if the user who made it is later removed.
//
// Why NOT a column on workflow_executions:
//   A single execution can have multiple approval steps.  A join table allows
//   recording one decision per step per execution, plus full audit metadata
//   (notes, decidedAt, decidedBy) without bloating the execution row.

export const workflowApprovalsTable = pgTable(
  "workflow_approvals",
  {
    id: serial("id").primaryKey(),

    executionId: integer("execution_id")
      .notNull()
      .references(() => workflowExecutionsTable.id, { onDelete: "cascade" }),

    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),

    // P5-F: Direct workflow reference for audit queries without execution join.
    // SET NULL on workflow delete - decision record is preserved for audit trail.
    workflowId: integer("workflow_id").references(
      () => workflowDefinitionsTable.id, { onDelete: "set null" }
    ),

    // P5-F: Published version that was active when the execution was triggered.
    // Copied from workflow_executions.workflow_version at decision time.
    // Enables JOIN to workflow_definition_versions for full version audit.
    // NULL for pre-P5-E executions that never went through the publish pipeline.
    workflowVersion: integer("workflow_version"),

    // Step index in the workflow definition where approval was required.
    // Matches workflow_executions.current_step_index at the time of the pause.
    stepIndex: integer("step_index").notNull(),

    // Human-readable name from the workflow step config.
    // Denormalized for audit readability - no definition join needed.
    stepName: text("step_name").notNull(),

    // P5-F: Frozen approval step configuration captured from stepsSnapshot at
    // decision time.  Immutable - the step config that actually governed this
    // approval, even if the workflow was re-published since the execution started.
    stepSnapshot: jsonb("step_snapshot"),

    // 'approved' | 'rejected'
    action: text("action").notNull(),

    // Who made the decision. SET NULL on user delete - record is preserved.
    decidedBy: integer("decided_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    // Optional justification or reason for the decision.
    notes: text("notes"),

    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // P5-F: The execution TTL deadline at decision time.
    // Used to detect approvals made after the TTL deadline passed (edge-case audit).
    // NULL for pre-P5-F approval records.
    executionTimeoutAt: timestamp("execution_timeout_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_wf_approval_execution").on(t.executionId),
    index("idx_wf_approval_workspace").on(t.workspaceId),
    index("idx_wf_approval_decider").on(t.decidedBy),
    index("idx_wf_approval_decided_at").on(t.decidedAt),
    index("idx_wf_approval_workflow").on(t.workflowId),
    index("idx_wf_approval_version").on(t.workflowId, t.workflowVersion),
  ],
);

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkflowDefinition        = typeof workflowDefinitionsTable.$inferSelect;
export type WorkflowDefinitionVersion = typeof workflowDefinitionVersionsTable.$inferSelect;
export type WorkflowExecution         = typeof workflowExecutionsTable.$inferSelect;
export type WorkflowExecutionStep     = typeof workflowExecutionStepsTable.$inferSelect;
export type WorkflowTask              = typeof workflowTasksTable.$inferSelect;
export type WorkflowApproval          = typeof workflowApprovalsTable.$inferSelect;
