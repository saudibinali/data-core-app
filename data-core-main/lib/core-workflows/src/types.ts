/**
 * @package @workspace/core-workflows
 * @purpose  Shared contracts for the platform automation / workflow engine.
 *
 * Workflows listen for events and execute a sequence of steps automatically.
 * This package owns the structural types (trigger, step, execution record)
 * that are shared between the engine (api-server) and the UI builder (ops-platform).
 *
 * Ownership:  Platform Core — the engine implementation lives in
 *             artifacts/api-server/src/lib/workflows/ and consumes these types.
 * Future:     Add parallel branching, sub-workflows, retry/backoff policies,
 *             and a visual graph representation for the UI builder.
 *
 * Note on primitives: BaseEvent re-declared minimally for package independence.
 * Future: import from @workspace/core-events once proper project references are added.
 */

// ── Minimal event reference (re-declared for package independence) ────────────

/**
 * WorkflowEventRef — a minimal copy of the event envelope used in execution records.
 * Intentionally narrower than BaseEvent to avoid cross-package coupling at this stage.
 */
export interface WorkflowEventRef {
  type: string;
  module: string;
  workspaceId: number;
  triggeredBy?: number;
  data: Record<string, unknown>;
  timestamp?: string;
}

// ── Step types ────────────────────────────────────────────────────────────────

/**
 * WorkflowStepType — all automation actions the engine can perform.
 * Adding a new step type requires a corresponding executor in the api-server.
 */
export type WorkflowStepType =
  | "notification"
  | "approval"
  | "task"
  | "condition"
  | "status_update"
  | "assignment"
  | "delay";

// ── Trigger ───────────────────────────────────────────────────────────────────

/**
 * WorkflowTrigger — declares which event activates a workflow.
 *
 * `conditions` are optional filters evaluated against the event payload
 * before the workflow runs. An empty array means "always trigger".
 */
export interface WorkflowTrigger {
  /** Matches the event type, e.g. "ticket.created". */
  eventType: string;

  /** Optional field-level conditions that must ALL be true. */
  conditions: WorkflowTriggerCondition[];
}

/**
 * WorkflowTriggerCondition — a single filter predicate on the event payload.
 */
export interface WorkflowTriggerCondition {
  /** Dot-path into the event payload, e.g. "data.priority". */
  field: string;
  operator:
    | "eq" | "neq"
    | "gt" | "lt" | "gte" | "lte"
    | "contains" | "not_contains"
    | "in" | "not_in"
    | "exists" | "not_exists";
  value?: unknown;
}

// ── Step definition ───────────────────────────────────────────────────────────

/**
 * WorkflowStep — one automation action within a workflow definition.
 *
 * `config` is intentionally typed as `Record<string, unknown>` here.
 * Each step executor in the api-server narrows it to a typed shape.
 */
export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  label?: string;
  /** Step-specific configuration. Schema varies by type. */
  config: Record<string, unknown>;
  /** IDs of steps that must complete before this one runs. */
  dependsOn?: string[];
}

// ── Workflow definition ───────────────────────────────────────────────────────

/**
 * WorkflowDefinition — the full, persisted workflow configuration.
 */
export interface WorkflowDefinition {
  id: number;
  workspaceId: number;
  name: string;
  description?: string;
  isActive: boolean;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

// ── Execution record ──────────────────────────────────────────────────────────

/**
 * WorkflowExecutionStatus — lifecycle states of a single workflow run.
 */
export type WorkflowExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * WorkflowExecution — a record of one workflow run, created per matching event.
 *
 * Future: store step-level execution logs for debugging and retries.
 */
export interface WorkflowExecution {
  id: number;
  workflowId: number;
  /** The event that triggered this execution. */
  triggerEvent: WorkflowEventRef;
  status: WorkflowExecutionStatus;
  /** Step ID that failed, if status is "failed". */
  failedAtStep?: string;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}
