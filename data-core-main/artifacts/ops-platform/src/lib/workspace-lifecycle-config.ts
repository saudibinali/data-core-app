/**
 * @file   lib/workspace-lifecycle-config.ts
 * @phase  P13-B - Workspace Lifecycle Management & Controlled State Transitions
 *
 * Frontend-only lifecycle state machine config.
 * Mirrors the backend pure state machine - no DB, no HTTP calls here.
 *
 * SAFETY CONTRACT:
 *   - All config is "as const" - TypeScript-enforced immutability.
 *   - No delete, hard archive, HR mutation, billing, or payment wording.
 *   - All actions are controlled manual transitions - no automation.
 *   - Every action requires reason AND confirmation before submission.
 *   - Super-admin only - enforced by SuperAdminRoute in App.tsx.
 *   - Exactly one mutation hook name (useWorkspaceLifecycleTransition).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle State Types & Config
// ─────────────────────────────────────────────────────────────────────────────

export type WorkspaceLifecycleState =
  | "pending_activation"
  | "active"
  | "suspended"
  | "locked"
  | "archived";

export type WorkspaceLifecycleAction =
  | "activate"
  | "suspend"
  | "restore"
  | "lock"
  | "archive";

export type LifecycleActionSeverity = "standard" | "warning" | "critical";

/** Display config for each lifecycle state. */
export const LIFECYCLE_STATE_CONFIG = {
  pending_activation: {
    label:       "Pending Activation",
    tier:        "attention",
    description: "Workspace exists but has not been activated.",
    badgeClass:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    order:       0,
  },
  active: {
    label:       "Active",
    tier:        "good",
    description: "Workspace is fully operational.",
    badgeClass:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    order:       1,
  },
  suspended: {
    label:       "Suspended",
    tier:        "critical",
    description: "Workspace access is currently suspended.",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    order:       2,
  },
  locked: {
    label:       "Locked",
    tier:        "critical",
    description: "Workspace is locked pending administrative review.",
    badgeClass:  "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    order:       3,
  },
  archived: {
    label:       "Archived",
    tier:        "muted",
    description: "Workspace has been archived. Data preserved; workspace not operational.",
    badgeClass:  "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    order:       4,
  },
} as const satisfies Record<WorkspaceLifecycleState, {
  label: string; tier: string; description: string; badgeClass: string; order: number;
}>;

// ─────────────────────────────────────────────────────────────────────────────
// Action Config
// ─────────────────────────────────────────────────────────────────────────────

export interface LifecycleActionUiConfig {
  label:                string;
  description:          string;
  confirmationPrompt:   string;
  allowedFrom:          WorkspaceLifecycleState[];
  targetState:          WorkspaceLifecycleState;
  severity:             LifecycleActionSeverity;
  requiresReason:       true;
  requiresConfirmation: true;
  isDestructive:        false;
  buttonClass:          string;
}

/** UI action config for each lifecycle action. */
export const LIFECYCLE_ACTION_CONFIG: Record<WorkspaceLifecycleAction, LifecycleActionUiConfig> = {
  activate: {
    label:                "Activate",
    description:          "Activate this workspace and make it fully operational.",
    confirmationPrompt:   "I confirm I want to activate this workspace.",
    allowedFrom:          ["pending_activation"],
    targetState:          "active",
    severity:             "standard",
    requiresReason:       true,
    requiresConfirmation: true,
    isDestructive:        false,
    buttonClass:          "bg-emerald-600 hover:bg-emerald-700 text-white",
  },
  suspend: {
    label:                "Suspend",
    description:          "Suspend this workspace. Users will be unable to access it until restored.",
    confirmationPrompt:   "I confirm I want to suspend this workspace.",
    allowedFrom:          ["active", "locked", "archived"],
    targetState:          "suspended",
    severity:             "warning",
    requiresReason:       true,
    requiresConfirmation: true,
    isDestructive:        false,
    buttonClass:          "bg-orange-600 hover:bg-orange-700 text-white",
  },
  restore: {
    label:                "Restore",
    description:          "Restore this workspace to active operational status.",
    confirmationPrompt:   "I confirm I want to restore this workspace.",
    allowedFrom:          ["suspended", "locked", "archived"],
    targetState:          "active",
    severity:             "standard",
    requiresReason:       true,
    requiresConfirmation: true,
    isDestructive:        false,
    buttonClass:          "bg-emerald-600 hover:bg-emerald-700 text-white",
  },
  lock: {
    label:                "Lock",
    description:          "Lock this workspace pending administrative review.",
    confirmationPrompt:   "I confirm I want to lock this workspace.",
    allowedFrom:          ["active", "suspended"],
    targetState:          "locked",
    severity:             "warning",
    requiresReason:       true,
    requiresConfirmation: true,
    isDestructive:        false,
    buttonClass:          "bg-amber-600 hover:bg-amber-700 text-white",
  },
  archive: {
    label:                "Archive",
    description:          "Archive this workspace. Data is preserved. This workspace will no longer be operational.",
    confirmationPrompt:   "I confirm I want to archive this workspace.",
    allowedFrom:          ["active", "suspended", "locked"],
    targetState:          "archived",
    severity:             "critical",
    requiresReason:       true,
    requiresConfirmation: true,
    isDestructive:        false,
    buttonClass:          "bg-red-600 hover:bg-red-700 text-white",
  },
} as const;

/** All lifecycle actions in declaration order. */
export const ALL_LIFECYCLE_ACTIONS: WorkspaceLifecycleAction[] = [
  "activate", "suspend", "restore", "lock", "archive",
];

// ─────────────────────────────────────────────────────────────────────────────
// State Derivation (frontend mirror of backend pure function)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the lifecycle state from the workspaces.status value returned by the API.
 * Mirrors lib/workspace-lifecycle.ts:deriveLifecycleState - keep in sync.
 */
export function deriveLifecycleStateFromWorkspaceStatus(
  workspaceStatus: string,
): WorkspaceLifecycleState {
  switch (workspaceStatus) {
    case "active":    return "active";
    case "suspended": return "suspended";
    case "locked":    return "locked";
    case "disabled":  return "archived";
    default:          return "pending_activation";
  }
}

/**
 * Returns all lifecycle actions that are allowed from the given current state.
 * Used to populate the lifecycle controls section in the UI.
 */
export function getAllowedActionsFromState(
  currentState: WorkspaceLifecycleState,
): WorkspaceLifecycleAction[] {
  return ALL_LIFECYCLE_ACTIONS.filter(action =>
    LIFECYCLE_ACTION_CONFIG[action].allowedFrom.includes(currentState),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Form Validation (pure - used for submit-gate in modal)
// ─────────────────────────────────────────────────────────────────────────────

export const REASON_MIN_LENGTH = 10;

export interface LifecycleFormState {
  action:       WorkspaceLifecycleAction | null;
  reason:       string;
  internalNote: string;
  confirmed:    boolean;
}

/**
 * Returns true if the lifecycle action form is in a valid, submittable state.
 * Used to enable/disable the modal Submit button.
 */
export function isLifecycleFormValid(form: LifecycleFormState): boolean {
  return (
    form.action !== null &&
    form.reason.trim().length >= REASON_MIN_LENGTH &&
    form.confirmed === true
  );
}

/**
 * Returns a user-facing validation message, or null if the form is valid.
 */
export function getLifecycleFormError(form: LifecycleFormState): string | null {
  if (form.action === null)                              return "No action selected.";
  if (form.reason.trim().length === 0)                   return "Reason is required.";
  if (form.reason.trim().length < REASON_MIN_LENGTH)     return `Reason must be at least ${REASON_MIN_LENGTH} characters.`;
  if (!form.confirmed)                                   return "You must check the confirmation box to proceed.";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Paths
// ─────────────────────────────────────────────────────────────────────────────

export const LIFECYCLE_API_PATHS = {
  transition: (tenantId: string) => `/api/platform/tenants/${tenantId}/lifecycle`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Mutation Hook Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exactly one mutation hook name - lifecycle management is deliberately scoped.
 * Tested in workspace-lifecycle.test.ts T15.
 */
export const LIFECYCLE_MUTATION_HOOK_NAMES = [
  "useWorkspaceLifecycleTransition",
] as const;

export type LifecycleMutationHookName = (typeof LIFECYCLE_MUTATION_HOOK_NAMES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Safety Contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * P13-B Lifecycle Safety Contract - all properties must remain true.
 * Tested exhaustively in workspace-lifecycle.test.ts T9.
 */
export const LIFECYCLE_SAFETY_CONTRACT = {
  superAdminOnly:              true,
  requiresReason:              true,
  requiresConfirmation:        true,
  noWorkspaceDeletion:         true,
  noHardArchive:               true,
  noHrDataMutation:            true,
  noBillingActions:            true,
  noPaymentActions:            true,
  noAutomaticSuspension:       true,
  noExternalLegalNotices:      true,
  noEmailNotifications:        true,
  noAiDecisions:               true,
  failClosedOnUnknownState:    true,
  nonDestructive:              true,
} as const;

export type LifecycleSafetyContractKey = keyof typeof LIFECYCLE_SAFETY_CONTRACT;

// ─────────────────────────────────────────────────────────────────────────────
// Severity Styling
// ─────────────────────────────────────────────────────────────────────────────

export const LIFECYCLE_SEVERITY_STYLE: Record<LifecycleActionSeverity, {
  headerClass: string;
  iconClass:   string;
  border:      string;
}> = {
  standard: {
    headerClass: "text-emerald-700 dark:text-emerald-400",
    iconClass:   "text-emerald-500",
    border:      "border-emerald-200 dark:border-emerald-800",
  },
  warning: {
    headerClass: "text-orange-700 dark:text-orange-400",
    iconClass:   "text-orange-500",
    border:      "border-orange-200 dark:border-orange-800",
  },
  critical: {
    headerClass: "text-red-700 dark:text-red-400",
    iconClass:   "text-red-500",
    border:      "border-red-200 dark:border-red-800",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Empty / Placeholder State Messages
// ─────────────────────────────────────────────────────────────────────────────

export const LIFECYCLE_EMPTY_STATE = {
  noActionsAvailable:   "No lifecycle transitions are available for this workspace state.",
  transitionSuccess:    "Workspace lifecycle transition completed successfully.",
  transitionError:      "Lifecycle transition failed. The workspace state was not changed.",
  confirmationRequired: "Please confirm the action before proceeding.",
  reasonRequired:       "A reason for this action is required.",
} as const;
