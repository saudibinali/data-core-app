/**
 * @workspace/core-workflows
 *
 * Public surface of the core-workflows package.
 * Export only the types that cross package boundaries.
 * Do NOT export runtime implementations from here.
 */

export type {
  WorkflowStepType,
  WorkflowTrigger,
  WorkflowTriggerCondition,
  WorkflowStep,
  WorkflowDefinition,
  WorkflowExecutionStatus,
  WorkflowExecution,
} from "./types";
