/**
 * @file        workflows/validator.ts
 * @purpose     Workflow governance validator - Phase 3 (P3-A) + Phase 5-D (P5-D).
 *
 * ── Why validation exists ─────────────────────────────────────────────────────
 *   The No-Code Workflow Platform allows workspace admins to configure arbitrary
 *   step sequences.  Several step types have known implementation gaps identified
 *   in the architecture review (workflow-governance-architecture-review.txt).
 *
 *   Publishing a workflow that contains broken step types causes SILENT runtime
 *   failures - no error is thrown, users see no feedback, and automation goals
 *   are never achieved.  The validator gates publication at the API level so
 *   these gaps surface before they affect production executions.
 *
 * ── Two-layer validation model (P5-D) ────────────────────────────────────────
 *
 *   Layer 1 - Per-step checks (this file, validateWorkflow loop):
 *     Hard governance rules that produce ERRORS (block activation):
 *       WG-02  approval step (resume not implemented)
 *       WG-04  delay step (no scheduler)
 *       WG-03  condition routing (self-loop, backward, target not found)
 *       WG-12  round_robin assignment (not implemented)
 *     Soft rules that produce WARNINGS (allow with acknowledgment):
 *       unknown step types, unresolved recipient types, missing content.
 *
 *   Layer 2 - Validation Engine (P5-D, runValidationEngine):
 *     Structural governance analysis across 4 independent passes:
 *       Topology      - unreachable steps, non-converging branches
 *       Dependency    - conditionally-executed steps (output context risk)
 *       Fanout        - notification amplification, path count, step count
 *       Routing Safety - long jumps, convergent branches, nested conditions
 *     All engine findings are WARNINGS or NOTICES - never errors.
 *     NOTICEs are informational only.  WARNINGS allow activation but appear
 *     in the validation response for admin review.
 *
 * ── Warnings vs Errors ────────────────────────────────────────────────────────
 *   Errors:   Block activation.  Must be resolved before publish.
 *   Warnings: Allow activation with admin acknowledgment.  Surface in UI.
 *   Notices:  Informational only.  Never block anything.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   Called by:
 *     POST /api/workflows/:id/validate  - explicit validation request
 *     POST /api/workflows/:id/activate  - internally before activation
 */

import {
  runValidationEngine,
  type GovernanceNotice,
  type EstimatedExecutionMetrics,
} from "./validation-engine";

// Re-export engine types so callers only need to import from this file.
export type { GovernanceNotice, EstimatedExecutionMetrics };

// ── Result types ──────────────────────────────────────────────────────────────

export interface ValidationError {
  /** Machine-readable error code. Format: "<WG-REF>_<DESCRIPTION>" */
  code: string;
  /** Human-readable explanation suitable for display in the admin UI. */
  message: string;
  stepIndex?: number;
  stepName?: string;
  stepType?: string;
}

export interface ValidationWarning {
  /** Machine-readable warning code. */
  code: string;
  /** Human-readable explanation for the admin. */
  message: string;
  stepIndex?: number;
  stepName?: string;
  stepType?: string;
}

export interface ValidationResult {
  /** true if no errors found; false if at least one error blocks activation. */
  valid: boolean;
  /** Errors that BLOCK activation - must be resolved before publish. */
  errors: ValidationError[];
  /** Warnings that ALLOW activation - surface for admin review. */
  warnings: ValidationWarning[];
  /**
   * P5-D: Informational notices - never block activation.
   * Surface for workflow author education and observability.
   */
  notices: GovernanceNotice[];
  /**
   * P5-D: Deterministic worst-case execution metrics from the engine.
   * Includes maxExecutedSteps, maxNotificationCount, branchingPaths, etc.
   */
  estimatedMetrics: EstimatedExecutionMetrics;
}

// ── Known step types ──────────────────────────────────────────────────────────

const KNOWN_STEP_TYPES = new Set([
  "notification",
  "task",
  "approval",
  "condition",
  "status_update",
  "assignment",
  "delay",
]);

// ── Main validator ────────────────────────────────────────────────────────────

/**
 * validateWorkflow - run all governance checks on a workflow definition.
 *
 * Orchestrates two validation layers:
 *   1. Per-step checks (this function) - hard errors + basic warnings.
 *   2. Validation engine (P5-D) - topology, dependency, fanout, routing safety.
 *
 * @param steps        The steps array from workflow_definitions.steps (JSONB).
 * @param triggerEvent The triggerEvent string from workflow_definitions.
 * @returns            ValidationResult with errors (block), warnings (allow),
 *                     notices (inform), and estimatedMetrics (fanout data).
 */
export function validateWorkflow(
  steps: unknown,
  triggerEvent: string,
): ValidationResult {
  const errors:   ValidationError[]   = [];
  const warnings: ValidationWarning[] = [];

  // ── Global checks ────────────────────────────────────────────────────────────

  if (!triggerEvent || typeof triggerEvent !== "string" || triggerEvent.trim() === "") {
    errors.push({
      code: "MISSING_TRIGGER_EVENT",
      message: "Workflow must have a trigger event.",
    });
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push({
      code: "EMPTY_STEPS",
      message: "Workflow must contain at least one step.",
    });
    return {
      valid: false, errors, warnings,
      notices: [], estimatedMetrics: emptyMetrics(),
    };
  }

  // ── Pre-pass: collect all step indices ───────────────────────────────────────
  //
  // Required by the P5-C condition routing validator (WG-03 checks) so it can
  // verify that onTrueStepIndex / onFalseStepIndex reference existing steps.
  // Built once before the per-step loop to avoid O(n²) linear scans.
  const allStepIndices = new Set<number>();
  for (const rawStep of steps) {
    if (typeof rawStep === "object" && rawStep !== null) {
      const s = rawStep as Record<string, unknown>;
      if (typeof s["index"] === "number") {
        allStepIndices.add(s["index"] as number);
      }
    }
  }

  // ── Per-step checks ───────────────────────────────────────────────────────────

  for (const rawStep of steps) {
    if (typeof rawStep !== "object" || rawStep === null) {
      warnings.push({
        code: "INVALID_STEP_SHAPE",
        message: "A step entry is not an object and will be skipped at runtime.",
      });
      continue;
    }

    const step = rawStep as Record<string, unknown>;
    const stepType = typeof step["type"] === "string" ? step["type"] : undefined;
    const stepName = typeof step["name"] === "string" ? step["name"] : `step[${String(step["index"] ?? "?")}]`;
    const stepIndex = typeof step["index"] === "number" ? step["index"] : undefined;
    const config   = typeof step["config"] === "object" && step["config"] !== null
      ? (step["config"] as Record<string, unknown>)
      : undefined;

    // ── Unknown step type ─────────────────────────────────────────────────────
    if (stepType && !KNOWN_STEP_TYPES.has(stepType)) {
      warnings.push({
        code: "UNKNOWN_STEP_TYPE",
        message: `Step type "${stepType}" is not recognized. It will be silently skipped at runtime.`,
        stepIndex,
        stepName,
        stepType,
      });
      continue;
    }

    // ── P5-F: Approval step governance (WG-02 LIFTED) ────────────────────────
    //
    // WG-02 is LIFTED as of Phase 5-F.  The full approval lifecycle is now
    // governed:
    //   - resumeExecution() provides guarded waiting_approval → running (P4-E)
    //   - rejectExecution() provides guarded waiting_approval → failed (P4-E)
    //   - Approval records are immutable append-only rows (P5-F)
    //   - Version linkage: workflowVersion is stored on every decision (P5-F)
    //   - Exact-once decision guarantee via P4-D guarded UPDATE
    //
    // Replace the blanket block with specific configuration validation rules.
    // Each rule checks a concrete misconfiguration that would cause a silent
    // skip at runtime (no approvers resolved → step skips with "no_approvers").
    if (stepType === "approval" && config !== undefined) {
      const approverType = config["approverType"];

      // WG-02_APPROVAL_NO_APPROVER_TYPE: approverType is required.
      if (!approverType || typeof approverType !== "string") {
        errors.push({
          code:    "WG-02_APPROVAL_NO_APPROVER_TYPE",
          message: `Approval step is missing "approverType". ` +
            `Must be one of: "specific", "role", "manager". ` +
            `Without a valid approverType, no approvers will be resolved and the step will skip silently.`,
          stepIndex, stepName, stepType,
        });
      } else if (approverType === "specific") {
        // WG-02_APPROVAL_SPECIFIC_NO_IDS: specific type requires approverIds.
        const ids = config["approverIds"];
        if (!Array.isArray(ids) || ids.length === 0) {
          errors.push({
            code:    "WG-02_APPROVAL_SPECIFIC_NO_IDS",
            message: `Approval step uses approverType "specific" but "approverIds" is empty or missing. ` +
              `No approvers will be resolved - the step will skip with reason "no_approvers".`,
            stepIndex, stepName, stepType,
          });
        }
      } else if (approverType === "role") {
        // WG-02_APPROVAL_ROLE_NO_ROLE: role type requires approverRole.
        const role = config["approverRole"];
        if (!role || typeof role !== "string") {
          errors.push({
            code:    "WG-02_APPROVAL_ROLE_NO_ROLE",
            message: `Approval step uses approverType "role" but "approverRole" is missing or empty. ` +
              `No approvers will be resolved - the step will skip with reason "no_approvers".`,
            stepIndex, stepName, stepType,
          });
        }
      }
      // approverType="manager" requires no extra config - it resolves the
      // triggered user's line manager at runtime.  If no manager is found,
      // the step skips gracefully (not a publish-time error).

      // WG-02_APPROVAL_MISSING_TITLE: title/message are required for notifications.
      if (!config["title"] || typeof config["title"] !== "string") {
        errors.push({
          code:    "WG-02_APPROVAL_MISSING_TITLE",
          message: `Approval step is missing "title". ` +
            `The approval notification sent to approvers will have no title, making it unactionable.`,
          stepIndex, stepName, stepType,
        });
      }
      if (!config["message"] || typeof config["message"] !== "string") {
        warnings.push({
          code:    "WG-02_APPROVAL_MISSING_MESSAGE",
          message: `Approval step is missing "message". ` +
            `Approvers will receive a notification with no body text - consider adding a clear description.`,
          stepIndex, stepName, stepType,
        });
      }
    } else if (stepType === "approval" && config === undefined) {
      errors.push({
        code:    "WG-02_APPROVAL_NO_CONFIG",
        message: `Approval step has no configuration object. ` +
          `An approval step requires at minimum approverType, approverIds/approverRole, and title.`,
        stepIndex, stepName, stepType,
      });
    }

    // ── P6-A: Delay step validation (WG-04 LIFTED) ───────────────────────────
    //
    // WG-04_DELAY_BLOCKED is LIFTED as of Phase 6-A.  The full delay scheduling
    // lifecycle is now governed:
    //   - executeDelayStep() computes wakeAt and returns waitForDelay=true
    //   - Executor: guarded running→waiting_delay transition (P4-D model)
    //   - Scheduler: polls DB for waiting_delay + wakeAt<=now(), guarded acquisition
    //   - resumeDelayedExecution(): cancelRequested/TTL pre-checks + guarded
    //     waiting_delay→running + re-enters runStepLoop from scheduledStepIndex
    //   - Restart safety: wakeAt persisted in DB, no in-memory timer dependency
    //
    // Replace the blanket block with specific configuration validation rules.
    // Each rule catches a concrete misconfiguration that would cause incorrect
    // delay semantics at runtime.
    if (stepType === "delay") {
      const delayCfg = config as Record<string, unknown> | undefined;

      if (delayCfg === undefined) {
        errors.push({
          code:    "WG-04_DELAY_NO_CONFIG",
          message: `Delay step has no configuration object. ` +
            `Must specify exactly one of "delayForMinutes" or "delayUntilTimestamp".`,
          stepIndex, stepName, stepType,
        });
      } else {
        const hasMinutes   = delayCfg["delayForMinutes"]    !== undefined;
        const hasTimestamp = delayCfg["delayUntilTimestamp"] !== undefined;

        // WG-04_DELAY_NO_DURATION: at least one must be specified.
        if (!hasMinutes && !hasTimestamp) {
          errors.push({
            code:    "WG-04_DELAY_NO_DURATION",
            message: `Delay step must specify either "delayForMinutes" or "delayUntilTimestamp". ` +
              `Without a duration the delay would be zero and the execution would resume immediately.`,
            stepIndex, stepName, stepType,
          });
        }

        // WG-04_DELAY_AMBIGUOUS: both specified - ambiguous, executor picks neither.
        if (hasMinutes && hasTimestamp) {
          errors.push({
            code:    "WG-04_DELAY_AMBIGUOUS",
            message: `Delay step has both "delayForMinutes" and "delayUntilTimestamp". ` +
              `Exactly one must be specified - having both is ambiguous.`,
            stepIndex, stepName, stepType,
          });
        }

        // WG-04_DELAY_NON_POSITIVE_MINUTES: relative delay must be positive.
        if (hasMinutes && !hasTimestamp) {
          const minutes = delayCfg["delayForMinutes"];
          if (typeof minutes !== "number" || !Number.isFinite(minutes)) {
            errors.push({
              code:    "WG-04_DELAY_INVALID_MINUTES",
              message: `Delay step "delayForMinutes" must be a finite number. ` +
                `Got: ${JSON.stringify(minutes)}.`,
              stepIndex, stepName, stepType,
            });
          } else if (minutes <= 0) {
            errors.push({
              code:    "WG-04_DELAY_NON_POSITIVE_MINUTES",
              message: `Delay step "delayForMinutes" must be greater than zero. ` +
                `A zero or negative delay makes the step a no-op. Got: ${minutes}.`,
              stepIndex, stepName, stepType,
            });
          } else if (minutes > 43_200) {
            // WG-04_DELAY_EXCESSIVE_MINUTES: cap at 30 days.
            errors.push({
              code:    "WG-04_DELAY_EXCESSIVE_MINUTES",
              message: `Delay step "delayForMinutes" (${minutes}) exceeds the maximum allowed ` +
                `delay of 43 200 minutes (30 days). ` +
                `Workflows that span months should be modelled as separate triggered workflows.`,
              stepIndex, stepName, stepType,
            });
          }
        }

        // WG-04_DELAY_INVALID_TIMESTAMP: must be a parseable ISO 8601 string.
        if (hasTimestamp && !hasMinutes) {
          const ts = delayCfg["delayUntilTimestamp"];
          if (typeof ts !== "string") {
            errors.push({
              code:    "WG-04_DELAY_INVALID_TIMESTAMP",
              message: `Delay step "delayUntilTimestamp" must be an ISO 8601 string. ` +
                `Got: ${JSON.stringify(ts)}.`,
              stepIndex, stepName, stepType,
            });
          } else {
            const dt = new Date(ts);
            if (isNaN(dt.getTime())) {
              errors.push({
                code:    "WG-04_DELAY_INVALID_TIMESTAMP",
                message: `Delay step "delayUntilTimestamp" "${ts}" is not a valid ISO 8601 date-time. ` +
                  `Use a format like "2026-06-01T09:00:00Z".`,
                stepIndex, stepName, stepType,
              });
            } else {
              // WG-04_DELAY_PAST_TIMESTAMP: warn (not error) - the timestamp may
              // be valid at the time the workflow fires even if past at publish time.
              const nowValidation = new Date();
              if (dt < nowValidation) {
                warnings.push({
                  code:    "WG-04_DELAY_PAST_TIMESTAMP",
                  message: `Delay step "delayUntilTimestamp" "${ts}" is in the past at publish time. ` +
                    `The delay will resolve immediately when the execution reaches this step. ` +
                    `Consider using "delayForMinutes" for relative delays instead.`,
                  stepIndex, stepName, stepType,
                });
              }
              // WG-04_DELAY_EXCESSIVE_TIMESTAMP: warn if more than 30 days out.
              const maxFutureMs = 43_200 * 60_000;
              if (dt.getTime() - nowValidation.getTime() > maxFutureMs) {
                warnings.push({
                  code:    "WG-04_DELAY_EXCESSIVE_TIMESTAMP",
                  message: `Delay step "delayUntilTimestamp" "${ts}" is more than 30 days in the future. ` +
                    `Very long waits risk execution TTL expiry before the delay completes.`,
                  stepIndex, stepName, stepType,
                });
              }
            }
          }
        }
      }
    }

    // ── P5-C: Condition step routing validation (replaces WG-03 block) ────────
    //
    // WG-03 is LIFTED as of Phase 5-C.  The executor now supports deterministic
    // forward-only branching via a cursor-based loop (see executor.ts P5-C).
    //
    // Routing rules enforced here (mirrors resolveNextCursor safety contract):
    //   R-01  onTrueStepIndex / onFalseStepIndex must reference a step that
    //         exists in the workflow (by step.index value).
    //   R-02  Routing targets must be strictly forward: target > step.index.
    //         Backward jumps and self-loops would create infinite loops at runtime.
    //   R-03  null targets are valid: null means "no routing for this branch;
    //         executor falls through linearly".
    //   R-04  Targets must be integers (not floats, not negative).
    if (stepType === "condition" && config !== undefined && stepIndex !== undefined) {
      const onTrue  = config["onTrueStepIndex"];
      const onFalse = config["onFalseStepIndex"];

      // Validate onTrueStepIndex
      if (onTrue !== null && onTrue !== undefined) {
        if (typeof onTrue !== "number" || !Number.isInteger(onTrue) || onTrue < 0) {
          errors.push({
            code:    "WG-03_INVALID_TRUE_ROUTE",
            message: `Condition step "onTrueStepIndex" must be a non-negative integer or null. Got: ${JSON.stringify(onTrue)}.`,
            stepIndex, stepName, stepType,
          });
        } else if (onTrue === stepIndex) {
          errors.push({
            code:    "WG-03_TRUE_ROUTE_SELF_LOOP",
            message: `Condition step "onTrueStepIndex" (${onTrue}) points to the step itself. Self-loops are not permitted - they would cause an infinite loop at runtime.`,
            stepIndex, stepName, stepType,
          });
        } else if (onTrue < stepIndex) {
          errors.push({
            code:    "WG-03_TRUE_ROUTE_BACKWARD",
            message: `Condition step "onTrueStepIndex" (${onTrue}) points backward to a step with a lower index (${stepIndex}). Only forward routing is permitted to prevent infinite loops.`,
            stepIndex, stepName, stepType,
          });
        } else if (!allStepIndices.has(onTrue)) {
          errors.push({
            code:    "WG-03_TRUE_ROUTE_NOT_FOUND",
            message: `Condition step "onTrueStepIndex" (${onTrue}) does not match any step index in this workflow. Valid step indices: [${[...allStepIndices].sort((a, b) => a - b).join(", ")}].`,
            stepIndex, stepName, stepType,
          });
        }
      }

      // Validate onFalseStepIndex
      if (onFalse !== null && onFalse !== undefined) {
        if (typeof onFalse !== "number" || !Number.isInteger(onFalse) || onFalse < 0) {
          errors.push({
            code:    "WG-03_INVALID_FALSE_ROUTE",
            message: `Condition step "onFalseStepIndex" must be a non-negative integer or null. Got: ${JSON.stringify(onFalse)}.`,
            stepIndex, stepName, stepType,
          });
        } else if (onFalse === stepIndex) {
          errors.push({
            code:    "WG-03_FALSE_ROUTE_SELF_LOOP",
            message: `Condition step "onFalseStepIndex" (${onFalse}) points to the step itself. Self-loops are not permitted - they would cause an infinite loop at runtime.`,
            stepIndex, stepName, stepType,
          });
        } else if (onFalse < stepIndex) {
          errors.push({
            code:    "WG-03_FALSE_ROUTE_BACKWARD",
            message: `Condition step "onFalseStepIndex" (${onFalse}) points backward to a step with a lower index (${stepIndex}). Only forward routing is permitted to prevent infinite loops.`,
            stepIndex, stepName, stepType,
          });
        } else if (!allStepIndices.has(onFalse)) {
          errors.push({
            code:    "WG-03_FALSE_ROUTE_NOT_FOUND",
            message: `Condition step "onFalseStepIndex" (${onFalse}) does not match any step index in this workflow. Valid step indices: [${[...allStepIndices].sort((a, b) => a - b).join(", ")}].`,
            stepIndex, stepName, stepType,
          });
        }
      }
    }

    // ── BLOCKED: round_robin assignment (WG-12) ───────────────────────────────
    //
    // The "round_robin" assigneeType is declared in the type system but has no
    // resolver implementation.  It silently falls through to null, causing the
    // step to skip with reason "no_assignee_resolved".  Blocked until the
    // round-robin resolver is built.
    if (stepType === "assignment" && config) {
      if (config["assigneeType"] === "round_robin") {
        errors.push({
          code: "WG-12_ROUND_ROBIN_BLOCKED",
          message:
            `Round-robin assignment is not implemented (WG-12). ` +
            `When assigneeType is "round_robin", the assignment step silently skips ` +
            `without assigning anyone.  This option is blocked until the round-robin ` +
            `resolver is built.`,
          stepIndex,
          stepName,
          stepType,
        });
      }
    }

    // ── WARNING: unresolved notification recipient type ────────────────────────
    if (stepType === "notification" && config) {
      const recipientType = config["recipientType"];
      if (recipientType === "department") {
        warnings.push({
          code: "UNRESOLVED_RECIPIENT_TYPE",
          message:
            `Notification step uses recipientType "department" which has no resolver ` +
            `in the current step handler.  Recipients will not be resolved - the step ` +
            `silently skips with reason "no_recipients".`,
          stepIndex,
          stepName,
          stepType,
        });
      }
    }

    // ── WARNING: empty required config fields ─────────────────────────────────
    if (stepType === "notification" && config) {
      if (!config["title"] || !config["message"]) {
        warnings.push({
          code: "MISSING_NOTIFICATION_CONTENT",
          message: "Notification step is missing title or message - notifications will be sent with empty content.",
          stepIndex,
          stepName,
          stepType,
        });
      }
    }

    if (stepType === "task" && config) {
      if (!config["title"]) {
        warnings.push({
          code: "MISSING_TASK_TITLE",
          message: "Task step is missing a title - the created task will have no title.",
          stepIndex,
          stepName,
          stepType,
        });
      }
    }
  }

  // ── Layer 2: Validation Engine (P5-D) ────────────────────────────────────────
  //
  // Runs the 4-pass structural governance analysis AFTER the per-step checks.
  // Engine findings (warnings + notices) are merged into the result.
  // The engine never adds errors - it only enriches the warning/notice/metrics
  // surface of the validation result.
  //
  // Engine warnings are structurally compatible with ValidationWarning
  // (same { code, message, stepIndex?, stepName?, stepType? } shape) so they
  // can be spread directly into the warnings array.
  const engineResult = runValidationEngine(steps as unknown[]);
  warnings.push(...engineResult.warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    notices:          engineResult.notices,
    estimatedMetrics: engineResult.estimatedMetrics,
  };
}

// ── Internal helper ───────────────────────────────────────────────────────────

function emptyMetrics(): EstimatedExecutionMetrics {
  return {
    maxExecutedSteps: 0, maxNotificationCount: 0,
    branchingPaths: 0, conditionStepCount: 0, notificationStepCount: 0,
  };
}
