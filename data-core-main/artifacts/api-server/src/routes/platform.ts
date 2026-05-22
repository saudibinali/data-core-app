import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  workspacesTable,
  usersTable,
  workflowExecutionsTable,
  schedulerFairnessPoliciesTable,
  workspaceSubscriptionsTable,
  attendanceIntegrationsTable,
  workspaceSmtpConfigsTable,
} from "@workspace/db";
import { sql, count, eq, and, or, desc, inArray } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireSuperAdmin } from "../middlewares/requireAuth";
import { canResetPlatformUserPasswordFromAdmin } from "../lib/root-platform-owner-policy";
import { evaluateWorkloadContainment } from "../lib/workflows/workload-partition";
import {
  buildPlatformGovernanceOverview,
  buildPlatformWorkloadList,
  classifyPlatformFairnessHealth,
  computeContainmentDistribution,
  computeAdvisoryDistribution,
  computeSchedulerPressureSummary,
  detectNoisyTenants,
  makePlatformScopeId,
  emitPlatformFairnessHealthEvent,
  emitPlatformNoisyTenantEvent,
  emitPlatformSchedulerPressureEvent,
} from "../lib/workflows/platform-governance";
import {
  createFairnessPolicy,
  applyFairnessPolicy,
  rollbackFairnessPolicy,
  expireFairnessPolicy,
  validateFairnessPolicyInput,
  checkPolicyConflict,
  isPolicyExpired,
  FairnessPolicyViolation,
  type FairnessPolicyStatus,
  type SchedulerFairnessPolicy,
} from "../lib/workflows/fairness-policy";
import {
  resolveEffectiveSchedulerWeight,
  buildAdaptiveResearchSnapshot,
  makeEnforcementBridgeId,
  type EnforcementMode,
} from "../lib/workflows/scheduler-enforcement-bridge";
import {
  evaluateFailureContainment,
  buildPlatformReliabilityOverview,
  makeReliabilityDomainId,
  type FailureContainmentInput,
} from "../lib/workflows/reliability-domains";
import {
  buildSnapshot,
  buildIncidentTimelines,
  evaluatePlatformSLOs,
  makeCaptureId,
  makeIncidentId,
  emitReliabilitySnapshotPersistedEvent,
  emitIncidentTimelineUpdatedEvent,
  type ReliabilityDomainSnapshot,
} from "../lib/workflows/reliability-history";
import {
  reliabilityDomainSnapshotsTable,
  reliabilityIncidentsTable,
} from "@workspace/db";
import {
  generateRecoveryRecommendations,
  buildWorkspaceIncidentHistory,
  buildPlatformTrendReport,
  type RecommendationContext,
  type IncidentSummary,
} from "../lib/workflows/recovery-recommendations";
import {
  buildOrchestrationAction,
  validateOrchestrationTransition,
  canAcknowledge,
  canBeginReview,
  canResolve,
  canRollBack,
  canCancel,
  ACTIVE_ORCHESTRATION_STATUSES,
  emitOrchestrationAcknowledgedEvent,
  emitOrchestrationResolvedEvent,
  emitOrchestrationRolledBackEvent,
  type RecoveryOrchestrationType,
  type RecoveryOrchestrationStatus,
} from "../lib/workflows/recovery-orchestration";
import { recoveryOrchestrationActionsTable } from "@workspace/db";
import {
  buildExecutionAttempt,
  confirmRemediationExecution,
  validateExecutionTransition,
  canMarkExecuting,
  canComplete,
  canRollBack as canExecRollBack,
  canAbandon,
  ACTIVE_EXECUTION_STATUSES,
  emitExecutionConfirmedEvent,
  emitExecutionCompletedEvent,
  emitExecutionRolledBackEvent,
  type RemediationExecutionType,
  type RemediationExecutionStatus,
  type RemediationRollbackStatus,
} from "../lib/workflows/remediation-execution";
import { remediationExecutionAttemptsTable } from "@workspace/db";
import {
  evaluateRemediationOutcomes,
  evaluateOperatorProfiles,
  buildPlatformEffectivenessSummary,
  emitOutcomeProfileEvaluatedEvent,
  emitEffectivenessScoredEvent,
  emitRollbackTrendDetectedEvent,
  emitOperatorEffectivenessUpdatedEvent,
  type ExecutionRecord,
} from "../lib/workflows/remediation-outcome-intelligence";
import {
  buildAuditChainEntry,
  verifyAuditIntegrity,
  reconstructAuditTimeline,
  buildComplianceSummary,
  emitAuditChainRecordedEvent,
  emitAuditIntegrityVerifiedEvent,
  emitAuditIntegrityAnomalyDetectedEvent,
  emitForensicTimelineReconstructedEvent,
  type AuditChainEntry,
  type AuditEntityType,
  type AuditIntegrityStatus,
  type RetentionClassification,
} from "../lib/workflows/compliance-audit-integrity";
import { complianceAuditChainsTable } from "@workspace/db";
import {
  GOVERNANCE_POLICIES,
  evaluateGovernancePolicies,
  buildGovernanceSummary,
  emitGovernancePolicyEvaluatedEvent,
  emitGovernanceViolationDetectedEvent,
  emitComplianceGapClassifiedEvent,
  emitPolicyReviewRequiredEvent,
} from "../lib/workflows/governance-policy-intelligence";
import {
  initiateGovernanceWorkflow,
  acknowledgeWorkflow,
  escalateWorkflow,
  resolveWorkflow,
  buildWorkflowSummary,
  classifyEscalationLevel,
  emitGovernanceWorkflowInitiatedEvent,
  emitGovernanceWorkflowAcknowledgedEvent,
  emitGovernanceWorkflowEscalatedEvent,
  emitGovernanceWorkflowResolvedEvent,
  type GovernanceWorkflowAction,
  type GovernanceWorkflowStatus,
  type GovernanceEscalationLevel,
  type ResolutionClassification,
} from "../lib/workflows/compliance-workflow-orchestration";
import { governanceWorkflowActionsTable } from "@workspace/db";
import {
  evaluateGovernanceAnalytics,
  buildGovernanceEffectivenessReport,
  evaluateAllPolicyEffectiveness,
  evaluatePolicyEffectiveness,
  emitGovernanceAnalyticsEvaluatedEvent,
  emitPolicyEffectivenessScored,
  emitWorkflowStabilityClassifiedEvent,
  emitCriticalUnresolvedThresholdDetectedEvent,
} from "../lib/workflows/compliance-operations-analytics";
import {
  computeLifecycleCoverage,
  buildGovernanceTopology,
  buildBoundarySummary,
  buildGovernanceReadiness,
  emitGovernanceTopologyEvaluatedEvent,
  emitGovernanceBoundaryVerifiedEvent,
  emitGovernanceLayerClassifiedEvent,
  emitGovernanceReadinessConfirmedEvent,
} from "../lib/workflows/governance-intelligence-consolidation";
import {
  buildGovernanceEvidencePackage,
  buildTopologySnapshotPayload,
  diffGovernanceTopologySnapshots,
  emitGovernanceEvidencePackageGeneratedEvent,
  emitGovernancePackageIntegrityVerifiedEvent,
  emitGovernanceTopologySnapshotBuiltEvent,
  emitGovernanceTopologyDiffComputedEvent,
  type GovernanceEvidencePackageScope,
  type GovernanceTopologySnapshotPayload,
} from "../lib/workflows/governance-evidence-packaging";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// EXISTING PLATFORM ROUTES
// ─────────────────────────────────────────────────────────────────────────────

router.get("/platform/stats", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const [[workspaceRow], [userRow], [activeRow], [suspendedRow], [disabledRow]] = await Promise.all([
    db.select({ total: count() }).from(workspacesTable),
    // Count only workspace-assigned users (excludes super_admins and orphans)
    db.select({ total: count() }).from(usersTable)
      .where(and(sql`${usersTable.workspaceId} IS NOT NULL`, sql`${usersTable.role} != 'super_admin'`)),
    db.select({ total: count() }).from(workspacesTable).where(sql`${workspacesTable.status} = 'active'`),
    db.select({ total: count() }).from(workspacesTable).where(sql`${workspacesTable.status} = 'suspended'`),
    db.select({ total: count() }).from(workspacesTable).where(sql`${workspacesTable.status} = 'disabled'`),
  ]);

  res.json({
    totalWorkspaces:     workspaceRow?.total ?? 0,
    activeWorkspaces:    activeRow?.total ?? 0,
    suspendedWorkspaces: suspendedRow?.total ?? 0,
    disabledWorkspaces:  disabledRow?.total ?? 0,
    totalUsers:          userRow?.total ?? 0,
  });
});

/**
 * GET /platform/overview/dashboard
 * Read-only platform command center aggregates (auto-refresh friendly).
 */
router.get(
  "/platform/overview/dashboard",
  requireAuth,
  requireSuperAdmin,
  async (_req, res): Promise<void> => {
    const generatedAt = new Date().toISOString();

    const [
      [workspaceRow],
      [userRow],
      [activeRow],
      [suspendedRow],
      [disabledRow],
      subscriptionRows,
      planRows,
      [attendanceIntRow],
      [smtpRow],
      [enabledIntRow],
      [trialEndingRow],
      [graceRow],
    ] = await Promise.all([
      db.select({ total: count() }).from(workspacesTable),
      db
        .select({ total: count() })
        .from(usersTable)
        .where(
          and(sql`${usersTable.workspaceId} IS NOT NULL`, sql`${usersTable.role} != 'super_admin'`),
        ),
      db.select({ total: count() }).from(workspacesTable).where(eq(workspacesTable.status, "active")),
      db.select({ total: count() }).from(workspacesTable).where(eq(workspacesTable.status, "suspended")),
      db.select({ total: count() }).from(workspacesTable).where(eq(workspacesTable.status, "disabled")),
      db
        .select({
          status: workspaceSubscriptionsTable.status,
          n: sql<number>`count(*)::int`,
        })
        .from(workspaceSubscriptionsTable)
        .groupBy(workspaceSubscriptionsTable.status),
      db
        .select({
          planCode: workspaceSubscriptionsTable.planName,
          n: sql<number>`count(*)::int`,
        })
        .from(workspaceSubscriptionsTable)
        .groupBy(workspaceSubscriptionsTable.planName),
      db.select({ total: count() }).from(attendanceIntegrationsTable),
      db.select({ total: count() }).from(workspaceSmtpConfigsTable),
      db
        .select({ total: count() })
        .from(attendanceIntegrationsTable)
        .where(eq(attendanceIntegrationsTable.isEnabled, true)),
      db
        .select({ total: count() })
        .from(workspaceSubscriptionsTable)
        .where(
          and(
            eq(workspaceSubscriptionsTable.status, "trial"),
            sql`${workspaceSubscriptionsTable.endDate} IS NOT NULL`,
            sql`${workspaceSubscriptionsTable.endDate}::date > current_date`,
            sql`${workspaceSubscriptionsTable.endDate}::date <= current_date + interval '14 days'`,
          ),
        ),
      db
        .select({ total: count() })
        .from(workspaceSubscriptionsTable)
        .where(
          and(
            sql`${workspaceSubscriptionsTable.gracePeriodEndsAt} IS NOT NULL`,
            sql`${workspaceSubscriptionsTable.gracePeriodEndsAt} > now()`,
          ),
        ),
    ]);

    const totalWorkspaces = workspaceRow?.total ?? 0;
    const withSubscription = subscriptionRows.reduce((s, r) => s + (r.n ?? 0), 0);
    const subscriptionByStatus: Record<string, number> = {};
    for (const row of subscriptionRows) {
      subscriptionByStatus[row.status ?? "unknown"] = row.n ?? 0;
    }
    const planByCode: Record<string, number> = {};
    for (const row of planRows) {
      const key = row.planCode?.trim() || "no_plan";
      planByCode[key] = row.n ?? 0;
    }

    res.json({
      generatedAt,
      workspaces: {
        total: totalWorkspaces,
        active: activeRow?.total ?? 0,
        suspended: suspendedRow?.total ?? 0,
        disabled: disabledRow?.total ?? 0,
        withoutSubscription: Math.max(0, totalWorkspaces - withSubscription),
      },
      users: { total: userRow?.total ?? 0 },
      subscriptions: {
        byStatus: subscriptionByStatus,
        trialEndingWithin14Days: trialEndingRow?.total ?? 0,
        gracePeriodActive: graceRow?.total ?? 0,
      },
      plans: { byCode: planByCode },
      integrations: {
        attendanceConnections: attendanceIntRow?.total ?? 0,
        attendanceEnabled: enabledIntRow?.total ?? 0,
        smtpConfigured: smtpRow?.total ?? 0,
      },
      safetyNotice:
        "Read-only dashboard feed. No enforcement, billing capture, or automatic lifecycle changes.",
    });
  },
);

/** Overview dashboard feed - not the P14-D audit timeline (see platform-activity.ts). */
router.get("/platform/overview/activity", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const recentWorkspaces = await db
    .select({ id: workspacesTable.id, name: workspacesTable.name, slug: workspacesTable.slug, status: workspacesTable.status, createdAt: workspacesTable.createdAt })
    .from(workspacesTable)
    .orderBy(sql`${workspacesTable.createdAt} desc`)
    .limit(20);

  const recentUsers = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, email: usersTable.email, role: usersTable.role, workspaceId: usersTable.workspaceId, createdAt: usersTable.createdAt })
    .from(usersTable)
    .orderBy(sql`${usersTable.createdAt} desc`)
    .limit(20);

  res.json({ recentWorkspaces, recentUsers });
});

/** POST /admin/reset-password - super_admin resets any user's password */
router.post("/admin/reset-password", requireAuth, requireSuperAdmin, async (req: AuthRequest, res): Promise<void> => {
  const { userId, password } = req.body as { userId?: number; password?: string };

  if (!userId || !password) {
    res.status(400).json({ error: "userId and password are required" }); return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" }); return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      workspaceId: usersTable.workspaceId,
      platformRoleCode: usersTable.platformRoleCode,
      isRootOwner: usersTable.isRootOwner,
      isProtected: usersTable.isProtected,
    })
    .from(usersTable)
    .where(eq(usersTable.id, Number(userId)));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const resetCheck = canResetPlatformUserPasswordFromAdmin(
    {
      id: req.userId,
      role: req.userRole ?? "",
      workspaceId: req.workspaceId,
      platformRoleCode: req.platformRoleCode,
      isRootOwner: req.isRootOwner,
    },
    {
      id: user.id,
      role: user.role,
      workspaceId: user.workspaceId,
      platformRoleCode: user.platformRoleCode,
      isRootOwner: user.isRootOwner,
      isProtected: user.isProtected,
    },
  );
  if (req.userId !== Number(userId) && !resetCheck.allowed) {
    res.status(403).json({
      error: "Cannot reset password for a protected platform owner account",
      code: "ROOT_PASSWORD_RESET_BLOCKED",
    });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await db.update(usersTable).set({ passwordHash: hash, mustResetPassword: true }).where(eq(usersTable.id, Number(userId)));
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9-D PLATFORM GOVERNANCE ROUTES (super_admin only)
// ─────────────────────────────────────────────────────────────────────────────
//
// All four routes:
//   • requireAuth + requireSuperAdmin  - enforced at middleware level
//   • READ-ONLY                        - no scheduler mutation, no writes
//   • Advisory-only                    - no automatic throttling
//   • Deterministic ordering           - sorted by pressureScore DESC / workspaceId ASC
//   • Bounded payloads                 - /workloads paginates; overview caps topPressure
//
// Shared DB query pattern (used by all 4 routes):
//
//   Step 1: Fetch all visible workspaces (active + suspended)
//   Step 2: Per-workspace execution counts in a single GROUP BY query
//   Step 3: Sum platform-wide active total for EXECUTION_MONOPOLY detection
//   Step 4: evaluateWorkloadContainment() per workspace → TenantWorkloadPartition[]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches workspace list + per-workspace execution counts, computes partitions.
 * Shared helper used by all four P9-D governance routes.
 */
async function fetchPlatformPartitions() {
  const [workspaces, execCounts] = await Promise.all([
    db
      .select({ id: workspacesTable.id, name: workspacesTable.name })
      .from(workspacesTable)
      .where(sql`${workspacesTable.status} IN ('active', 'suspended')`)
      .orderBy(workspacesTable.id),

    db
      .select({
        workspaceId:           workflowExecutionsTable.workspaceId,
        activeExecutionCount:  sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'running')`,
        delayedExecutionCount: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'waiting_delay')`,
      })
      .from(workflowExecutionsTable)
      .groupBy(workflowExecutionsTable.workspaceId),
  ]);

  const countMap = new Map(
    execCounts.map(r => [
      r.workspaceId,
      {
        active:  Number(r.activeExecutionCount  ?? 0),
        delayed: Number(r.delayedExecutionCount ?? 0),
      },
    ]),
  );

  // Platform-wide total active executions - used for EXECUTION_MONOPOLY detection
  const platformActiveExecutions = [...countMap.values()]
    .reduce((sum, c) => sum + c.active, 0);

  const partitions = workspaces.map(ws =>
    evaluateWorkloadContainment({
      workspaceId:              ws.id,
      activeExecutionCount:     countMap.get(ws.id)?.active  ?? 0,
      delayedExecutionCount:    countMap.get(ws.id)?.delayed ?? 0,
      platformActiveExecutions,
    }),
  );

  const workspaceNames = Object.fromEntries(workspaces.map(ws => [ws.id, ws.name]));
  const workspaceCount = workspaces.length;

  return { partitions, workspaceNames, workspaceCount };
}

// ── GET /platform/governance/overview ────────────────────────────────────────
//
// Full PlatformGovernanceOverview: containment distribution, advisory
// distribution, scheduler pressure summary, noisy tenant count,
// platform fairness health, and top-pressure workspace list.
//
// Event emitted: platform_governance_overview_generated (inside engine)

router.get(
  "/platform/governance/overview",
  requireAuth,
  requireSuperAdmin,
  async (_req, res): Promise<void> => {
    const { partitions, workspaceNames, workspaceCount } = await fetchPlatformPartitions();

    const requestScopeId = makePlatformScopeId();

    const overview = buildPlatformGovernanceOverview({
      workspaceCount,
      partitions,
      workspaceNames,
      requestScopeId,
    });

    res.json(overview);
  },
);

// ── GET /platform/governance/workloads ───────────────────────────────────────
//
// Paginated list of all workspace workload entries, sorted by pressureScore DESC.
// Query params: page (1-based, default 1), limit (default 50, max 100).
//
// Event emitted: platform_scheduler_pressure_evaluated

router.get(
  "/platform/governance/workloads",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const { partitions, workspaceNames, workspaceCount } = await fetchPlatformPartitions();

    const page  = Math.max(1, Number(req.query["page"]  ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 50)));
    const offset = (page - 1) * limit;

    const allEntries = buildPlatformWorkloadList(partitions, workspaceNames);
    const entries    = allEntries.slice(offset, offset + limit);

    const requestScopeId           = makePlatformScopeId();
    const containmentDistribution  = computeContainmentDistribution(partitions);
    const noisyCount               = partitions.filter(p => p.noisyBehaviorDetected).length;
    const fairnessHealth           = classifyPlatformFairnessHealth(
      containmentDistribution,
      noisyCount,
      partitions.length,
    );

    emitPlatformSchedulerPressureEvent(
      requestScopeId,
      workspaceCount,
      fairnessHealth,
      noisyCount,
      containmentDistribution,
    );

    res.json({
      entries,
      pagination: {
        page,
        limit,
        total:      allEntries.length,
        totalPages: Math.ceil(allEntries.length / limit),
      },
      fairnessHealth,
      requestScopeId,
    });
  },
);

// ── GET /platform/governance/fairness ────────────────────────────────────────
//
// Platform fairness health classification + containment distribution
// + advisory distribution + scheduler pressure summary.
// Focused response for the scheduler oversight panel.
//
// Event emitted: platform_fairness_health_evaluated

router.get(
  "/platform/governance/fairness",
  requireAuth,
  requireSuperAdmin,
  async (_req, res): Promise<void> => {
    const { partitions, workspaceCount } = await fetchPlatformPartitions();

    const requestScopeId           = makePlatformScopeId();
    const containmentDistribution  = computeContainmentDistribution(partitions);
    const advisoryDistribution     = computeAdvisoryDistribution(partitions);
    const schedulerPressureSummary = computeSchedulerPressureSummary(partitions);

    const noisyCount     = partitions.filter(p => p.noisyBehaviorDetected).length;
    const fairnessHealth = classifyPlatformFairnessHealth(
      containmentDistribution,
      noisyCount,
      partitions.length,
    );

    emitPlatformFairnessHealthEvent(
      requestScopeId,
      workspaceCount,
      fairnessHealth,
      noisyCount,
      containmentDistribution,
    );

    res.json({
      fairnessHealth,
      noisyTenantCount:         noisyCount,
      totalWorkspaces:          workspaceCount,
      evaluatedPartitions:      partitions.length,
      containmentDistribution,
      advisoryDistribution,
      schedulerPressureSummary,
      requestScopeId,
      evaluatedAt:              new Date().toISOString(),
    });
  },
);

// ── GET /platform/governance/noisy-tenants ────────────────────────────────────
//
// List of all workspaces with detected noisy-tenant behavior, sorted by
// pressureScore DESC. Advisory-only - no throttling actions.
//
// Noisy categories reported:
//   EXECUTION_MONOPOLY       - workspace holds >60% of platform active executions
//   SCHEDULER_BACKLOG_FLOOD  - delayed queue exceeds schedulerBatchSize × 5
//   ADVISORY_STORM           - active governance signal count exceeds threshold
//   CHRONIC_HOTSPOT_FLOOD    - persistent hotspot concentration at urgent/critical
//
// Event emitted: platform_noisy_tenant_detected

router.get(
  "/platform/governance/noisy-tenants",
  requireAuth,
  requireSuperAdmin,
  async (_req, res): Promise<void> => {
    const { partitions, workspaceNames, workspaceCount } = await fetchPlatformPartitions();

    const requestScopeId          = makePlatformScopeId();
    const noisyTenants            = detectNoisyTenants(partitions, workspaceNames);
    const containmentDistribution = computeContainmentDistribution(partitions);
    const noisyCount              = noisyTenants.length;
    const fairnessHealth          = classifyPlatformFairnessHealth(
      containmentDistribution,
      noisyCount,
      partitions.length,
    );

    emitPlatformNoisyTenantEvent(
      requestScopeId,
      workspaceCount,
      fairnessHealth,
      noisyCount,
      containmentDistribution,
    );

    res.json({
      noisyTenants,
      noisyTenantCount:   noisyCount,
      totalWorkspaces:    workspaceCount,
      evaluatedPartitions: partitions.length,
      fairnessHealth,
      requestScopeId,
      evaluatedAt:        new Date().toISOString(),
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P9-E FAIRNESS POLICY ROUTES (super_admin only)
// ─────────────────────────────────────────────────────────────────────────────
//
// All four routes:
//   • requireAuth + requireSuperAdmin  - enforced at middleware level
//   • Human-approval required          - no autonomous scheduler adjustment
//   • Conflict-safe                    - one active/pending policy per workspace
//   • Audit-safe payloads              - full FairnessPolicyAuditEntry on each state change
//   • Advisory-only effective weight   - no live scheduler enforcement, operator-driven
//
// Policy lifecycle:
//   POST /policies            → creates "pending" policy
//   POST /policies/:id/approve → "pending" → "active"
//   POST /policies/:id/rollback → "active" → "rolled_back"
//   GET  /policies            → list with auto-expiry of stale pending/active rows
// ─────────────────────────────────────────────────────────────────────────────

/** Maps a DB row to the SchedulerFairnessPolicy value object. */
function rowToPolicy(row: typeof schedulerFairnessPoliciesTable.$inferSelect): SchedulerFairnessPolicy {
  return {
    policyId:                row.policyId,
    workspaceId:             row.workspaceId,
    targetSchedulerWeight:   row.targetSchedulerWeight,
    previousSchedulerWeight: row.previousSchedulerWeight,
    adjustmentReason:        row.adjustmentReason,
    requestedBy:             row.requestedBy,
    approvedBy:              row.approvedBy ?? null,
    approvedAt:              row.approvedAt ? row.approvedAt.toISOString() : null,
    expiresAt:               row.expiresAt.toISOString(),
    rollbackEligible:        row.rollbackEligible,
    policyStatus:            row.policyStatus as FairnessPolicyStatus,
    createdAt:               row.createdAt.toISOString(),
  };
}

// ── POST /platform/governance/fairness/policies ───────────────────────────────
//
// Creates a new fairness policy in "pending" status.
// Requires no existing active/pending policy for the same workspace.
// The previousSchedulerWeight is derived from the live P9-B workload partition.
//
// Body: { workspaceId, targetSchedulerWeight, adjustmentReason, expiresAt, requestedBy? }

router.post(
  "/platform/governance/fairness/policies",
  requireAuth,
  requireSuperAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const body = req.body as {
      workspaceId?:           unknown;
      targetSchedulerWeight?: unknown;
      adjustmentReason?:      unknown;
      expiresAt?:             unknown;
      requestedBy?:           unknown;
    };

    const workspaceId           = Number(body.workspaceId);
    const targetSchedulerWeight = Number(body.targetSchedulerWeight);
    const adjustmentReason      = String(body.adjustmentReason ?? "").trim();
    const expiresAt             = String(body.expiresAt ?? "").trim();
    const requestedBy           = String(body.requestedBy ?? "").trim() || String((req as AuthRequest).userId);

    if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "workspaceId must be a positive integer" }); return;
    }

    // Verify workspace exists
    const [workspace] = await db
      .select({ id: workspacesTable.id })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId));
    if (!workspace) {
      res.status(404).json({ error: `Workspace ${workspaceId} not found` }); return;
    }

    // Check for conflict: no active/pending policy for this workspace
    const livePolicyRows = await db
      .select()
      .from(schedulerFairnessPoliciesTable)
      .where(
        and(
          eq(schedulerFairnessPoliciesTable.workspaceId, workspaceId),
          or(
            eq(schedulerFairnessPoliciesTable.policyStatus, "pending"),
            eq(schedulerFairnessPoliciesTable.policyStatus, "active"),
          ),
        ),
      );

    const livePolicies = livePolicyRows.map(rowToPolicy);
    const conflict     = checkPolicyConflict(livePolicies, workspaceId);
    if (conflict.hasConflict) {
      res.status(409).json({
        error:               "A live fairness policy already exists for this workspace",
        conflictingPolicyId: conflict.conflictingPolicyId,
        conflictingStatus:   conflict.conflictingStatus,
      }); return;
    }

    // Derive previousSchedulerWeight from live P9-B partition
    const execCounts = await db
      .select({
        activeExecutionCount:  sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'running')`,
        delayedExecutionCount: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionsTable.status} = 'waiting_delay')`,
      })
      .from(workflowExecutionsTable)
      .where(eq(workflowExecutionsTable.workspaceId, workspaceId));

    const partition = evaluateWorkloadContainment({
      workspaceId,
      activeExecutionCount:  Number(execCounts[0]?.activeExecutionCount  ?? 0),
      delayedExecutionCount: Number(execCounts[0]?.delayedExecutionCount ?? 0),
    });
    const previousSchedulerWeight = partition.schedulerWeight;

    // Validate + create policy object (pure engine - throws on invalid input)
    let policy: SchedulerFairnessPolicy;
    try {
      policy = createFairnessPolicy({
        workspaceId,
        targetSchedulerWeight,
        previousSchedulerWeight,
        adjustmentReason,
        requestedBy,
        expiresAt,
      });
    } catch (err) {
      if (err instanceof FairnessPolicyViolation) {
        res.status(400).json({ error: err.message, code: err.code }); return;
      }
      throw err;
    }

    // Persist to DB
    await db.insert(schedulerFairnessPoliciesTable).values({
      policyId:                policy.policyId,
      workspaceId:             policy.workspaceId,
      targetSchedulerWeight:   policy.targetSchedulerWeight,
      previousSchedulerWeight: policy.previousSchedulerWeight,
      adjustmentReason:        policy.adjustmentReason,
      requestedBy:             policy.requestedBy,
      approvedBy:              null,
      approvedAt:              null,
      expiresAt:               new Date(policy.expiresAt),
      rollbackEligible:        policy.rollbackEligible,
      policyStatus:            policy.policyStatus,
    });

    res.status(201).json({ policy });
  },
);

// ── POST /platform/governance/fairness/policies/:policyId/approve ─────────────
//
// Approves a pending policy, transitioning it to "active".
// Requires the policy to be in "pending" status and not yet expired.
//
// Body: { approvedBy? }   - defaults to String((req as AuthRequest).userId) if omitted

router.post(
  "/platform/governance/fairness/policies/:policyId/approve",
  requireAuth,
  requireSuperAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const { policyId } = req.params as { policyId: string };
    const body         = req.body as { approvedBy?: unknown };
    const approvedBy   = String(body.approvedBy ?? "").trim() || String((req as AuthRequest).userId);

    const [row] = await db
      .select()
      .from(schedulerFairnessPoliciesTable)
      .where(eq(schedulerFairnessPoliciesTable.policyId, policyId));

    if (!row) {
      res.status(404).json({ error: `Policy "${policyId}" not found` }); return;
    }

    const policy = rowToPolicy(row);

    // Auto-expire if past expiresAt
    if (isPolicyExpired(policy)) {
      const expired = expireFairnessPolicy(policy);
      await db
        .update(schedulerFairnessPoliciesTable)
        .set({ policyStatus: "expired", rollbackEligible: false })
        .where(eq(schedulerFairnessPoliciesTable.policyId, policyId));
      res.status(409).json({
        error:    "Policy has expired and cannot be approved",
        policy:   expired,
        code:     "POLICY_ALREADY_EXPIRED",
      }); return;
    }

    let application: Awaited<ReturnType<typeof applyFairnessPolicy>>;
    try {
      application = applyFairnessPolicy(policy, { approvedBy, approvalTime: new Date() });
    } catch (err) {
      if (err instanceof FairnessPolicyViolation) {
        res.status(409).json({ error: err.message, code: err.code }); return;
      }
      throw err;
    }

    const { policy: updatedPolicy, auditEntry } = application;

    await db
      .update(schedulerFairnessPoliciesTable)
      .set({
        policyStatus: "active",
        approvedBy:   updatedPolicy.approvedBy ?? undefined,
        approvedAt:   updatedPolicy.approvedAt ? new Date(updatedPolicy.approvedAt) : undefined,
      })
      .where(eq(schedulerFairnessPoliciesTable.policyId, policyId));

    res.json({ policy: updatedPolicy, auditEntry });
  },
);

// ── POST /platform/governance/fairness/policies/:policyId/rollback ────────────
//
// Rolls back an active policy, restoring the previousSchedulerWeight advisory.
// Policy must be "active" and rollbackEligible=true.
//
// Body: { rollbackReason? }

router.post(
  "/platform/governance/fairness/policies/:policyId/rollback",
  requireAuth,
  requireSuperAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const { policyId }    = req.params as { policyId: string };
    const body            = req.body as { rollbackReason?: unknown };
    const rollbackReason  = String(body.rollbackReason ?? "").trim() || undefined;

    const [row] = await db
      .select()
      .from(schedulerFairnessPoliciesTable)
      .where(eq(schedulerFairnessPoliciesTable.policyId, policyId));

    if (!row) {
      res.status(404).json({ error: `Policy "${policyId}" not found` }); return;
    }

    const policy = rowToPolicy(row);

    let application: Awaited<ReturnType<typeof rollbackFairnessPolicy>>;
    try {
      application = rollbackFairnessPolicy(policy, { rollbackReason, rollbackTime: new Date() });
    } catch (err) {
      if (err instanceof FairnessPolicyViolation) {
        res.status(409).json({ error: err.message, code: err.code }); return;
      }
      throw err;
    }

    const { policy: updatedPolicy, auditEntry } = application;

    await db
      .update(schedulerFairnessPoliciesTable)
      .set({ policyStatus: "rolled_back", rollbackEligible: false })
      .where(eq(schedulerFairnessPoliciesTable.policyId, policyId));

    res.json({ policy: updatedPolicy, auditEntry });
  },
);

// ── GET /platform/governance/fairness/policies ────────────────────────────────
//
// Lists fairness policies with optional filters. Auto-expires stale
// pending/active policies whose expiresAt has passed.
//
// Query params: workspaceId?, status?, page (1-based, default 1), limit (default 20, max 100)

router.get(
  "/platform/governance/fairness/policies",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const wsFilter    = req.query["workspaceId"] ? Number(req.query["workspaceId"]) : null;
    const statusFilter = req.query["status"] ? String(req.query["status"]) : null;
    const page         = Math.max(1, Number(req.query["page"]  ?? 1));
    const limit        = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 20)));

    // Build WHERE conditions
    const conditions = [];
    if (wsFilter !== null && Number.isInteger(wsFilter) && wsFilter > 0) {
      conditions.push(eq(schedulerFairnessPoliciesTable.workspaceId, wsFilter));
    }
    if (statusFilter) {
      conditions.push(eq(schedulerFairnessPoliciesTable.policyStatus, statusFilter));
    }

    const rows = await db
      .select()
      .from(schedulerFairnessPoliciesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schedulerFairnessPoliciesTable.createdAt));

    const now = new Date();

    // Auto-expire stale pending/active policies (batch update by policyId)
    const staleIds = rows
      .filter(
        r =>
          (r.policyStatus === "pending" || r.policyStatus === "active") &&
          new Date(r.expiresAt).getTime() <= now.getTime(),
      )
      .map(r => r.policyId);

    if (staleIds.length > 0) {
      for (const stalePolicyId of staleIds) {
        await db
          .update(schedulerFairnessPoliciesTable)
          .set({ policyStatus: "expired", rollbackEligible: false })
          .where(eq(schedulerFairnessPoliciesTable.policyId, stalePolicyId));
      }
    }

    // Build final policy list with auto-expired status reflected
    const policies = rows.map(r => {
      const policy = rowToPolicy(r);
      if (staleIds.includes(r.policyId)) {
        return { ...policy, policyStatus: "expired" as FairnessPolicyStatus, rollbackEligible: false };
      }
      return policy;
    });

    const offset       = (page - 1) * limit;
    const paginated    = policies.slice(offset, offset + limit);
    const expiredCount = staleIds.length;

    res.json({
      policies:     paginated,
      pagination: {
        page,
        limit,
        total:      policies.length,
        totalPages: Math.ceil(policies.length / limit),
      },
      expiredCount,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P9-F ENFORCEMENT BRIDGE ROUTE (super_admin only)
// ─────────────────────────────────────────────────────────────────────────────
//
// GET /platform/governance/enforcement
//
// Returns an AdaptiveResearchSnapshot: per-workspace enforcement bridges
// combining P9-B advisory weights with P9-E active policy resolution.
//
// For each workspace:
//   1. Compute P9-B advisoryWeight from live execution counts
//   2. Fetch all active P9-E policies
//   3. resolveEffectiveSchedulerWeight() → SchedulerEnforcementBridge
//   4. Aggregate into AdaptiveResearchSnapshot
//
// Query params:
//   mode? - "advisory_only" | "operator_confirmed" | "research_shadow"
//            Controls how policies are applied. Defaults to "operator_confirmed"
//            (i.e., active policies override advisory weight normally).

router.get(
  "/platform/governance/enforcement",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const requestedMode = req.query["mode"]
      ? (req.query["mode"] as EnforcementMode)
      : undefined;

    const scopeId        = makeEnforcementBridgeId();
    const resolutionTime = new Date();

    // ── Step 1: Fetch P9-B partitions + workspace names (P9-D pattern) ───────
    const [{ partitions, workspaceNames }, activePolicyRows] = await Promise.all([
      fetchPlatformPartitions(),
      db
        .select()
        .from(schedulerFairnessPoliciesTable)
        .where(eq(schedulerFairnessPoliciesTable.policyStatus, "active")),
    ]);

    // ── Step 2: Map active P9-E policies ─────────────────────────────────────
    const activePolicies: SchedulerFairnessPolicy[] = activePolicyRows.map(rowToPolicy);

    // ── Step 3: Resolve enforcement bridges per workspace ────────────────────
    const bridges = partitions.map(partition => {
      const { bridge } = resolveEffectiveSchedulerWeight({
        policies:       activePolicies,
        workspaceId:    partition.workspaceId,
        advisoryWeight: partition.schedulerWeight,
        resolutionTime,
        requestedMode,
      });
      return bridge;
    });

    // ── Step 4: Build AdaptiveResearchSnapshot ────────────────────────────────
    const snapshot = buildAdaptiveResearchSnapshot(
      bridges,
      partitions,
      workspaceNames as Record<number, string>,
      scopeId,
      resolutionTime,
    );

    res.json({ enforcement: snapshot });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P10-A RELIABILITY DOMAINS ROUTE (super_admin only)
// ─────────────────────────────────────────────────────────────────────────────
//
// GET /platform/governance/reliability/domains
//
// Returns a PlatformReliabilityOverview: per-workspace reliability domains
// composed from P9-B partitions, P9-E active policies, and P9-F bridges.
//
// For each workspace:
//   1. P9-B partition  → pressureScore, containmentStatus, noisyCodes, advisoryPressure, backlog
//   2. P9-E policies   → activePolicyCount per workspace
//   3. P9-F bridge     → enforcementStatus, effectiveWeight, conflictDetected
//   4. evaluateFailureContainment() → ReliabilityDomain + BlastRadius + Boundaries
//   5. buildPlatformReliabilityOverview() → aggregate

router.get(
  "/platform/governance/reliability/domains",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const now     = new Date();
    const scopeId = makeReliabilityDomainId(0).replace("rd:0-", "rs:");

    // ── Fetch P9-B partitions, P9-E active policy counts, and P9-E active policy rows in parallel
    const [{ partitions, workspaceNames }, activePolicyCounts, activePolicyRows] = await Promise.all([
      fetchPlatformPartitions(),
      db
        .select({
          workspaceId: schedulerFairnessPoliciesTable.workspaceId,
          count:       sql<number>`COUNT(*)`,
        })
        .from(schedulerFairnessPoliciesTable)
        .where(eq(schedulerFairnessPoliciesTable.policyStatus, "active"))
        .groupBy(schedulerFairnessPoliciesTable.workspaceId),
      db
        .select()
        .from(schedulerFairnessPoliciesTable)
        .where(eq(schedulerFairnessPoliciesTable.policyStatus, "active")),
    ]);

    // Build lookup: workspaceId → activePolicyCount
    const policyCountMap = new Map(
      activePolicyCounts.map(r => [r.workspaceId, Number(r.count)]),
    );

    // Map active policies to SchedulerFairnessPolicy value objects (for P9-F)
    const activePolicies: SchedulerFairnessPolicy[] = activePolicyRows.map(rowToPolicy);

    // ── Per-workspace: resolve P9-F bridge + build P10-A containment input ───
    const containmentResults = partitions.map(partition => {
      const { bridge } = resolveEffectiveSchedulerWeight({
        policies:       activePolicies,
        workspaceId:    partition.workspaceId,
        advisoryWeight: partition.schedulerWeight,
        resolutionTime: now,
      });

      const input: FailureContainmentInput = {
        workspaceId:           partition.workspaceId,
        workspaceName:         (workspaceNames as Record<number, string>)[partition.workspaceId],
        pressureScore:         partition.pressureScore.total,
        containmentStatus:     partition.containmentStatus,
        noisyBehaviorCodes:    partition.noisyBehaviorCodes as string[],
        advisoryPressureLevel: partition.advisoryPressureLevel,
        backlogDepth:          partition.delayedExecutionCount,
        activeExecutionCount:  partition.activeExecutionCount,
        advisoryWeight:        partition.schedulerWeight,
        activePolicyCount:     policyCountMap.get(partition.workspaceId) ?? 0,
        enforcementStatus:     bridge.enforcementStatus,
        effectiveWeight:       bridge.effectiveSchedulerWeight,
        conflictDetected:      bridge.enforcementStatus === "conflict",
        evaluationTime:        now,
      };

      return evaluateFailureContainment(input);
    });

    // ── Aggregate into platform overview ─────────────────────────────────────
    const overview = buildPlatformReliabilityOverview(containmentResults, scopeId, now);

    res.json({ reliability: overview });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P10-B RELIABILITY HISTORY ROUTES (super_admin only)
// ─────────────────────────────────────────────────────────────────────────────

// ── POST /platform/reliability/capture ───────────────────────────────────────
// Runs a live P10-A reliability evaluation for all workspaces, persists one
// snapshot per workspace to reliability_domain_snapshots, and updates the
// reliability_incidents table.  Returns: { captureId, snapshotCount, overview }.

router.post(
  "/platform/reliability/capture",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const now       = new Date();
    const captureId = makeCaptureId();

    // ── Step 1: Fetch P9-B partitions + P9-E policies (parallel) ─────────────
    const [{ partitions, workspaceNames }, activePolicyCounts, activePolicyRows] =
      await Promise.all([
        fetchPlatformPartitions(),
        db
          .select({
            workspaceId: schedulerFairnessPoliciesTable.workspaceId,
            count:       sql<number>`COUNT(*)`,
          })
          .from(schedulerFairnessPoliciesTable)
          .where(eq(schedulerFairnessPoliciesTable.policyStatus, "active"))
          .groupBy(schedulerFairnessPoliciesTable.workspaceId),
        db
          .select()
          .from(schedulerFairnessPoliciesTable)
          .where(eq(schedulerFairnessPoliciesTable.policyStatus, "active")),
      ]);

    const policyCountMap = new Map(
      activePolicyCounts.map(r => [r.workspaceId, Number(r.count)]),
    );
    const activePolicies: SchedulerFairnessPolicy[] = activePolicyRows.map(rowToPolicy);

    // ── Step 2: Evaluate P10-A containment + build snapshots ─────────────────
    const containmentResults = partitions.map(partition => {
      const { bridge } = resolveEffectiveSchedulerWeight({
        policies:       activePolicies,
        workspaceId:    partition.workspaceId,
        advisoryWeight: partition.schedulerWeight,
        resolutionTime: now,
      });
      const input: FailureContainmentInput = {
        workspaceId:           partition.workspaceId,
        workspaceName:         (workspaceNames as Record<number, string>)[partition.workspaceId],
        pressureScore:         partition.pressureScore.total,
        containmentStatus:     partition.containmentStatus,
        noisyBehaviorCodes:    partition.noisyBehaviorCodes as string[],
        advisoryPressureLevel: partition.advisoryPressureLevel,
        backlogDepth:          partition.delayedExecutionCount,
        activeExecutionCount:  partition.activeExecutionCount,
        advisoryWeight:        partition.schedulerWeight,
        activePolicyCount:     policyCountMap.get(partition.workspaceId) ?? 0,
        enforcementStatus:     bridge.enforcementStatus,
        effectiveWeight:       bridge.effectiveSchedulerWeight,
        conflictDetected:      bridge.enforcementStatus === "conflict",
        evaluationTime:        now,
      };
      return evaluateFailureContainment(input);
    });

    const overview = buildPlatformReliabilityOverview(containmentResults, captureId, now);

    // ── Step 3: Build snapshot value objects ──────────────────────────────────
    const snapshots = containmentResults.map(result =>
      buildSnapshot(captureId, result, now),
    );

    // ── Step 4: Fetch last snapshot per workspace for transition detection ────
    const workspaceIds = partitions.map(p => p.workspaceId);

    // For each workspace, get the most-recent previous snapshot
    const previousSnapshotsRaw = workspaceIds.length > 0
      ? await db.execute(
          sql`SELECT DISTINCT ON (workspace_id)
                snapshot_id, capture_id, workspace_id, domain_id,
                degradation_status, propagation_risk, containment_level,
                observability_health, blast_radius_score,
                advisory_storm_detected, affected_subsystems, captured_at
              FROM reliability_domain_snapshots
              WHERE workspace_id = ANY(${sql.raw(`ARRAY[${workspaceIds.join(",")}]`)})
                AND capture_id != ${captureId}
              ORDER BY workspace_id, captured_at DESC`,
        )
      : { rows: [] as unknown[] };

    type PrevRow = {
      snapshot_id: string; capture_id: string; workspace_id: number;
      domain_id: string; degradation_status: string; propagation_risk: string;
      containment_level: string; observability_health: string;
      blast_radius_score: number; advisory_storm_detected: boolean;
      affected_subsystems: string[] | null; captured_at: Date;
    };

    const prevMap = new Map<number, ReliabilityDomainSnapshot>();
    for (const row of (previousSnapshotsRaw.rows ?? []) as PrevRow[]) {
      prevMap.set(Number(row.workspace_id), {
        snapshotId:            row.snapshot_id,
        captureId:             row.capture_id,
        workspaceId:           Number(row.workspace_id),
        domainId:              row.domain_id,
        degradationStatus:     row.degradation_status as ReliabilityDomainSnapshot["degradationStatus"],
        propagationRisk:       row.propagation_risk    as ReliabilityDomainSnapshot["propagationRisk"],
        containmentLevel:      row.containment_level   as ReliabilityDomainSnapshot["containmentLevel"],
        observabilityHealth:   row.observability_health as ReliabilityDomainSnapshot["observabilityHealth"],
        blastRadiusScore:      Number(row.blast_radius_score),
        advisoryStormDetected: Boolean(row.advisory_storm_detected),
        affectedSubsystems:    Array.isArray(row.affected_subsystems) ? row.affected_subsystems : [],
        capturedAt:            new Date(row.captured_at).toISOString(),
      });
    }

    // ── Step 5: Persist snapshots to DB ───────────────────────────────────────
    if (snapshots.length > 0) {
      await db.insert(reliabilityDomainSnapshotsTable).values(
        snapshots.map(s => ({
          snapshotId:            s.snapshotId,
          captureId:             s.captureId,
          workspaceId:           s.workspaceId,
          domainId:              s.domainId,
          degradationStatus:     s.degradationStatus,
          propagationRisk:       s.propagationRisk,
          containmentLevel:      s.containmentLevel,
          observabilityHealth:   s.observabilityHealth,
          blastRadiusScore:      s.blastRadiusScore,
          advisoryStormDetected: s.advisoryStormDetected,
          affectedSubsystems:    s.affectedSubsystems,
          capturedAt:            now,
        })),
      );
    }

    for (const snap of snapshots) {
      emitReliabilitySnapshotPersistedEvent({
        snapshotId:        snap.snapshotId,
        captureId,
        workspaceId:       snap.workspaceId,
        degradationStatus: snap.degradationStatus,
        propagationRisk:   snap.propagationRisk,
        action:            "snapshot_persisted",
      });
    }

    // ── Step 6: Update incidents ──────────────────────────────────────────────
    const INCIDENT_OPEN = new Set(["severely_degraded", "containment_risk", "critical"]);

    for (const snap of snapshots) {
      const isIncidentLevel = INCIDENT_OPEN.has(snap.degradationStatus);

      // Check for an open incident for this workspace
      const [existingIncident] = await db
        .select()
        .from(reliabilityIncidentsTable)
        .where(
          and(
            eq(reliabilityIncidentsTable.workspaceId, snap.workspaceId),
            or(
              eq(reliabilityIncidentsTable.incidentStatus, "active"),
              eq(reliabilityIncidentsTable.incidentStatus, "recovering"),
            ),
          ),
        )
        .limit(1);

      if (isIncidentLevel) {
        if (!existingIncident) {
          // Open new incident
          const incidentId = makeIncidentId(snap.workspaceId);
          await db.insert(reliabilityIncidentsTable).values({
            incidentId,
            workspaceId:         snap.workspaceId,
            startedAt:           now,
            lastObservedAt:      now,
            highestSeverity:     snap.degradationStatus,
            peakPropagationRisk: snap.propagationRisk,
            incidentStatus:      "active",
            advisoryStormCount:  snap.advisoryStormDetected ? 1 : 0,
            snapshotCount:       1,
          });
          emitIncidentTimelineUpdatedEvent({
            workspaceId: snap.workspaceId, incidentId,
            incidentStatus: "active", highestSeverity: snap.degradationStatus,
            action: "incident_opened",
          });
        } else {
          // Update existing incident
          const newSeverityIdx =
            { healthy: 0, degraded: 1, severely_degraded: 2, containment_risk: 3, critical: 4 };
          const currentHighest = existingIncident.highestSeverity;
          const newHighest =
            (newSeverityIdx[snap.degradationStatus as keyof typeof newSeverityIdx] ?? 0) >
            (newSeverityIdx[currentHighest as keyof typeof newSeverityIdx] ?? 0)
              ? snap.degradationStatus
              : currentHighest;
          await db
            .update(reliabilityIncidentsTable)
            .set({
              lastObservedAt:      now,
              highestSeverity:     newHighest,
              incidentStatus:      "active",
              snapshotCount:       existingIncident.snapshotCount + 1,
              advisoryStormCount:  existingIncident.advisoryStormCount + (snap.advisoryStormDetected ? 1 : 0),
            })
            .where(eq(reliabilityIncidentsTable.id, existingIncident.id));
        }
      } else if (existingIncident) {
        // Degraded or healthy - update incident status
        const newStatus = snap.degradationStatus === "healthy" ? "resolved" : "recovering";
        await db
          .update(reliabilityIncidentsTable)
          .set({
            lastObservedAt: now,
            incidentStatus: newStatus,
            ...(newStatus === "resolved" ? { resolvedAt: now } : {}),
          })
          .where(eq(reliabilityIncidentsTable.id, existingIncident.id));
        emitIncidentTimelineUpdatedEvent({
          workspaceId: snap.workspaceId,
          incidentId:  existingIncident.incidentId,
          incidentStatus: newStatus as "resolved" | "recovering",
          highestSeverity: existingIncident.highestSeverity as ReliabilityDomainSnapshot["degradationStatus"],
          action: `incident_${newStatus}`,
        });
      }
    }

    res.json({
      captureId,
      snapshotCount: snapshots.length,
      overview,
    });
  },
);

// ── GET /platform/reliability/history ────────────────────────────────────────
// Returns paginated reliability domain snapshots from the DB.
// Query params: limit? (default 50, max 200), offset? (default 0), workspaceId?

router.get(
  "/platform/reliability/history",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const limit      = Math.min(200, Math.max(1, parseInt(String(req.query["limit"]  ?? "50"), 10)  || 50));
    const offset     = Math.max(0, parseInt(String(req.query["offset"] ?? "0"),  10)  || 0);
    const wsFilter   = req.query["workspaceId"] ? parseInt(String(req.query["workspaceId"]), 10) : undefined;

    const whereClause = wsFilter
      ? eq(reliabilityDomainSnapshotsTable.workspaceId, wsFilter)
      : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(reliabilityDomainSnapshotsTable)
        .where(whereClause)
        .orderBy(desc(reliabilityDomainSnapshotsTable.capturedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(reliabilityDomainSnapshotsTable)
        .where(whereClause),
    ]);

    const snapshots: ReliabilityDomainSnapshot[] = rows.map(r => ({
      snapshotId:            r.snapshotId,
      captureId:             r.captureId,
      workspaceId:           r.workspaceId,
      domainId:              r.domainId,
      degradationStatus:     r.degradationStatus as ReliabilityDomainSnapshot["degradationStatus"],
      propagationRisk:       r.propagationRisk    as ReliabilityDomainSnapshot["propagationRisk"],
      containmentLevel:      r.containmentLevel   as ReliabilityDomainSnapshot["containmentLevel"],
      observabilityHealth:   r.observabilityHealth as ReliabilityDomainSnapshot["observabilityHealth"],
      blastRadiusScore:      r.blastRadiusScore,
      advisoryStormDetected: r.advisoryStormDetected,
      affectedSubsystems:    Array.isArray(r.affectedSubsystems) ? (r.affectedSubsystems as string[]) : [],
      capturedAt:            r.capturedAt.toISOString(),
    }));

    res.json({ snapshots, total: Number(total), limit, offset });
  },
);

// ── GET /platform/reliability/incidents ──────────────────────────────────────
// Returns incident timelines reconstructed from recent DB snapshots.
// Query params: status? ("active"|"recovering"|"resolved"), workspaceId?,
//              limit? (default 50)

router.get(
  "/platform/reliability/incidents",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const statusFilter = req.query["status"] as string | undefined;
    const wsFilter     = req.query["workspaceId"] ? parseInt(String(req.query["workspaceId"]), 10) : undefined;
    const limit        = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));

    // Build where clause for incidents query
    const conditions = [];
    if (statusFilter && ["active", "recovering", "resolved"].includes(statusFilter)) {
      conditions.push(eq(reliabilityIncidentsTable.incidentStatus, statusFilter));
    }
    if (wsFilter) {
      conditions.push(eq(reliabilityIncidentsTable.workspaceId, wsFilter));
    }
    const whereClause = conditions.length > 0
      ? conditions.length === 1 ? conditions[0] : and(...conditions)
      : undefined;

    const [incidentRows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(reliabilityIncidentsTable)
        .where(whereClause)
        .orderBy(desc(reliabilityIncidentsTable.startedAt))
        .limit(limit),
      db.select({ total: count() }).from(reliabilityIncidentsTable).where(whereClause),
    ]);

    // For each open incident, fetch its recent snapshots for timeline reconstruction
    const openIncidentIds = incidentRows
      .filter(i => i.incidentStatus !== "resolved")
      .map(i => i.workspaceId);

    let recentSnapshots: ReliabilityDomainSnapshot[] = [];
    if (openIncidentIds.length > 0) {
      const recentRows = await db
        .select()
        .from(reliabilityDomainSnapshotsTable)
        .where(sql`workspace_id = ANY(ARRAY[${sql.raw(openIncidentIds.join(","))}]::integer[])`)
        .orderBy(desc(reliabilityDomainSnapshotsTable.capturedAt))
        .limit(500);

      recentSnapshots = recentRows.map(r => ({
        snapshotId:            r.snapshotId,
        captureId:             r.captureId,
        workspaceId:           r.workspaceId,
        domainId:              r.domainId,
        degradationStatus:     r.degradationStatus as ReliabilityDomainSnapshot["degradationStatus"],
        propagationRisk:       r.propagationRisk    as ReliabilityDomainSnapshot["propagationRisk"],
        containmentLevel:      r.containmentLevel   as ReliabilityDomainSnapshot["containmentLevel"],
        observabilityHealth:   r.observabilityHealth as ReliabilityDomainSnapshot["observabilityHealth"],
        blastRadiusScore:      r.blastRadiusScore,
        advisoryStormDetected: r.advisoryStormDetected,
        affectedSubsystems:    Array.isArray(r.affectedSubsystems) ? (r.affectedSubsystems as string[]) : [],
        capturedAt:            r.capturedAt.toISOString(),
      }));
    }

    // Reconstruct open incident timelines from snapshot history
    const reconstructed = buildIncidentTimelines(recentSnapshots);
    const reconstructedMap = new Map(reconstructed.map(t => [t.workspaceId, t]));

    // Merge DB incident metadata with pure-engine reconstruction
    const incidents = incidentRows.map(row => {
      const timeline = reconstructedMap.get(row.workspaceId);
      return {
        incidentId:          row.incidentId,
        workspaceId:         row.workspaceId,
        startedAt:           row.startedAt.toISOString(),
        lastObservedAt:      row.lastObservedAt.toISOString(),
        resolvedAt:          row.resolvedAt ? row.resolvedAt.toISOString() : null,
        highestSeverity:     row.highestSeverity,
        peakPropagationRisk: row.peakPropagationRisk,
        incidentStatus:      row.incidentStatus,
        snapshotCount:       row.snapshotCount,
        advisoryStormCount:  row.advisoryStormCount,
        escalationMoments:   timeline?.escalationMoments ?? [],
        recoveryMoments:     timeline?.recoveryMoments ?? [],
        durationMinutes:     row.resolvedAt
          ? Math.round((row.resolvedAt.getTime() - row.startedAt.getTime()) / 60_000)
          : null,
      };
    });

    res.json({ incidents, total: Number(total) });
  },
);

// ── GET /platform/reliability/slo-status ─────────────────────────────────────
// Evaluates all 4 platform SLOs from recent snapshot history.
// Query params: windowHours? (default 24)

router.get(
  "/platform/reliability/slo-status",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const windowHours = Math.min(168, Math.max(1,
      parseInt(String(req.query["windowHours"] ?? "24"), 10) || 24,
    ));
    const now     = new Date();
    const cutoff  = new Date(now.getTime() - windowHours * 3_600_000);

    // Fetch snapshots within the window
    const rows = await db
      .select()
      .from(reliabilityDomainSnapshotsTable)
      .where(sql`captured_at >= ${cutoff}`)
      .orderBy(desc(reliabilityDomainSnapshotsTable.capturedAt))
      .limit(2000);

    const snapshots: ReliabilityDomainSnapshot[] = rows.map(r => ({
      snapshotId:            r.snapshotId,
      captureId:             r.captureId,
      workspaceId:           r.workspaceId,
      domainId:              r.domainId,
      degradationStatus:     r.degradationStatus as ReliabilityDomainSnapshot["degradationStatus"],
      propagationRisk:       r.propagationRisk    as ReliabilityDomainSnapshot["propagationRisk"],
      containmentLevel:      r.containmentLevel   as ReliabilityDomainSnapshot["containmentLevel"],
      observabilityHealth:   r.observabilityHealth as ReliabilityDomainSnapshot["observabilityHealth"],
      blastRadiusScore:      r.blastRadiusScore,
      advisoryStormDetected: r.advisoryStormDetected,
      affectedSubsystems:    Array.isArray(r.affectedSubsystems) ? (r.affectedSubsystems as string[]) : [],
      capturedAt:            r.capturedAt.toISOString(),
    }));

    const report = evaluatePlatformSLOs(snapshots, now);

    res.json({ slo: report });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P10-C RECOVERY RECOMMENDATION ROUTES (super_admin only)
// ─────────────────────────────────────────────────────────────────────────────

// Helper: map a DB incident row to an IncidentSummary for the pure engine
function rowToIncidentSummary(row: {
  incidentId: string; workspaceId: number; startedAt: Date;
  resolvedAt: Date | null; highestSeverity: string;
  peakPropagationRisk: string; incidentStatus: string;
  advisoryStormCount: number; snapshotCount: number;
}): IncidentSummary {
  const started   = row.startedAt.getTime();
  const resolved  = row.resolvedAt ? row.resolvedAt.getTime() : null;
  return {
    incidentId:          row.incidentId,
    workspaceId:         row.workspaceId,
    startedAt:           row.startedAt.toISOString(),
    resolvedAt:          row.resolvedAt ? row.resolvedAt.toISOString() : null,
    highestSeverity:     row.highestSeverity    as IncidentSummary["highestSeverity"],
    peakPropagationRisk: row.peakPropagationRisk as IncidentSummary["peakPropagationRisk"],
    incidentStatus:      row.incidentStatus      as IncidentSummary["incidentStatus"],
    advisoryStormCount:  row.advisoryStormCount,
    snapshotCount:       row.snapshotCount,
    escalationCount:     0,   // not stored in DB - set from context where available
    durationMinutes:     resolved !== null ? Math.round((resolved - started) / 60_000) : null,
  };
}

// Helper: map DB snapshot rows for a workspace to a maxBlastRadiusScore
function maxBlastRadius(rows: { blastRadiusScore: number }[]): number {
  return rows.reduce((m, r) => Math.max(m, r.blastRadiusScore), 0);
}

// ── GET /platform/reliability/recommendations ─────────────────────────────────
// Generates recovery recommendations for all active/recovering incidents.
// Query params: workspaceId? (filter), limit? (default 20)

router.get(
  "/platform/reliability/recommendations",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const wsFilter = req.query["workspaceId"] ? parseInt(String(req.query["workspaceId"]), 10) : undefined;
    const limit    = Math.min(50, Math.max(1, parseInt(String(req.query["limit"] ?? "20"), 10) || 20));

    // ── Step 1: Fetch open incidents ──────────────────────────────────────────
    const openConditions = wsFilter
      ? and(
          eq(reliabilityIncidentsTable.workspaceId, wsFilter),
          or(
            eq(reliabilityIncidentsTable.incidentStatus, "active"),
            eq(reliabilityIncidentsTable.incidentStatus, "recovering"),
          ),
        )
      : or(
          eq(reliabilityIncidentsTable.incidentStatus, "active"),
          eq(reliabilityIncidentsTable.incidentStatus, "recovering"),
        );

    const openRows = await db
      .select()
      .from(reliabilityIncidentsTable)
      .where(openConditions)
      .orderBy(desc(reliabilityIncidentsTable.startedAt))
      .limit(limit);

    if (openRows.length === 0) {
      res.json({ recommendations: [], incidentCount: 0 });
      return;
    }

    // ── Step 2: For each open incident, get prior incidents + recent snapshots ─
    const allRecommendations = await Promise.all(
      openRows.map(async (row) => {
        const [priorRows, snapRows] = await Promise.all([
          db
            .select()
            .from(reliabilityIncidentsTable)
            .where(
              and(
                eq(reliabilityIncidentsTable.workspaceId, row.workspaceId),
                eq(reliabilityIncidentsTable.incidentStatus, "resolved"),
              ),
            )
            .orderBy(desc(reliabilityIncidentsTable.startedAt))
            .limit(20),
          db
            .select({ blastRadiusScore: reliabilityDomainSnapshotsTable.blastRadiusScore })
            .from(reliabilityDomainSnapshotsTable)
            .where(
              and(
                eq(reliabilityDomainSnapshotsTable.workspaceId, row.workspaceId),
                sql`captured_at >= ${row.startedAt}`,
              ),
            )
            .limit(50),
        ]);

        const prior   = priorRows.map(rowToIncidentSummary);
        const history = buildWorkspaceIncidentHistory(prior);
        const ctx: RecommendationContext = {
          incidentId:          row.incidentId,
          workspaceId:         row.workspaceId,
          highestSeverity:     row.highestSeverity     as RecommendationContext["highestSeverity"],
          peakPropagationRisk: row.peakPropagationRisk as RecommendationContext["peakPropagationRisk"],
          incidentStatus:      row.incidentStatus      as RecommendationContext["incidentStatus"],
          advisoryStormCount:  row.advisoryStormCount,
          escalationCount:     0,
          recoveryCount:       0,
          durationMinutes:     null,
          snapshotCount:       row.snapshotCount,
          maxBlastRadiusScore: maxBlastRadius(snapRows),
          startedAt:           row.startedAt.toISOString(),
        };
        return generateRecoveryRecommendations(ctx, history);
      }),
    );

    const recommendations = allRecommendations.flat();
    res.json({ recommendations, incidentCount: openRows.length });
  },
);

// ── GET /platform/reliability/recommendations/:incidentId ─────────────────────
// Returns recommendations for a specific incident with workspace trend context.

router.get(
  "/platform/reliability/recommendations/:incidentId",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const { incidentId } = req.params as { incidentId: string };

    // Fetch the target incident
    const [incRow] = await db
      .select()
      .from(reliabilityIncidentsTable)
      .where(eq(reliabilityIncidentsTable.incidentId, incidentId))
      .limit(1);

    if (!incRow) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }

    // Fetch prior incidents + recent snapshots (parallel)
    const [priorRows, snapRows] = await Promise.all([
      db
        .select()
        .from(reliabilityIncidentsTable)
        .where(
          and(
            eq(reliabilityIncidentsTable.workspaceId, incRow.workspaceId),
            sql`incident_id != ${incidentId}`,
          ),
        )
        .orderBy(desc(reliabilityIncidentsTable.startedAt))
        .limit(30),
      db
        .select({ blastRadiusScore: reliabilityDomainSnapshotsTable.blastRadiusScore })
        .from(reliabilityDomainSnapshotsTable)
        .where(
          and(
            eq(reliabilityDomainSnapshotsTable.workspaceId, incRow.workspaceId),
            sql`captured_at >= ${incRow.startedAt}`,
          ),
        )
        .limit(100),
    ]);

    const prior   = priorRows.map(rowToIncidentSummary);
    const history = buildWorkspaceIncidentHistory(prior);

    const started  = incRow.startedAt.getTime();
    const resolved = incRow.resolvedAt ? incRow.resolvedAt.getTime() : null;

    const ctx: RecommendationContext = {
      incidentId:          incRow.incidentId,
      workspaceId:         incRow.workspaceId,
      highestSeverity:     incRow.highestSeverity     as RecommendationContext["highestSeverity"],
      peakPropagationRisk: incRow.peakPropagationRisk as RecommendationContext["peakPropagationRisk"],
      incidentStatus:      incRow.incidentStatus      as RecommendationContext["incidentStatus"],
      advisoryStormCount:  incRow.advisoryStormCount,
      escalationCount:     0,
      recoveryCount:       0,
      durationMinutes:     resolved !== null ? Math.round((resolved - started) / 60_000) : null,
      snapshotCount:       incRow.snapshotCount,
      maxBlastRadiusScore: maxBlastRadius(snapRows),
      startedAt:           incRow.startedAt.toISOString(),
    };

    const recommendations = generateRecoveryRecommendations(ctx, history);

    // Build workspace trend from all incidents (prior + current)
    const allIncidents = [rowToIncidentSummary(incRow), ...prior];
    const workspaceTrend = {
      totalIncidents:          allIncidents.length,
      openIncidents:           allIncidents.filter(i => i.incidentStatus !== "resolved").length,
      mttrMinutes:             history.avgDurationMinutesResolved,
      advisoryStormRecurrence: history.priorWithAdvisoryStorms > 1,
      cascadingRiskRecurrence: history.priorWithCascadingRisk > 1,
      isChronicallyDegraded:   allIncidents.length >= 3,
      recurrenceInterval:      history.recurrenceInterval,
    };

    res.json({
      recommendations,
      incident: {
        incidentId:          incRow.incidentId,
        workspaceId:         incRow.workspaceId,
        startedAt:           incRow.startedAt.toISOString(),
        lastObservedAt:      incRow.lastObservedAt.toISOString(),
        resolvedAt:          incRow.resolvedAt ? incRow.resolvedAt.toISOString() : null,
        highestSeverity:     incRow.highestSeverity,
        peakPropagationRisk: incRow.peakPropagationRisk,
        incidentStatus:      incRow.incidentStatus,
        snapshotCount:       incRow.snapshotCount,
        advisoryStormCount:  incRow.advisoryStormCount,
      },
      workspaceTrend,
    });
  },
);

// ── GET /platform/reliability/trends ─────────────────────────────────────────
// Returns platform-wide reliability trend analysis from incident history.
// Query params: windowDays? (default 30, max 90)

router.get(
  "/platform/reliability/trends",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const windowDays = Math.min(90, Math.max(1,
      parseInt(String(req.query["windowDays"] ?? "30"), 10) || 30,
    ));
    const now    = new Date();
    const cutoff = new Date(now.getTime() - windowDays * 24 * 3_600_000);

    const rows = await db
      .select()
      .from(reliabilityIncidentsTable)
      .where(sql`started_at >= ${cutoff}`)
      .orderBy(desc(reliabilityIncidentsTable.startedAt))
      .limit(1000);

    const incidents: IncidentSummary[] = rows.map(rowToIncidentSummary);
    const report = buildPlatformTrendReport(incidents, windowDays, now);

    res.json({ trends: report });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P10-D RECOVERY ORCHESTRATION ROUTES (super_admin only)
// ─────────────────────────────────────────────────────────────────────────────

// Helper: map a DB orchestration row to a plain API-safe object
function rowToOrchestrationDto(row: typeof recoveryOrchestrationActionsTable.$inferSelect) {
  return {
    actionId:            row.actionId,
    workspaceId:         row.workspaceId,
    incidentId:          row.incidentId,
    recommendationId:    row.recommendationId ?? null,
    orchestrationType:   row.orchestrationType,
    initiatedBy:         row.initiatedBy,
    initiatedAt:         row.initiatedAt.toISOString(),
    orchestrationStatus: row.orchestrationStatus,
    acknowledgedBy:      row.acknowledgedBy ?? null,
    acknowledgedAt:      row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    resolvedBy:          row.resolvedBy ?? null,
    resolvedAt:          row.resolvedAt ? row.resolvedAt.toISOString() : null,
    rollbackEligible:    row.rollbackEligible,
    rolledBackBy:        row.rolledBackBy ?? null,
    rolledBackAt:        row.rolledBackAt ? row.rolledBackAt.toISOString() : null,
    cancelledBy:         row.cancelledBy ?? null,
    cancelledAt:         row.cancelledAt ? row.cancelledAt.toISOString() : null,
    relatedSignals:      (row.relatedSignals as string[]) ?? [],
    executionNotes:      row.executionNotes ?? null,
    createdAt:           row.createdAt.toISOString(),
    updatedAt:           row.updatedAt.toISOString(),
  };
}

// ── POST /platform/reliability/orchestrations ─────────────────────────────────
// Operator initiates a recovery orchestration action.
// Body: { workspaceId, incidentId, orchestrationType, initiatedBy,
//         recommendationId?, relatedSignals?, executionNotes? }

router.post(
  "/platform/reliability/orchestrations",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const {
      workspaceId,
      incidentId,
      orchestrationType,
      initiatedBy,
      recommendationId,
      relatedSignals,
      executionNotes,
    } = req.body as {
      workspaceId:       number;
      incidentId:        string;
      orchestrationType: RecoveryOrchestrationType;
      initiatedBy:       string;
      recommendationId?: string;
      relatedSignals?:   string[];
      executionNotes?:   string;
    };

    // ── Duplicate check ───────────────────────────────────────────────────────
    const existingActive = await db
      .select({ orchestrationType: recoveryOrchestrationActionsTable.orchestrationType,
                orchestrationStatus: recoveryOrchestrationActionsTable.orchestrationStatus,
                actionId: recoveryOrchestrationActionsTable.actionId })
      .from(recoveryOrchestrationActionsTable)
      .where(
        and(
          eq(recoveryOrchestrationActionsTable.workspaceId, workspaceId),
          eq(recoveryOrchestrationActionsTable.orchestrationType, orchestrationType),
          sql`orchestration_status IN ('initiated', 'acknowledged', 'in_review')`,
        ),
      )
      .limit(1);

    if (existingActive.length > 0) {
      res.status(409).json({
        error: "ORCH_DUPLICATE",
        message: `An active orchestration of type "${orchestrationType}" already exists for this workspace.`,
        conflictingActionId: existingActive[0]!.actionId,
      });
      return;
    }

    // ── Build value object via pure engine ────────────────────────────────────
    let action;
    try {
      action = buildOrchestrationAction({
        workspaceId,
        incidentId,
        orchestrationType,
        initiatedBy,
        recommendationId: recommendationId ?? null,
        relatedSignals:   relatedSignals ?? [],
        executionNotes:   executionNotes ?? null,
      });
    } catch (err: unknown) {
      const e = err as { message: string; code?: string };
      res.status(400).json({ error: e.code ?? "ORCH_VALIDATION", message: e.message });
      return;
    }

    // ── Persist ───────────────────────────────────────────────────────────────
    const [row] = await db
      .insert(recoveryOrchestrationActionsTable)
      .values({
        actionId:            action.actionId,
        workspaceId:         action.workspaceId,
        incidentId:          action.incidentId,
        recommendationId:    action.recommendationId ?? undefined,
        orchestrationType:   action.orchestrationType,
        initiatedBy:         action.initiatedBy,
        initiatedAt:         new Date(action.initiatedAt),
        orchestrationStatus: action.orchestrationStatus,
        rollbackEligible:    action.rollbackEligible,
        relatedSignals:      action.relatedSignals,
        executionNotes:      action.executionNotes ?? undefined,
      })
      .returning();

    res.status(201).json({ action: rowToOrchestrationDto(row!) });
  },
);

// ── POST /platform/reliability/orchestrations/:id/acknowledge ─────────────────
// Operator acknowledges an initiated orchestration.
// Body: { acknowledgedBy, notes? }

router.post(
  "/platform/reliability/orchestrations/:id/acknowledge",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const { id }            = req.params as { id: string };
    const { acknowledgedBy, notes } = req.body as { acknowledgedBy: string; notes?: string };

    if (!acknowledgedBy?.trim()) {
      res.status(400).json({ error: "ORCH_VALIDATION", message: "acknowledgedBy is required." });
      return;
    }

    const [row] = await db
      .select()
      .from(recoveryOrchestrationActionsTable)
      .where(eq(recoveryOrchestrationActionsTable.actionId, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Orchestration action not found." });
      return;
    }

    const validation = validateOrchestrationTransition(
      row.orchestrationStatus as RecoveryOrchestrationStatus,
      "acknowledged",
    );
    if (!validation.valid) {
      res.status(409).json({ error: validation.errorCode, message: validation.errorMsg });
      return;
    }

    if (!canAcknowledge(row.orchestrationStatus as RecoveryOrchestrationStatus)) {
      res.status(409).json({ error: "ORCH_TRANSITION_DENIED", message: "Cannot acknowledge from current status." });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(recoveryOrchestrationActionsTable)
      .set({
        orchestrationStatus: "acknowledged",
        acknowledgedBy:      acknowledgedBy.trim(),
        acknowledgedAt:      now,
        executionNotes:      notes ? (row.executionNotes ? `${row.executionNotes}\n${notes}` : notes) : row.executionNotes,
        updatedAt:           now,
      })
      .where(eq(recoveryOrchestrationActionsTable.actionId, id))
      .returning();

    emitOrchestrationAcknowledgedEvent({
      actionId:            row.actionId,
      workspaceId:         row.workspaceId,
      incidentId:          row.incidentId,
      orchestrationType:   row.orchestrationType as RecoveryOrchestrationType,
      orchestrationStatus: "acknowledged",
      initiatedBy:         row.initiatedBy,
      action:              "orchestration_acknowledged",
    });

    res.json({ action: rowToOrchestrationDto(updated!) });
  },
);

// ── POST /platform/reliability/orchestrations/:id/resolve ─────────────────────
// Operator resolves (concludes) an orchestration that is in_review or acknowledged.
// Body: { resolvedBy, notes? }

router.post(
  "/platform/reliability/orchestrations/:id/resolve",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const { id }          = req.params as { id: string };
    const { resolvedBy, notes } = req.body as { resolvedBy: string; notes?: string };

    if (!resolvedBy?.trim()) {
      res.status(400).json({ error: "ORCH_VALIDATION", message: "resolvedBy is required." });
      return;
    }

    const [row] = await db
      .select()
      .from(recoveryOrchestrationActionsTable)
      .where(eq(recoveryOrchestrationActionsTable.actionId, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Orchestration action not found." });
      return;
    }

    // Allow resolve from acknowledged (convenience - skips in_review) or in_review
    const currentStatus = row.orchestrationStatus as RecoveryOrchestrationStatus;
    const targetStatus: RecoveryOrchestrationStatus = "resolved";

    // If acknowledged, auto-advance to in_review first via two-step resolve
    let effectiveStatus = currentStatus;
    if (currentStatus === "acknowledged") {
      const stepValidation = validateOrchestrationTransition(currentStatus, "in_review");
      if (!stepValidation.valid) {
        res.status(409).json({ error: stepValidation.errorCode, message: stepValidation.errorMsg });
        return;
      }
      effectiveStatus = "in_review";
    }

    const validation = validateOrchestrationTransition(effectiveStatus, targetStatus);
    if (!validation.valid) {
      res.status(409).json({ error: validation.errorCode, message: validation.errorMsg });
      return;
    }

    if (!canResolve(effectiveStatus)) {
      res.status(409).json({ error: "ORCH_TRANSITION_DENIED", message: "Cannot resolve from current status." });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(recoveryOrchestrationActionsTable)
      .set({
        orchestrationStatus: "resolved",
        resolvedBy:          resolvedBy.trim(),
        resolvedAt:          now,
        rollbackEligible:    false,    // resolved actions cannot be rolled back
        executionNotes:      notes ? (row.executionNotes ? `${row.executionNotes}\n${notes}` : notes) : row.executionNotes,
        updatedAt:           now,
      })
      .where(eq(recoveryOrchestrationActionsTable.actionId, id))
      .returning();

    emitOrchestrationResolvedEvent({
      actionId:            row.actionId,
      workspaceId:         row.workspaceId,
      incidentId:          row.incidentId,
      orchestrationType:   row.orchestrationType as RecoveryOrchestrationType,
      orchestrationStatus: "resolved",
      initiatedBy:         row.initiatedBy,
      action:              "orchestration_resolved",
    });

    res.json({ action: rowToOrchestrationDto(updated!) });
  },
);

// ── POST /platform/reliability/orchestrations/:id/rollback ────────────────────
// Operator rolls back an in_review orchestration.
// Body: { rolledBackBy, notes? }

router.post(
  "/platform/reliability/orchestrations/:id/rollback",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const { id }             = req.params as { id: string };
    const { rolledBackBy, notes } = req.body as { rolledBackBy: string; notes?: string };

    if (!rolledBackBy?.trim()) {
      res.status(400).json({ error: "ORCH_VALIDATION", message: "rolledBackBy is required." });
      return;
    }

    const [row] = await db
      .select()
      .from(recoveryOrchestrationActionsTable)
      .where(eq(recoveryOrchestrationActionsTable.actionId, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Orchestration action not found." });
      return;
    }

    const currentStatus = row.orchestrationStatus as RecoveryOrchestrationStatus;
    const validation    = validateOrchestrationTransition(currentStatus, "rolled_back", row.rollbackEligible);
    if (!validation.valid) {
      res.status(409).json({ error: validation.errorCode, message: validation.errorMsg });
      return;
    }

    if (!canRollBack(currentStatus, row.rollbackEligible)) {
      res.status(409).json({ error: "ORCH_ROLLBACK_INELIGIBLE", message: "Cannot roll back from current status or rollback is not eligible." });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(recoveryOrchestrationActionsTable)
      .set({
        orchestrationStatus: "rolled_back",
        rolledBackBy:        rolledBackBy.trim(),
        rolledBackAt:        now,
        rollbackEligible:    false,   // prevent double-rollback
        executionNotes:      notes ? (row.executionNotes ? `${row.executionNotes}\n${notes}` : notes) : row.executionNotes,
        updatedAt:           now,
      })
      .where(eq(recoveryOrchestrationActionsTable.actionId, id))
      .returning();

    emitOrchestrationRolledBackEvent({
      actionId:            row.actionId,
      workspaceId:         row.workspaceId,
      incidentId:          row.incidentId,
      orchestrationType:   row.orchestrationType as RecoveryOrchestrationType,
      orchestrationStatus: "rolled_back",
      initiatedBy:         row.initiatedBy,
      action:              "orchestration_rolled_back",
    });

    res.json({ action: rowToOrchestrationDto(updated!) });
  },
);

// ── GET /platform/reliability/orchestrations ──────────────────────────────────
// Lists recovery orchestration actions with optional filters.
// Query params: workspaceId?, status?, orchestrationType?, limit (default 50), offset (default 0)

router.get(
  "/platform/reliability/orchestrations",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const wsFilter    = req.query["workspaceId"]
      ? parseInt(String(req.query["workspaceId"]), 10) : undefined;
    const statusFilter = req.query["status"]
      ? String(req.query["status"]) as RecoveryOrchestrationStatus : undefined;
    const typeFilter  = req.query["orchestrationType"]
      ? String(req.query["orchestrationType"]) as RecoveryOrchestrationType : undefined;
    const activeOnly  = req.query["activeOnly"] === "true";
    const limit  = Math.min(100, Math.max(1, parseInt(String(req.query["limit"]  ?? "50"), 10) || 50));
    const offset = Math.max(0, parseInt(String(req.query["offset"] ?? "0"),  10) || 0);

    const conditions = [];
    if (wsFilter)     conditions.push(eq(recoveryOrchestrationActionsTable.workspaceId,       wsFilter));
    if (statusFilter) conditions.push(eq(recoveryOrchestrationActionsTable.orchestrationStatus, statusFilter));
    if (typeFilter)   conditions.push(eq(recoveryOrchestrationActionsTable.orchestrationType,   typeFilter));
    if (activeOnly) {
      conditions.push(
        sql`orchestration_status IN (${sql.join(
          [...ACTIVE_ORCHESTRATION_STATUSES].map(s => sql`${s}`), sql`, `,
        )})`,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countRows] = await Promise.all([
      db
        .select()
        .from(recoveryOrchestrationActionsTable)
        .where(where)
        .orderBy(desc(recoveryOrchestrationActionsTable.initiatedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(recoveryOrchestrationActionsTable)
        .where(where),
    ]);

    res.json({
      actions: rows.map(rowToOrchestrationDto),
      total:   countRows[0]?.count ?? 0,
      limit,
      offset,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P10-E - Remediation Execution Attempts
// ─────────────────────────────────────────────────────────────────────────────

function rowToExecutionDto(row: typeof remediationExecutionAttemptsTable.$inferSelect) {
  return {
    executionId:       row.executionId,
    actionId:          row.actionId,
    workspaceId:       row.workspaceId,
    executionType:     row.executionType as RemediationExecutionType,
    confirmationMode:  row.confirmationMode,
    initiatedBy:       row.initiatedBy,
    confirmedBy:       row.confirmedBy ?? null,
    confirmedAt:       row.confirmedAt?.toISOString() ?? null,
    executedAt:        row.executedAt?.toISOString() ?? null,
    executionStatus:   row.executionStatus as RemediationExecutionStatus,
    rollbackStatus:    row.rollbackStatus as RemediationRollbackStatus,
    executionEvidence: (row.executionEvidence as string[]) ?? [],
    executionNotes:    row.executionNotes ?? null,
    completedAt:       row.completedAt?.toISOString() ?? null,
    rolledBackAt:      row.rolledBackAt?.toISOString() ?? null,
    abandonedAt:       row.abandonedAt?.toISOString() ?? null,
    createdAt:         row.createdAt.toISOString(),
    updatedAt:         row.updatedAt.toISOString(),
  };
}

// POST /platform/reliability/executions
// Create a new remediation execution attempt (pending_confirmation)
router.post(
  "/platform/reliability/executions",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const {
      actionId,
      workspaceId,
      executionType,
      initiatedBy,
      executionEvidence,
      executionNotes,
    } = req.body as {
      actionId:          string;
      workspaceId:       number;
      executionType:     RemediationExecutionType;
      initiatedBy:       string;
      executionEvidence?: string[];
      executionNotes?:   string | null;
    };

    // ── Pure engine validation ───────────────────────────────────────────────
    let attempt;
    try {
      attempt = buildExecutionAttempt({
        actionId,
        workspaceId:       Number(workspaceId),
        executionType,
        initiatedBy,
        executionEvidence: executionEvidence ?? [],
        executionNotes:    executionNotes ?? null,
      });
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      return res.status(400).json({ error: e.code ?? "EXEC_VALIDATION", message: e.message });
    }

    // ── Duplicate check ──────────────────────────────────────────────────────
    const activeRows = await db
      .select({ executionId: remediationExecutionAttemptsTable.executionId, actionId: remediationExecutionAttemptsTable.actionId, executionStatus: remediationExecutionAttemptsTable.executionStatus })
      .from(remediationExecutionAttemptsTable)
      .where(
        and(
          eq(remediationExecutionAttemptsTable.actionId, attempt.actionId),
          inArray(
            remediationExecutionAttemptsTable.executionStatus,
            [...ACTIVE_EXECUTION_STATUSES] as string[],
          ),
        ),
      );

    if (activeRows.length > 0) {
      return res.status(409).json({
        error:                    "EXEC_DUPLICATE",
        message:                  `Action "${attempt.actionId}" already has an active execution attempt.`,
        conflictingExecutionId:   activeRows[0]?.executionId,
      });
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    const [inserted] = await db
      .insert(remediationExecutionAttemptsTable)
      .values({
        executionId:       attempt.executionId,
        actionId:          attempt.actionId,
        workspaceId:       attempt.workspaceId,
        executionType:     attempt.executionType,
        confirmationMode:  attempt.confirmationMode,
        initiatedBy:       attempt.initiatedBy,
        confirmedBy:       null,
        confirmedAt:       null,
        executedAt:        null,
        executionStatus:   attempt.executionStatus,
        rollbackStatus:    attempt.rollbackStatus,
        executionEvidence: attempt.executionEvidence,
        executionNotes:    attempt.executionNotes ?? null,
      })
      .returning();

    if (!inserted) {
      return res.status(500).json({ error: "EXEC_INSERT_FAILED", message: "Failed to create execution attempt." });
    }

    return res.status(201).json({ execution: rowToExecutionDto(inserted) });
  },
);

// POST /platform/reliability/executions/:id/confirm
// Operator explicitly confirms the execution attempt
router.post(
  "/platform/reliability/executions/:id/confirm",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const { id }          = req.params as { id: string };
    const { confirmedBy, notes } = req.body as { confirmedBy: string; notes?: string };

    const [existing] = await db
      .select()
      .from(remediationExecutionAttemptsTable)
      .where(eq(remediationExecutionAttemptsTable.executionId, id));

    if (!existing) {
      return res.status(404).json({ error: "EXEC_NOT_FOUND", message: `Execution "${id}" not found.` });
    }

    // ── Confirmation validation ──────────────────────────────────────────────
    const confirmation = confirmRemediationExecution(
      { executionStatus: existing.executionStatus as RemediationExecutionStatus, confirmationMode: existing.confirmationMode as "explicit" },
      confirmedBy ?? "",
    );
    if (!confirmation.valid) {
      return res.status(409).json({ error: confirmation.errorCode, message: confirmation.errorMsg });
    }

    // ── Transition validation ────────────────────────────────────────────────
    const transition = validateExecutionTransition(
      existing.executionStatus as RemediationExecutionStatus,
      "confirmed",
    );
    if (!transition.valid) {
      return res.status(409).json({ error: transition.errorCode, message: transition.errorMsg });
    }

    const now = new Date();
    const appendedNotes = notes
      ? (existing.executionNotes ? `${existing.executionNotes}\n${notes}` : notes)
      : existing.executionNotes;

    const [updated] = await db
      .update(remediationExecutionAttemptsTable)
      .set({
        executionStatus: "confirmed",
        confirmedBy:     confirmedBy.trim(),
        confirmedAt:     now,
        executionNotes:  appendedNotes,
        updatedAt:       now,
      })
      .where(eq(remediationExecutionAttemptsTable.executionId, id))
      .returning();

    if (!updated) {
      return res.status(500).json({ error: "EXEC_UPDATE_FAILED", message: "Failed to confirm execution." });
    }

    emitExecutionConfirmedEvent({
      executionId:     updated.executionId,
      actionId:        updated.actionId,
      workspaceId:     updated.workspaceId,
      executionType:   updated.executionType as RemediationExecutionType,
      executionStatus: "confirmed",
      confirmedBy:     updated.confirmedBy ?? "",
      action:          "execution_confirmed",
    });

    return res.json({ execution: rowToExecutionDto(updated) });
  },
);

// POST /platform/reliability/executions/:id/complete
// Operator marks the execution as completed
router.post(
  "/platform/reliability/executions/:id/complete",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const { id }         = req.params as { id: string };
    const { completedBy, rollbackStatus, notes, executionEvidence } = req.body as {
      completedBy:        string;
      rollbackStatus?:    RemediationRollbackStatus;
      notes?:             string;
      executionEvidence?: string[];
    };

    const [existing] = await db
      .select()
      .from(remediationExecutionAttemptsTable)
      .where(eq(remediationExecutionAttemptsTable.executionId, id));

    if (!existing) {
      return res.status(404).json({ error: "EXEC_NOT_FOUND", message: `Execution "${id}" not found.` });
    }

    // Auto-advance from confirmed → executing before completing
    let currentStatus = existing.executionStatus as RemediationExecutionStatus;
    if (currentStatus === "confirmed") {
      const preTransition = validateExecutionTransition("confirmed", "executing");
      if (!preTransition.valid) {
        return res.status(409).json({ error: preTransition.errorCode, message: preTransition.errorMsg });
      }
      currentStatus = "executing";
    }

    const transition = validateExecutionTransition(currentStatus, "completed");
    if (!transition.valid) {
      return res.status(409).json({ error: transition.errorCode, message: transition.errorMsg });
    }

    const now          = new Date();
    const mergedEvidence = [
      ...((existing.executionEvidence as string[]) ?? []),
      ...(executionEvidence ?? []),
    ];
    const appendedNotes = notes
      ? (existing.executionNotes ? `${existing.executionNotes}\n${notes}` : notes)
      : existing.executionNotes;

    const [updated] = await db
      .update(remediationExecutionAttemptsTable)
      .set({
        executionStatus:   "completed",
        executedAt:        existing.executedAt ?? now,
        rollbackStatus:    rollbackStatus ?? "not_applicable",
        executionEvidence: mergedEvidence,
        executionNotes:    appendedNotes,
        completedAt:       now,
        updatedAt:         now,
      })
      .where(eq(remediationExecutionAttemptsTable.executionId, id))
      .returning();

    if (!updated) {
      return res.status(500).json({ error: "EXEC_UPDATE_FAILED", message: "Failed to complete execution." });
    }

    emitExecutionCompletedEvent({
      executionId:     updated.executionId,
      actionId:        updated.actionId,
      workspaceId:     updated.workspaceId,
      executionType:   updated.executionType as RemediationExecutionType,
      executionStatus: "completed",
      confirmedBy:     updated.confirmedBy ?? "",
      action:          "execution_completed",
    });

    return res.json({ execution: rowToExecutionDto(updated) });
  },
);

// POST /platform/reliability/executions/:id/rollback
// Operator records rollback result for an executing attempt
router.post(
  "/platform/reliability/executions/:id/rollback",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const { id }         = req.params as { id: string };
    const { rolledBackBy, rollbackStatus, notes } = req.body as {
      rolledBackBy:   string;
      rollbackStatus: RemediationRollbackStatus;
      notes?:         string;
    };

    const [existing] = await db
      .select()
      .from(remediationExecutionAttemptsTable)
      .where(eq(remediationExecutionAttemptsTable.executionId, id));

    if (!existing) {
      return res.status(404).json({ error: "EXEC_NOT_FOUND", message: `Execution "${id}" not found.` });
    }

    if (!canExecRollBack(existing.executionStatus as RemediationExecutionStatus)) {
      return res.status(409).json({
        error:   "EXEC_ROLLBACK_DENIED",
        message: `Cannot roll back execution in status "${existing.executionStatus}". Must be "executing".`,
      });
    }

    const transition = validateExecutionTransition(
      existing.executionStatus as RemediationExecutionStatus,
      "rolled_back",
    );
    if (!transition.valid) {
      return res.status(409).json({ error: transition.errorCode, message: transition.errorMsg });
    }

    const now           = new Date();
    const appendedNotes = notes
      ? (existing.executionNotes ? `${existing.executionNotes}\n${notes}` : notes)
      : existing.executionNotes;

    const [updated] = await db
      .update(remediationExecutionAttemptsTable)
      .set({
        executionStatus: "rolled_back",
        rollbackStatus:  rollbackStatus ?? "completed",
        rolledBackAt:    now,
        executionNotes:  appendedNotes,
        updatedAt:       now,
      })
      .where(eq(remediationExecutionAttemptsTable.executionId, id))
      .returning();

    if (!updated) {
      return res.status(500).json({ error: "EXEC_UPDATE_FAILED", message: "Failed to record rollback." });
    }

    emitExecutionRolledBackEvent({
      executionId:     updated.executionId,
      actionId:        updated.actionId,
      workspaceId:     updated.workspaceId,
      executionType:   updated.executionType as RemediationExecutionType,
      executionStatus: "rolled_back",
      confirmedBy:     updated.confirmedBy ?? "",
      action:          "execution_rolled_back",
    });

    return res.json({ execution: rowToExecutionDto(updated) });
  },
);

// GET /platform/reliability/executions
// List remediation execution attempts with filters
router.get(
  "/platform/reliability/executions",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const {
      actionId:       filterActionId,
      workspaceId:    filterWorkspaceId,
      executionType:  filterType,
      executionStatus: filterStatus,
      activeOnly,
      limit:  limitStr  = "50",
      offset: offsetStr = "0",
    } = req.query as Record<string, string | undefined>;

    const limit  = Math.min(100, Math.max(1, parseInt(limitStr,  10) || 50));
    const offset = Math.max(0,            parseInt(offsetStr, 10) || 0);

    const conditions = [];

    if (filterActionId) {
      conditions.push(eq(remediationExecutionAttemptsTable.actionId, filterActionId));
    }
    if (filterWorkspaceId) {
      conditions.push(eq(remediationExecutionAttemptsTable.workspaceId, parseInt(filterWorkspaceId, 10)));
    }
    if (filterType) {
      conditions.push(eq(remediationExecutionAttemptsTable.executionType, filterType));
    }
    if (filterStatus) {
      conditions.push(eq(remediationExecutionAttemptsTable.executionStatus, filterStatus));
    }
    if (activeOnly === "true") {
      conditions.push(
        inArray(
          remediationExecutionAttemptsTable.executionStatus,
          [...ACTIVE_EXECUTION_STATUSES] as string[],
        ),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countRows] = await Promise.all([
      db
        .select()
        .from(remediationExecutionAttemptsTable)
        .where(where)
        .orderBy(desc(remediationExecutionAttemptsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(remediationExecutionAttemptsTable)
        .where(where),
    ]);

    return res.json({
      executions: rows.map(rowToExecutionDto),
      total:      countRows[0]?.count ?? 0,
      limit,
      offset,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P10-F - Remediation Outcome Intelligence (READ-ONLY)
// ─────────────────────────────────────────────────────────────────────────────

function rowToExecutionRecord(
  row: typeof remediationExecutionAttemptsTable.$inferSelect,
): ExecutionRecord {
  return {
    executionId:     row.executionId,
    workspaceId:     row.workspaceId,
    executionType:   row.executionType as RemediationExecutionType,
    initiatedBy:     row.initiatedBy,
    confirmedBy:     row.confirmedBy ?? null,
    executionStatus: row.executionStatus as RemediationExecutionStatus,
    rollbackStatus:  row.rollbackStatus as import("../lib/workflows/remediation-outcome-intelligence").RemediationRollbackStatus,
    createdAt:       row.createdAt,
    confirmedAt:     row.confirmedAt ?? null,
    executedAt:      row.executedAt ?? null,
    completedAt:     row.completedAt ?? null,
    rolledBackAt:    row.rolledBackAt ?? null,
    abandonedAt:     row.abandonedAt ?? null,
  };
}

// GET /platform/reliability/outcomes
// Per-workspace per-type outcome profiles derived from execution history
router.get(
  "/platform/reliability/outcomes",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const {
      workspaceId: filterWorkspaceId,
      executionType: filterType,
      limit:  limitStr  = "100",
      offset: offsetStr = "0",
    } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (filterWorkspaceId) {
      conditions.push(eq(remediationExecutionAttemptsTable.workspaceId, parseInt(filterWorkspaceId, 10)));
    }
    if (filterType) {
      conditions.push(eq(remediationExecutionAttemptsTable.executionType, filterType));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows  = await db
      .select()
      .from(remediationExecutionAttemptsTable)
      .where(where)
      .orderBy(desc(remediationExecutionAttemptsTable.createdAt));

    const records  = rows.map(rowToExecutionRecord);
    const profiles = evaluateRemediationOutcomes(records);

    const limit  = Math.min(200, Math.max(1, parseInt(limitStr,  10) || 100));
    const offset = Math.max(0,            parseInt(offsetStr, 10) || 0);
    const paged  = profiles.slice(offset, offset + limit);

    emitOutcomeProfileEvaluatedEvent({
      workspaceId:        filterWorkspaceId ? parseInt(filterWorkspaceId, 10) : 0,
      executionType:      filterType ?? "all",
      effectivenessScore: "evaluated",
      rollbackFrequency:  0,
      operatorId:         "",
      action:             "outcomes_queried",
    });

    return res.json({
      profiles: paged,
      total:    profiles.length,
      limit,
      offset,
    });
  },
);

// GET /platform/reliability/operators
// Per-operator remediation analytics profiles (no ranking - metrics only)
router.get(
  "/platform/reliability/operators",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const {
      operatorId: filterOperator,
      limit:  limitStr  = "100",
      offset: offsetStr = "0",
    } = req.query as Record<string, string | undefined>;

    const rows = await db
      .select()
      .from(remediationExecutionAttemptsTable)
      .orderBy(desc(remediationExecutionAttemptsTable.createdAt));

    const records  = rows.map(rowToExecutionRecord);
    let profiles   = evaluateOperatorProfiles(records);

    if (filterOperator) {
      profiles = profiles.filter(p => p.operatorId === filterOperator);
    }

    const limit  = Math.min(200, Math.max(1, parseInt(limitStr,  10) || 100));
    const offset = Math.max(0,            parseInt(offsetStr, 10) || 0);
    const paged  = profiles.slice(offset, offset + limit);

    emitOperatorEffectivenessUpdatedEvent({
      workspaceId:        0,
      executionType:      "all",
      effectivenessScore: "evaluated",
      rollbackFrequency:  0,
      operatorId:         filterOperator ?? "all",
      action:             "operators_queried",
    });

    return res.json({
      operators: paged,
      total:     profiles.length,
      limit,
      offset,
    });
  },
);

// GET /platform/reliability/effectiveness
// Platform-wide effectiveness summary (or workspace-scoped if workspaceId provided)
router.get(
  "/platform/reliability/effectiveness",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const { workspaceId: filterWorkspaceId, executionType: filterType } =
      req.query as Record<string, string | undefined>;

    const conditions = [];
    if (filterWorkspaceId) {
      conditions.push(eq(remediationExecutionAttemptsTable.workspaceId, parseInt(filterWorkspaceId, 10)));
    }
    if (filterType) {
      conditions.push(eq(remediationExecutionAttemptsTable.executionType, filterType));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows  = await db
      .select()
      .from(remediationExecutionAttemptsTable)
      .where(where)
      .orderBy(desc(remediationExecutionAttemptsTable.createdAt));

    const records = rows.map(rowToExecutionRecord);
    const summary = buildPlatformEffectivenessSummary(records);

    emitEffectivenessScoredEvent({
      workspaceId:        filterWorkspaceId ? parseInt(filterWorkspaceId, 10) : 0,
      executionType:      filterType ?? "all",
      effectivenessScore: summary.platformEffectiveness,
      rollbackFrequency:  summary.overallRollbackRate,
      operatorId:         "",
      action:             "effectiveness_evaluated",
    });

    if (summary.overallRollbackRate > 0.40) {
      emitRollbackTrendDetectedEvent({
        workspaceId:        filterWorkspaceId ? parseInt(filterWorkspaceId, 10) : 0,
        executionType:      filterType ?? "all",
        effectivenessScore: summary.platformEffectiveness,
        rollbackFrequency:  summary.overallRollbackRate,
        operatorId:         "",
        action:             "high_rollback_rate_detected",
      });
    }

    return res.json({ summary });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P11-C - Compliance Workflow Orchestration: Human-Governed Resolution
// ─────────────────────────────────────────────────────────────────────────────

function rowToWorkflowAction(
  row: typeof governanceWorkflowActionsTable.$inferSelect,
): GovernanceWorkflowAction {
  return {
    workflowActionId:         row.workflowActionId,
    violationId:              row.violationId,
    policyId:                 row.policyId,
    workspaceId:              row.workspaceId ?? null,
    assignedOperatorId:       row.assignedOperatorId ?? null,
    initiatedBy:              row.initiatedBy,
    workflowStatus:           row.workflowStatus as GovernanceWorkflowStatus,
    escalationLevel:          row.escalationLevel as GovernanceEscalationLevel,
    resolutionClassification: (row.resolutionClassification as ResolutionClassification) ?? null,
    resolutionNote:           row.resolutionNote ?? null,
    evidenceReferences:       (row.evidenceReferences as string[]) ?? [],
    acknowledgedBy:           row.acknowledgedBy ?? null,
    acknowledgedAt:           row.acknowledgedAt ?? null,
    escalatedBy:              row.escalatedBy ?? null,
    escalatedAt:              row.escalatedAt ?? null,
    resolvedBy:               row.resolvedBy ?? null,
    resolvedAt:               row.resolvedAt ?? null,
    createdAt:                row.createdAt,
    updatedAt:                row.updatedAt,
  };
}

// GET /platform/governance/workflows
// List all governance workflow actions with optional filters.
router.get(
  "/platform/governance/workflows",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const {
      workspaceId:    wsStr,
      workflowStatus: statusFilter,
      policyId:       policyFilter,
      limit:          limitStr  = "100",
      offset:         offsetStr = "0",
    } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (wsStr)         conditions.push(eq(governanceWorkflowActionsTable.workspaceId, parseInt(wsStr, 10)));
    if (statusFilter)  conditions.push(eq(governanceWorkflowActionsTable.workflowStatus, statusFilter));
    if (policyFilter)  conditions.push(eq(governanceWorkflowActionsTable.policyId, policyFilter));

    const where  = conditions.length > 0 ? and(...conditions) : undefined;
    const limit  = Math.min(200, Math.max(1, parseInt(limitStr,  10) || 100));
    const offset = Math.max(0,            parseInt(offsetStr, 10) || 0);

    const [rows, countResult] = await Promise.all([
      db.select()
        .from(governanceWorkflowActionsTable)
        .where(where)
        .orderBy(desc(governanceWorkflowActionsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() })
        .from(governanceWorkflowActionsTable)
        .where(where),
    ]);

    const workflows = rows.map(rowToWorkflowAction);
    const summary   = buildWorkflowSummary(workflows, new Date());

    return res.json({ workflows, summary, total: countResult[0]?.total ?? 0, limit, offset });
  },
);

// POST /platform/governance/workflows
// Initiate a new governance workflow for a detected violation.
router.post(
  "/platform/governance/workflows",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const {
      violationId,
      policyId,
      workspaceId,
      assignedOperatorId,
      violationSeverity,
      evidenceReferences,
    } = req.body as {
      violationId:         string;
      policyId:            string;
      workspaceId?:        number | null;
      assignedOperatorId?: string | null;
      violationSeverity:   "critical" | "high" | "medium" | "low";
      evidenceReferences?: string[];
    };

    // Load existing non-terminal workflows for this violationId (duplicate check)
    const existingRows = await db
      .select({
        violationId:    governanceWorkflowActionsTable.violationId,
        workflowStatus: governanceWorkflowActionsTable.workflowStatus,
      })
      .from(governanceWorkflowActionsTable)
      .where(eq(governanceWorkflowActionsTable.violationId, violationId));

    const now    = new Date();
    const result = initiateGovernanceWorkflow(
      {
        violationId,
        policyId,
        workspaceId:        workspaceId ?? null,
        initiatedBy:        String((req as AuthRequest).userId),
        assignedOperatorId: assignedOperatorId ?? null,
        violationSeverity,
        evidenceReferences: evidenceReferences ?? [],
      },
      existingRows.map(r => ({
        violationId:    r.violationId,
        workflowStatus: r.workflowStatus as GovernanceWorkflowStatus,
      })),
      now,
    );

    if (!result.workflow) {
      const status = result.errors.includes("DUPLICATE_ACTIVE_WORKFLOW") ? 409 : 400;
      return res.status(status).json({ error: result.errors[0], codes: result.errors });
    }

    const wf = result.workflow;
    const [inserted] = await db
      .insert(governanceWorkflowActionsTable)
      .values({
        workflowActionId:   wf.workflowActionId,
        violationId:        wf.violationId,
        policyId:           wf.policyId,
        workspaceId:        wf.workspaceId ?? undefined,
        assignedOperatorId: wf.assignedOperatorId ?? undefined,
        initiatedBy:        wf.initiatedBy,
        workflowStatus:     wf.workflowStatus,
        escalationLevel:    wf.escalationLevel,
        evidenceReferences: wf.evidenceReferences,
      })
      .returning();

    emitGovernanceWorkflowInitiatedEvent({
      workflowActionId: wf.workflowActionId,
      violationId:      wf.violationId,
      policyId:         wf.policyId,
      escalationLevel:  wf.escalationLevel,
      workflowStatus:   wf.workflowStatus,
      action:           "governance_workflow_initiated",
    });

    return res.status(201).json({ workflow: inserted });
  },
);

// POST /platform/governance/workflows/:id/acknowledge
// Human operator acknowledges a governance violation workflow.
router.post(
  "/platform/governance/workflows/:id/acknowledge",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const { id } = req.params as { id: string };
    const { note } = req.body as { note?: string };

    const row = await db
      .select()
      .from(governanceWorkflowActionsTable)
      .where(eq(governanceWorkflowActionsTable.workflowActionId, id))
      .limit(1)
      .then(rows => rows[0]);

    if (!row) return res.status(404).json({ error: "WORKFLOW_NOT_FOUND" });

    const existing = rowToWorkflowAction(row);
    const now      = new Date();
    const result   = acknowledgeWorkflow(existing, String((req as AuthRequest).userId), note ?? null, now);

    if (!result.updated) {
      const status = result.errors.includes("TERMINAL_STATE") ? 409 : 400;
      return res.status(status).json({ error: result.errors[0], codes: result.errors });
    }

    const u = result.updated;
    await db
      .update(governanceWorkflowActionsTable)
      .set({
        workflowStatus:  u.workflowStatus,
        acknowledgedBy:  u.acknowledgedBy ?? undefined,
        acknowledgedAt:  u.acknowledgedAt ?? undefined,
        resolutionNote:  u.resolutionNote ?? undefined,
        updatedAt:       u.updatedAt,
      })
      .where(eq(governanceWorkflowActionsTable.workflowActionId, id));

    emitGovernanceWorkflowAcknowledgedEvent({
      workflowActionId: u.workflowActionId,
      violationId:      u.violationId,
      policyId:         u.policyId,
      escalationLevel:  u.escalationLevel,
      workflowStatus:   u.workflowStatus,
      action:           "governance_workflow_acknowledged",
    });

    return res.json({ workflow: u });
  },
);

// POST /platform/governance/workflows/:id/escalate
// Human operator escalates a governance workflow to a higher urgency level.
router.post(
  "/platform/governance/workflows/:id/escalate",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const { id }                  = req.params as { id: string };
    const { escalationLevel, reason } = req.body as {
      escalationLevel: GovernanceEscalationLevel;
      reason?:         string;
    };

    const row = await db
      .select()
      .from(governanceWorkflowActionsTable)
      .where(eq(governanceWorkflowActionsTable.workflowActionId, id))
      .limit(1)
      .then(rows => rows[0]);

    if (!row) return res.status(404).json({ error: "WORKFLOW_NOT_FOUND" });

    const existing = rowToWorkflowAction(row);
    const now      = new Date();
    const result   = escalateWorkflow(existing, String((req as AuthRequest).userId), escalationLevel, reason ?? null, now);

    if (!result.updated) {
      const status = result.errors.includes("TERMINAL_STATE") ? 409 : 400;
      return res.status(status).json({ error: result.errors[0], codes: result.errors });
    }

    const u = result.updated;
    await db
      .update(governanceWorkflowActionsTable)
      .set({
        workflowStatus:  u.workflowStatus,
        escalationLevel: u.escalationLevel,
        escalatedBy:     u.escalatedBy ?? undefined,
        escalatedAt:     u.escalatedAt ?? undefined,
        resolutionNote:  u.resolutionNote ?? undefined,
        updatedAt:       u.updatedAt,
      })
      .where(eq(governanceWorkflowActionsTable.workflowActionId, id));

    emitGovernanceWorkflowEscalatedEvent({
      workflowActionId: u.workflowActionId,
      violationId:      u.violationId,
      policyId:         u.policyId,
      escalationLevel:  u.escalationLevel,
      workflowStatus:   u.workflowStatus,
      action:           "governance_workflow_escalated",
    });

    return res.json({ workflow: u });
  },
);

// POST /platform/governance/workflows/:id/resolve
// Human operator resolves (or dismisses) a governance workflow with classification.
router.post(
  "/platform/governance/workflows/:id/resolve",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const { id } = req.params as { id: string };
    const {
      resolutionClassification,
      note,
      dismiss = false,
    } = req.body as {
      resolutionClassification: ResolutionClassification;
      note?:                    string;
      dismiss?:                 boolean;
    };

    const row = await db
      .select()
      .from(governanceWorkflowActionsTable)
      .where(eq(governanceWorkflowActionsTable.workflowActionId, id))
      .limit(1)
      .then(rows => rows[0]);

    if (!row) return res.status(404).json({ error: "WORKFLOW_NOT_FOUND" });

    const existing = rowToWorkflowAction(row);
    const now      = new Date();
    const result   = resolveWorkflow(
      existing,
      String((req as AuthRequest).userId),
      resolutionClassification,
      note ?? null,
      dismiss,
      now,
    );

    if (!result.updated) {
      const status = result.errors.includes("TERMINAL_STATE") ? 409 : 400;
      return res.status(status).json({ error: result.errors[0], codes: result.errors });
    }

    const u = result.updated;
    await db
      .update(governanceWorkflowActionsTable)
      .set({
        workflowStatus:           u.workflowStatus,
        resolutionClassification: u.resolutionClassification ?? undefined,
        resolutionNote:           u.resolutionNote ?? undefined,
        resolvedBy:               u.resolvedBy ?? undefined,
        resolvedAt:               u.resolvedAt ?? undefined,
        updatedAt:                u.updatedAt,
      })
      .where(eq(governanceWorkflowActionsTable.workflowActionId, id));

    emitGovernanceWorkflowResolvedEvent({
      workflowActionId: u.workflowActionId,
      violationId:      u.violationId,
      policyId:         u.policyId,
      escalationLevel:  u.escalationLevel,
      workflowStatus:   u.workflowStatus,
      action:           dismiss ? "governance_workflow_dismissed" : "governance_workflow_resolved",
    });

    return res.json({ workflow: u });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P11-B - Governance Policy Intelligence: Read-Only Policy Evaluation Layer
// ─────────────────────────────────────────────────────────────────────────────

// GET /platform/governance/policies
// List all built-in governance policies (constants - no DB read required).
router.get(
  "/platform/governance/policies",
  requireAuth,
  requireSuperAdmin,
  async (_req, res) => {
    emitGovernancePolicyEvaluatedEvent({
      policyId:           "ALL",
      workspaceId:        null,
      violationType:      "none",
      severity:           "low",
      evidenceReferences: [],
      action:             "governance_policies_listed",
    });

    return res.json({ policies: GOVERNANCE_POLICIES });
  },
);

// GET /platform/governance/violations
// On-demand governance evaluation across all execution + audit data.
// Optional query params: workspaceId (number filter)
router.get(
  "/platform/governance/violations",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const { workspaceId: wsStr } = req.query as Record<string, string | undefined>;
    const workspaceIdFilter = wsStr != null ? parseInt(wsStr, 10) : undefined;

    const [auditRows, execRows] = await Promise.all([
      db
        .select()
        .from(complianceAuditChainsTable)
        .orderBy(desc(complianceAuditChainsTable.recordedAt)),
      db
        .select()
        .from(remediationExecutionAttemptsTable)
        .orderBy(desc(remediationExecutionAttemptsTable.createdAt)),
    ]);

    const auditEntries = auditRows.map(rowToAuditChainEntry);
    const execRecords  = execRows.map(r => rowToExecutionRecord(r));

    const now        = new Date();
    const violations = evaluateGovernancePolicies(
      { executionRecords: execRecords, auditEntries, workspaceIdFilter },
      now,
    );
    const summary    = buildGovernanceSummary(violations, now);

    emitGovernancePolicyEvaluatedEvent({
      policyId:           "ALL",
      workspaceId:        workspaceIdFilter ?? null,
      violationType:      summary.overallRiskLevel === "none" ? "none" : violations[0]?.violationType ?? "none",
      severity:           summary.overallRiskLevel === "none" ? "low" : summary.overallRiskLevel,
      evidenceReferences: [],
      action:             "governance_violations_evaluated",
    });

    if (summary.criticalViolations > 0) {
      emitGovernanceViolationDetectedEvent({
        policyId:           "MULTI",
        workspaceId:        workspaceIdFilter ?? null,
        violationType:      "governance_policy_breach",
        severity:           "critical",
        evidenceReferences: violations.filter(v => v.severity === "critical").map(v => v.violationId),
        action:             "critical_violations_detected",
      });
    }

    if (summary.byViolationType?.compliance_gap_detected) {
      emitComplianceGapClassifiedEvent({
        policyId:           "POL-006",
        workspaceId:        workspaceIdFilter ?? null,
        violationType:      "compliance_gap_detected",
        severity:           "high",
        evidenceReferences: [],
        action:             "compliance_gaps_classified",
      });
    }

    if (summary.overallRiskLevel === "critical" || summary.overallRiskLevel === "high") {
      emitPolicyReviewRequiredEvent({
        policyId:           "MULTI",
        workspaceId:        workspaceIdFilter ?? null,
        violationType:      summary.overallRiskLevel,
        severity:           summary.overallRiskLevel,
        evidenceReferences: [],
        action:             "policy_review_required",
      });
    }

    return res.json({ violations, summary });
  },
);

// GET /platform/governance/violations/:workspaceId
// Workspace-scoped governance evaluation - violations for one workspace only.
router.get(
  "/platform/governance/violations/:workspaceId",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const workspaceId = parseInt((req.params as { workspaceId: string }).workspaceId, 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      return res.status(400).json({ error: "INVALID_WORKSPACE_ID" });
    }

    const [auditRows, execRows] = await Promise.all([
      db
        .select()
        .from(complianceAuditChainsTable)
        .where(eq(complianceAuditChainsTable.workspaceId, workspaceId))
        .orderBy(desc(complianceAuditChainsTable.recordedAt)),
      db
        .select()
        .from(remediationExecutionAttemptsTable)
        .where(eq(remediationExecutionAttemptsTable.workspaceId, workspaceId))
        .orderBy(desc(remediationExecutionAttemptsTable.createdAt)),
    ]);

    const auditEntries = auditRows.map(rowToAuditChainEntry);
    const execRecords  = execRows.map(r => rowToExecutionRecord(r));

    const now        = new Date();
    const violations = evaluateGovernancePolicies(
      { executionRecords: execRecords, auditEntries, workspaceIdFilter: workspaceId },
      now,
    );
    const summary    = buildGovernanceSummary(violations, now);

    emitGovernancePolicyEvaluatedEvent({
      policyId:           "ALL",
      workspaceId,
      violationType:      "none",
      severity:           summary.overallRiskLevel === "none" ? "low" : summary.overallRiskLevel,
      evidenceReferences: [],
      action:             "workspace_governance_evaluated",
    });

    if (summary.criticalViolations > 0) {
      emitGovernanceViolationDetectedEvent({
        policyId:           "MULTI",
        workspaceId,
        violationType:      "governance_policy_breach",
        severity:           "critical",
        evidenceReferences: violations.filter(v => v.severity === "critical").map(v => v.violationId),
        action:             "workspace_critical_violations_detected",
      });
    }

    if (summary.overallRiskLevel === "critical" || summary.overallRiskLevel === "high") {
      emitPolicyReviewRequiredEvent({
        policyId:           "MULTI",
        workspaceId,
        violationType:      summary.overallRiskLevel,
        severity:           summary.overallRiskLevel,
        evidenceReferences: [],
        action:             "workspace_policy_review_required",
      });
    }

    return res.json({ workspaceId, violations, summary });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P11-A - Compliance Governance: Immutable Audit Integrity
// ─────────────────────────────────────────────────────────────────────────────

function rowToAuditChainEntry(
  row: typeof complianceAuditChainsTable.$inferSelect,
): AuditChainEntry {
  return {
    chainId:                 row.chainId,
    entityType:              row.entityType as AuditEntityType,
    entityId:                row.entityId,
    workspaceId:             row.workspaceId ?? null,
    previousAuditHash:       row.previousAuditHash ?? null,
    currentAuditHash:        row.currentAuditHash,
    eventType:               row.eventType,
    operatorId:              row.operatorId,
    payload:                 (row.payload ?? {}) as Record<string, unknown>,
    occurredAt:              row.occurredAt,
    recordedAt:              row.recordedAt,
    integrityStatus:         row.integrityStatus as AuditIntegrityStatus,
    retentionClassification: row.retentionClassification as RetentionClassification,
  };
}

// POST /platform/compliance/audit-chains
// Append a new immutable audit chain entry. Never updates existing entries.
router.post(
  "/platform/compliance/audit-chains",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const {
      entityType,
      entityId,
      workspaceId,
      previousAuditHash,
      eventType,
      operatorId,
      payload,
      occurredAt,
    } = req.body as {
      entityType:        AuditEntityType;
      entityId:          string;
      workspaceId?:      number | null;
      previousAuditHash?: string | null;
      eventType:         string;
      operatorId:        string;
      payload:           Record<string, unknown>;
      occurredAt:        string;
    };

    const now     = new Date();
    const result  = buildAuditChainEntry({
      entityType,
      entityId,
      workspaceId:       workspaceId ?? null,
      previousAuditHash: previousAuditHash ?? null,
      eventType,
      operatorId,
      payload:           payload ?? {},
      occurredAt:        new Date(occurredAt),
    }, now);

    if (!result.entry) {
      return res.status(400).json({ error: "AUDIT_VALIDATION_FAILED", codes: result.errors });
    }

    const entry = result.entry;

    const [inserted] = await db
      .insert(complianceAuditChainsTable)
      .values({
        chainId:                 entry.chainId,
        entityType:              entry.entityType,
        entityId:                entry.entityId,
        workspaceId:             entry.workspaceId ?? undefined,
        previousAuditHash:       entry.previousAuditHash ?? undefined,
        currentAuditHash:        entry.currentAuditHash,
        eventType:               entry.eventType,
        operatorId:              entry.operatorId,
        payload:                 entry.payload,
        occurredAt:              entry.occurredAt,
        integrityStatus:         entry.integrityStatus,
        retentionClassification: entry.retentionClassification,
      })
      .returning();

    emitAuditChainRecordedEvent({
      chainId:                 entry.chainId,
      entityType:              entry.entityType,
      entityId:                entry.entityId,
      integrityStatus:         entry.integrityStatus,
      retentionClassification: entry.retentionClassification,
      action:                  "audit_chain_entry_recorded",
    });

    return res.status(201).json({ entry: inserted });
  },
);

// GET /platform/compliance/audit-chains
// Paginated, filterable list of immutable audit chain entries.
router.get(
  "/platform/compliance/audit-chains",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const {
      entityType:              filterEntityType,
      entityId:                filterEntityId,
      workspaceId:             filterWorkspaceId,
      integrityStatus:         filterIntegrity,
      retentionClassification: filterRetention,
      limit:  limitStr  = "100",
      offset: offsetStr = "0",
    } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (filterEntityType)  conditions.push(eq(complianceAuditChainsTable.entityType, filterEntityType));
    if (filterEntityId)    conditions.push(eq(complianceAuditChainsTable.entityId, filterEntityId));
    if (filterWorkspaceId) conditions.push(eq(complianceAuditChainsTable.workspaceId, parseInt(filterWorkspaceId, 10)));
    if (filterIntegrity)   conditions.push(eq(complianceAuditChainsTable.integrityStatus, filterIntegrity));
    if (filterRetention)   conditions.push(eq(complianceAuditChainsTable.retentionClassification, filterRetention));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const limit  = Math.min(200, Math.max(1, parseInt(limitStr,  10) || 100));
    const offset = Math.max(0,            parseInt(offsetStr, 10) || 0);

    const [rows, countResult] = await Promise.all([
      db.select()
        .from(complianceAuditChainsTable)
        .where(where)
        .orderBy(desc(complianceAuditChainsTable.recordedAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() })
        .from(complianceAuditChainsTable)
        .where(where),
    ]);

    const total = countResult[0]?.total ?? 0;

    emitAuditIntegrityVerifiedEvent({
      chainId:                 "",
      entityType:              filterEntityType ?? "all",
      entityId:                filterEntityId   ?? "all",
      integrityStatus:         "verified",
      retentionClassification: filterRetention  ?? "all",
      action:                  "audit_chains_queried",
    });

    return res.json({ entries: rows, total, limit, offset });
  },
);

// GET /platform/compliance/audit-integrity
// Full integrity verification report across all (or filtered) audit chain entries.
router.get(
  "/platform/compliance/audit-integrity",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const {
      entityType: filterEntityType,
      entityId:   filterEntityId,
      workspaceId: filterWorkspaceId,
    } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (filterEntityType)  conditions.push(eq(complianceAuditChainsTable.entityType, filterEntityType));
    if (filterEntityId)    conditions.push(eq(complianceAuditChainsTable.entityId, filterEntityId));
    if (filterWorkspaceId) conditions.push(eq(complianceAuditChainsTable.workspaceId, parseInt(filterWorkspaceId, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows  = await db
      .select()
      .from(complianceAuditChainsTable)
      .where(where)
      .orderBy(desc(complianceAuditChainsTable.recordedAt));

    const entries = rows.map(rowToAuditChainEntry);
    const report  = verifyAuditIntegrity(entries);

    if (report.compromisedCount > 0) {
      emitAuditIntegrityAnomalyDetectedEvent({
        chainId:                 "",
        entityType:              filterEntityType ?? "all",
        entityId:                filterEntityId   ?? "all",
        integrityStatus:         "compromised",
        retentionClassification: "forensic_critical",
        action:                  "integrity_anomaly_detected",
      });
    } else {
      emitAuditIntegrityVerifiedEvent({
        chainId:                 "",
        entityType:              filterEntityType ?? "all",
        entityId:                filterEntityId   ?? "all",
        integrityStatus:         report.overallStatus,
        retentionClassification: "operational",
        action:                  "integrity_verified",
      });
    }

    const summary = buildComplianceSummary(entries);

    return res.json({ report, summary });
  },
);

// GET /platform/compliance/forensics/:entityId
// Forensic timeline reconstruction for a specific entity.
router.get(
  "/platform/compliance/forensics/:entityId",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const { entityId } = req.params as { entityId: string };

    const rows = await db
      .select()
      .from(complianceAuditChainsTable)
      .where(eq(complianceAuditChainsTable.entityId, entityId))
      .orderBy(desc(complianceAuditChainsTable.recordedAt));

    const entries  = rows.map(rowToAuditChainEntry);
    const timeline = reconstructAuditTimeline(entityId, entries);

    emitForensicTimelineReconstructedEvent({
      chainId:                 "",
      entityType:              timeline.entityType ?? "unknown",
      entityId,
      integrityStatus:         timeline.chainIntegrity,
      retentionClassification: "forensic_critical",
      action:                  "forensic_timeline_reconstructed",
    });

    if (timeline.chainIntegrity === "compromised" || timeline.chainIntegrity === "orphaned") {
      emitAuditIntegrityAnomalyDetectedEvent({
        chainId:                 "",
        entityType:              timeline.entityType ?? "unknown",
        entityId,
        integrityStatus:         timeline.chainIntegrity,
        retentionClassification: "forensic_critical",
        action:                  "forensic_integrity_anomaly",
      });
    }

    return res.json({ timeline });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P11-E: Governance Intelligence Consolidation
// ─────────────────────────────────────────────────────────────────────────────

// GET /platform/governance/topology
// Full governance topology: layer descriptors + all boundary verifications.
router.get(
  "/platform/governance/topology",
  requireAuth,
  requireSuperAdmin,
  async (_req, res) => {
    const now = new Date();

    // Fetch runtime counts from the two persisted governance tables
    const [auditCountRow]    = await db.select({ n: count() }).from(complianceAuditChainsTable);
    const [workflowCountRow] = await db.select({ n: count() }).from(governanceWorkflowActionsTable);

    const activeWfRows = await db
      .select({ workflowStatus: governanceWorkflowActionsTable.workflowStatus })
      .from(governanceWorkflowActionsTable);

    const terminalStatuses  = new Set(["resolved", "dismissed"]);
    const activeWorkflows   = activeWfRows.filter(r => !terminalStatuses.has(r.workflowStatus)).length;
    const resolvedWorkflows = activeWfRows.filter(r => terminalStatuses.has(r.workflowStatus)).length;
    const criticalUnresolved = activeWfRows.filter(
      r => !terminalStatuses.has(r.workflowStatus),
    ).length; // Note: full critical-level check needs escalationLevel column - use total active as proxy

    const lifecycleCoverage = computeLifecycleCoverage(
      auditCountRow?.n   ?? 0,
      workflowCountRow?.n ?? 0,
      activeWorkflows,
      resolvedWorkflows,
      criticalUnresolved,
    );

    const topology = buildGovernanceTopology(lifecycleCoverage, now);

    emitGovernanceTopologyEvaluatedEvent({
      topologyId:        topology.topologyId,
      governanceLayer:   "ALL",
      boundaryStatus:    topology.enforcementBoundaries.boundaryStatus,
      lifecycleCoverage: lifecycleCoverage.coverageScore,
      action:            "governance_topology_evaluated",
    });

    for (const layer of topology.governanceLayers) {
      emitGovernanceLayerClassifiedEvent({
        topologyId:        topology.topologyId,
        governanceLayer:   layer.layerId,
        boundaryStatus:    topology.integrityBoundaries.boundaryStatus,
        lifecycleCoverage: lifecycleCoverage.coverageScore,
        action:            "governance_layer_classified",
      });
    }

    return res.json({ topology });
  },
);

// GET /platform/governance/boundaries
// Boundary verification summary for all 5 checks (4 layers + cross-layer).
router.get(
  "/platform/governance/boundaries",
  requireAuth,
  requireSuperAdmin,
  async (_req, res) => {
    const now = new Date();

    const [auditCountRow]    = await db.select({ n: count() }).from(complianceAuditChainsTable);
    const [workflowCountRow] = await db.select({ n: count() }).from(governanceWorkflowActionsTable);

    const lifecycleCoverage = computeLifecycleCoverage(
      auditCountRow?.n    ?? 0,
      workflowCountRow?.n ?? 0,
      0, 0, 0,
    );

    const topology = buildGovernanceTopology(lifecycleCoverage, now);
    const summary  = buildBoundarySummary(topology, now);

    for (const v of summary.byLayer) {
      emitGovernanceBoundaryVerifiedEvent({
        topologyId:        topology.topologyId,
        governanceLayer:   v.layerId,
        boundaryStatus:    v.boundaryStatus,
        lifecycleCoverage: lifecycleCoverage.coverageScore,
        action:            "governance_boundary_verified",
      });
    }

    return res.json({ summary });
  },
);

// GET /platform/governance/readiness
// Full readiness assessment: topology + boundary summary + readiness profile.
router.get(
  "/platform/governance/readiness",
  requireAuth,
  requireSuperAdmin,
  async (_req, res) => {
    const now = new Date();

    const [auditCountRow]    = await db.select({ n: count() }).from(complianceAuditChainsTable);
    const [workflowCountRow] = await db.select({ n: count() }).from(governanceWorkflowActionsTable);

    const activeWfRows = await db
      .select({
        workflowStatus: governanceWorkflowActionsTable.workflowStatus,
        escalationLevel: governanceWorkflowActionsTable.escalationLevel,
      })
      .from(governanceWorkflowActionsTable);

    const terminalStatuses   = new Set(["resolved", "dismissed"]);
    const activeWorkflows    = activeWfRows.filter(r => !terminalStatuses.has(r.workflowStatus)).length;
    const resolvedWorkflows  = activeWfRows.filter(r => terminalStatuses.has(r.workflowStatus)).length;
    const criticalUnresolved = activeWfRows.filter(
      r => r.escalationLevel === "critical" && !terminalStatuses.has(r.workflowStatus),
    ).length;

    const lifecycleCoverage = computeLifecycleCoverage(
      auditCountRow?.n    ?? 0,
      workflowCountRow?.n ?? 0,
      activeWorkflows,
      resolvedWorkflows,
      criticalUnresolved,
    );

    const topology  = buildGovernanceTopology(lifecycleCoverage, now);
    const summary   = buildBoundarySummary(topology, now);
    const readiness = buildGovernanceReadiness(topology, summary, now);

    emitGovernanceReadinessConfirmedEvent({
      topologyId:        topology.topologyId,
      governanceLayer:   "ALL",
      boundaryStatus:    summary.overallStatus,
      lifecycleCoverage: lifecycleCoverage.coverageScore,
      action:            "governance_readiness_confirmed",
    });

    return res.json({ readiness, topology, summary });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P11-D: Compliance Operations Analytics
// ─────────────────────────────────────────────────────────────────────────────

// Row mapper - converts a DB row to GovernanceWorkflowAction for the analytics engine
function rowToWorkflowActionForAnalytics(r: {
  workflowActionId:         string;
  violationId:              string;
  policyId:                 string;
  workspaceId:              number | null;
  assignedOperatorId:       string | null;
  initiatedBy:              string;
  workflowStatus:           string;
  escalationLevel:          string;
  resolutionClassification: string | null;
  resolutionNote:           string | null;
  evidenceReferences:       unknown;
  acknowledgedBy:           string | null;
  acknowledgedAt:           Date | null;
  escalatedBy:              string | null;
  escalatedAt:              Date | null;
  resolvedBy:               string | null;
  resolvedAt:               Date | null;
  createdAt:                Date;
  updatedAt:                Date;
}) {
  return {
    workflowActionId:         r.workflowActionId,
    violationId:              r.violationId,
    policyId:                 r.policyId,
    workspaceId:              r.workspaceId,
    assignedOperatorId:       r.assignedOperatorId,
    initiatedBy:              r.initiatedBy,
    workflowStatus:           r.workflowStatus as GovernanceWorkflowStatus,
    escalationLevel:          r.escalationLevel as GovernanceEscalationLevel,
    resolutionClassification: r.resolutionClassification as ResolutionClassification | null,
    resolutionNote:           r.resolutionNote,
    evidenceReferences:       Array.isArray(r.evidenceReferences) ? r.evidenceReferences as string[] : [],
    acknowledgedBy:           r.acknowledgedBy,
    acknowledgedAt:           r.acknowledgedAt,
    escalatedBy:              r.escalatedBy,
    escalatedAt:              r.escalatedAt,
    resolvedBy:               r.resolvedBy,
    resolvedAt:               r.resolvedAt,
    createdAt:                r.createdAt,
    updatedAt:                r.updatedAt,
  };
}

// GET /platform/governance/analytics
// Returns GovernanceAnalyticsProfile for all workflows (optionally filtered by workspaceId).
// super_admin only. Read-only.
router.get(
  "/platform/governance/analytics",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const workspaceId = req.query["workspaceId"] ? Number(req.query["workspaceId"]) : null;
    const limit       = Math.min(Number(req.query["limit"] ?? 500), 1000);
    const offset      = Number(req.query["offset"] ?? 0);

    if (workspaceId !== null && (!Number.isInteger(workspaceId) || workspaceId <= 0)) {
      res.status(400).json({ error: "workspaceId must be a positive integer" }); return;
    }

    const rows = await db
      .select()
      .from(governanceWorkflowActionsTable)
      .limit(limit)
      .offset(offset);

    const filtered = workspaceId !== null
      ? rows.filter(r => r.workspaceId === workspaceId)
      : rows;

    const workflows = filtered.map(rowToWorkflowActionForAnalytics);
    const now       = new Date();
    const profile   = evaluateGovernanceAnalytics(workflows, workspaceId, now);

    emitGovernanceAnalyticsEvaluatedEvent({
      workspaceId:             workspaceId,
      policyId:                "ALL",
      effectivenessScore:      profile.workflowStabilityScore,
      escalationRate:          profile.escalationRate,
      unresolvedCriticalCount: profile.unresolvedCriticalCount,
      action:                  "governance_analytics_evaluated",
    });

    emitWorkflowStabilityClassifiedEvent({
      workspaceId:             workspaceId,
      policyId:                "ALL",
      effectivenessScore:      profile.workflowStabilityScore,
      escalationRate:          profile.escalationRate,
      unresolvedCriticalCount: profile.unresolvedCriticalCount,
      action:                  "workflow_stability_classified",
    });

    if (profile.unresolvedCriticalCount >= 3) {
      emitCriticalUnresolvedThresholdDetectedEvent({
        workspaceId:             workspaceId,
        policyId:                "ALL",
        effectivenessScore:      profile.workflowStabilityScore,
        escalationRate:          profile.escalationRate,
        unresolvedCriticalCount: profile.unresolvedCriticalCount,
        action:                  "critical_unresolved_threshold_detected",
      });
    }

    return res.json({ profile, total: rows.length, filtered: filtered.length });
  },
);

// GET /platform/governance/effectiveness
// Returns the full GovernanceEffectivenessReport (global + per-policy profiles).
// super_admin only. Read-only.
router.get(
  "/platform/governance/effectiveness",
  requireAuth,
  requireSuperAdmin,
  async (_req, res) => {
    const rows      = await db.select().from(governanceWorkflowActionsTable);
    const workflows = rows.map(rowToWorkflowActionForAnalytics);
    const now       = new Date();
    const report    = buildGovernanceEffectivenessReport(workflows, now);

    emitGovernanceAnalyticsEvaluatedEvent({
      workspaceId:             null,
      policyId:                "ALL",
      effectivenessScore:      report.globalProfile.workflowStabilityScore,
      escalationRate:          report.globalProfile.escalationRate,
      unresolvedCriticalCount: report.globalProfile.unresolvedCriticalCount,
      action:                  "governance_effectiveness_report_built",
    });

    return res.json({ report });
  },
);

// GET /platform/governance/policy-effectiveness
// Returns per-policy effectiveness profiles, optionally filtered to a single policyId.
// super_admin only. Read-only.
router.get(
  "/platform/governance/policy-effectiveness",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const policyId = typeof req.query["policyId"] === "string"
      ? req.query["policyId"].trim()
      : null;

    const rows      = await db.select().from(governanceWorkflowActionsTable);
    const workflows = rows.map(rowToWorkflowActionForAnalytics);
    const now       = new Date();

    const profiles = policyId
      ? [evaluatePolicyEffectiveness(workflows, policyId, now)]
      : evaluateAllPolicyEffectiveness(workflows, now);

    for (const p of profiles) {
      emitPolicyEffectivenessScored({
        workspaceId:             null,
        policyId:                p.policyId,
        effectivenessScore:      p.policyStabilityScore,
        escalationRate:          p.escalationFrequency,
        unresolvedCriticalCount: p.unresolvedCount,
        action:                  "policy_effectiveness_scored",
      });
    }

    return res.json({ profiles, total: profiles.length });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P11-F: Governance Evidence Packaging & Audit Export Readiness
// ─────────────────────────────────────────────────────────────────────────────

// GET /platform/governance/evidence-packages
// Build a platform-scope governance evidence package from all available layers.
router.get(
  "/platform/governance/evidence-packages",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const now = new Date();
    const rawScope = (req.query as Record<string, string>)["scope"];
    const scopeValues: GovernanceEvidencePackageScope[] = [
      "platform", "workspace", "entity", "violation", "workflow", "readiness",
    ];
    const scope: GovernanceEvidencePackageScope =
      scopeValues.includes(rawScope as GovernanceEvidencePackageScope)
        ? (rawScope as GovernanceEvidencePackageScope)
        : "platform";

    // Fetch runtime data
    const [auditCountRow]    = await db.select({ n: count() }).from(complianceAuditChainsTable);
    const [workflowCountRow] = await db.select({ n: count() }).from(governanceWorkflowActionsTable);

    const wfRows = await db
      .select({
        workflowStatus:  governanceWorkflowActionsTable.workflowStatus,
        escalationLevel: governanceWorkflowActionsTable.escalationLevel,
        policyId:        governanceWorkflowActionsTable.policyId,
      })
      .from(governanceWorkflowActionsTable);

    const terminalStatuses   = new Set(["resolved", "dismissed"]);
    const activeWorkflows    = wfRows.filter(r => !terminalStatuses.has(r.workflowStatus)).length;
    const resolvedWorkflows  = wfRows.filter(r => terminalStatuses.has(r.workflowStatus)).length;
    const escalatedWorkflows = wfRows.filter(r => r.workflowStatus === "escalated").length;
    const criticalUnresolved = wfRows.filter(
      r => r.escalationLevel === "critical" && !terminalStatuses.has(r.workflowStatus),
    ).length;
    const total = wfRows.length;
    const escalationRate = total > 0 ? escalatedWorkflows / total : 0;
    const throughputRate = total > 0 ? resolvedWorkflows / total : 0;

    const policyBreachFrequency: Record<string, number> = {};
    for (const row of wfRows) {
      if (row.policyId) {
        policyBreachFrequency[row.policyId] = (policyBreachFrequency[row.policyId] ?? 0) + 1;
      }
    }

    // Build topology for the package
    const cov       = computeLifecycleCoverage(
      auditCountRow?.n ?? 0,
      workflowCountRow?.n ?? 0,
      activeWorkflows,
      resolvedWorkflows,
      criticalUnresolved,
    );
    const topology  = buildGovernanceTopology(cov, now);
    const bndSummary = buildBoundarySummary(topology, now);
    const readiness  = buildGovernanceReadiness(topology, bndSummary, now);

    const pkg = buildGovernanceEvidencePackage({
      scope,
      workspaceId: null,
      entityId:    null,
      now,
      auditRecordsTotal:    auditCountRow?.n ?? 0,
      auditOrphanCount:     0,
      auditIntegrityStatus: bndSummary.overallStatus,
      auditRetentionMap:    {},
      workflowStats: {
        total,
        active:             activeWorkflows,
        resolved:           resolvedWorkflows,
        escalated:          escalatedWorkflows,
        criticalUnresolved,
        escalationRate,
        throughputRate,
      },
      analyticsStats: {
        workflowStabilityScore:  "effective",
        escalationTrend:         criticalUnresolved >= 3 ? "critical" : "stable",
        policyBreachFrequency,
        unresolvedCriticalCount: criticalUnresolved,
      },
      topology,
      boundarySummary:  bndSummary,
      readinessProfile: readiness,
    });

    emitGovernanceEvidencePackageGeneratedEvent({
      packageId:       pkg.packageId,
      packageScope:    pkg.packageScope,
      workspaceId:     null,
      integrityStatus: pkg.integrityStatus,
      readinessStatus: readiness.overallStatus,
      action:          "governance_evidence_package_generated",
    });
    emitGovernancePackageIntegrityVerifiedEvent({
      packageId:       pkg.packageId,
      packageScope:    pkg.packageScope,
      workspaceId:     null,
      integrityStatus: pkg.integrityStatus,
      readinessStatus: readiness.overallStatus,
      action:          "governance_package_integrity_verified",
    });

    return res.json({ package: pkg });
  },
);

// GET /platform/governance/evidence-packages/readiness
// Lightweight readiness-scope evidence package (topology + boundaries only).
router.get(
  "/platform/governance/evidence-packages/readiness",
  requireAuth,
  requireSuperAdmin,
  async (_req, res) => {
    const now = new Date();

    const [auditCountRow]    = await db.select({ n: count() }).from(complianceAuditChainsTable);
    const [workflowCountRow] = await db.select({ n: count() }).from(governanceWorkflowActionsTable);

    const cov       = computeLifecycleCoverage(
      auditCountRow?.n ?? 0, workflowCountRow?.n ?? 0, 0, 0, 0,
    );
    const topology  = buildGovernanceTopology(cov, now);
    const bndSummary = buildBoundarySummary(topology, now);
    const readiness  = buildGovernanceReadiness(topology, bndSummary, now);

    const pkg = buildGovernanceEvidencePackage({
      scope:           "readiness",
      workspaceId:     null,
      entityId:        null,
      now,
      topology,
      boundarySummary: bndSummary,
      readinessProfile: readiness,
    });

    emitGovernanceEvidencePackageGeneratedEvent({
      packageId:       pkg.packageId,
      packageScope:    "readiness",
      workspaceId:     null,
      integrityStatus: pkg.integrityStatus,
      readinessStatus: readiness.overallStatus,
      action:          "governance_evidence_package_generated",
    });

    return res.json({ package: pkg });
  },
);

// GET /platform/governance/topology/snapshot
// Build a topology snapshot payload (no DB persistence - structured for future storage).
router.get(
  "/platform/governance/topology/snapshot",
  requireAuth,
  requireSuperAdmin,
  async (_req, res) => {
    const now = new Date();

    const [auditCountRow]    = await db.select({ n: count() }).from(complianceAuditChainsTable);
    const [workflowCountRow] = await db.select({ n: count() }).from(governanceWorkflowActionsTable);

    const wfRows = await db
      .select({
        workflowStatus:  governanceWorkflowActionsTable.workflowStatus,
        escalationLevel: governanceWorkflowActionsTable.escalationLevel,
      })
      .from(governanceWorkflowActionsTable);

    const terminalStatuses   = new Set(["resolved", "dismissed"]);
    const activeWorkflows    = wfRows.filter(r => !terminalStatuses.has(r.workflowStatus)).length;
    const resolvedWorkflows  = wfRows.filter(r => terminalStatuses.has(r.workflowStatus)).length;
    const criticalUnresolved = wfRows.filter(
      r => r.escalationLevel === "critical" && !terminalStatuses.has(r.workflowStatus),
    ).length;

    const cov       = computeLifecycleCoverage(
      auditCountRow?.n ?? 0,
      workflowCountRow?.n ?? 0,
      activeWorkflows,
      resolvedWorkflows,
      criticalUnresolved,
    );
    const topology  = buildGovernanceTopology(cov, now);
    const bndSummary = buildBoundarySummary(topology, now);
    const readiness  = buildGovernanceReadiness(topology, bndSummary, now);

    const snapshot = buildTopologySnapshotPayload(topology, bndSummary, readiness, now);

    emitGovernanceTopologySnapshotBuiltEvent({
      packageId:       snapshot.snapshotId,
      packageScope:    "platform",
      workspaceId:     null,
      integrityStatus: bndSummary.overallStatus,
      readinessStatus: readiness.overallStatus,
      action:          "governance_topology_snapshot_built",
    });

    return res.json({ snapshot });
  },
);

// POST /platform/governance/topology/diff
// Compare two topology snapshot payloads sent in the request body.
// Read-only: accepts two snapshot payloads, returns diff. No DB writes.
router.post(
  "/platform/governance/topology/diff",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    const now  = new Date();
    const body = req.body as { prev?: unknown; next?: unknown };

    if (!body.prev || !body.next) {
      return res.status(400).json({ error: "Request body must include `prev` and `next` snapshot payloads." });
    }

    const prev = body.prev as GovernanceTopologySnapshotPayload;
    const next = body.next as GovernanceTopologySnapshotPayload;

    if (!prev.snapshotId || !next.snapshotId) {
      return res.status(400).json({ error: "Both `prev` and `next` must be valid GovernanceTopologySnapshotPayload objects with snapshotId." });
    }

    const diff = diffGovernanceTopologySnapshots(prev, next, now);

    emitGovernanceTopologyDiffComputedEvent({
      packageId:       diff.diffId,
      packageScope:    "platform",
      workspaceId:     null,
      integrityStatus: "verified",
      readinessStatus: next.readinessProfile?.overallStatus ?? "partial",
      action:          "governance_topology_diff_computed",
    });

    return res.json({ diff });
  },
);

export default router;



