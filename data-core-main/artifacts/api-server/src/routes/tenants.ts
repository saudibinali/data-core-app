/**
 * @file   routes/tenants.ts
 * @phase  P13-A - Platform Tenant Registry & Workspace Inventory Foundations
 *         P13-B - Workspace Lifecycle Management & Controlled State Transitions
 *         P13-C - Subscription Metadata, Trial Windows & Renewal Lifecycle Foundations
 *         P13-F - Subscription Expiry, Grace Period & Renewal Intelligence
 *         P13-G - Tenant Health, Risk Signals & Operational Monitoring
 *
 * GET   /platform/tenants                                      - list all tenant profiles (super-admin only)
 * GET   /platform/tenants/:tenantId                            - single tenant profile (super-admin only)
 * GET   /platform/tenants/:tenantId/summary                    - lightweight summary (super-admin only)
 * PATCH /platform/tenants/:tenantId/lifecycle                  - controlled lifecycle transition (super-admin only)
 * GET   /platform/tenants/:tenantId/subscription               - read subscription metadata (super-admin only)
 * PATCH /platform/tenants/:tenantId/subscription               - update subscription metadata (super-admin only)
 * GET   /platform/tenants/:tenantId/renewal-intelligence       - renewal intelligence (super-admin only, read-only)
 * GET   /platform/tenants/:tenantId/health                     - tenant health profile (super-admin only, read-only)
 * GET   /platform/tenants/:tenantId/lifecycle-evaluation       - lifecycle evaluation profile (super-admin only, read-only)
 *
 * SAFETY CONTRACT:
 *   - All routes require requireAuth + requireSuperAdmin.
 *   - Subscription routes: metadata only - no payment, billing, or entitlement logic.
 *   - Renewal intelligence: read-only derivation only - no suspension, no enforcement.
 *   - Missing metadata fields are returned as null - no fallback fabrication.
 */

import { Router, type IRouter }    from "express";
import { db }                       from "@workspace/db";
import { workspacesTable, usersTable, activityLogsTable, tenantSubscriptionsTable, tenantEntitlementOverridesTable, workflowDefinitionsTable } from "@workspace/db";
import { eq, inArray, and, sql }    from "drizzle-orm";
import { type AuthRequest, requireAuth, requireSuperAdmin, requirePlatformPermission } from "../middlewares/requireAuth";
import {
  buildTenantProfile,
  applyTenantFilters,
  sortTenantsByName,
  type TenantFilterOptions,
  type RawSubscriptionRow,
} from "../lib/tenant-registry";
import { workspaceLifecycleService } from "../lib/platform/workspace-lifecycle-service";
import {
  validateSubscriptionMetadataUpdate,
  buildSubscriptionAuditPayload,
  deriveSubscriptionStatus,
  type SubscriptionUpdateRequest,
} from "../lib/subscription-lifecycle";
import {
  deriveTenantEntitlementProfile,
  validateEntitlementOverridesBatch,
  buildEntitlementAuditPayload,
  type EntitlementOverrideRecord,
  type EntitlementOverridesBatchInput,
  type OverrideType,
} from "../lib/tenant-entitlements";
import {
  deriveTenantUsageProfile,
  summarizeUsageWarnings,
  type RawTenantUsage,
} from "../lib/tenant-usage-intelligence";
import {
  deriveSubscriptionRenewalProfile,
} from "../lib/subscription-renewal-intelligence";
import {
  deriveTenantHealthProfile,
  type TenantHealthInput,
} from "../lib/tenant-health-intelligence";
import {
  deriveTenantLifecycleEvaluationProfile,
  type TenantLifecycleEvaluationInput,
} from "../lib/tenant-lifecycle-evaluation";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// collectTenantRawUsage  (local helper - read-only, no side effects)
// ─────────────────────────────────────────────────────────────────────────────

async function collectTenantRawUsage(
  workspaceId:       number,
  entitlementLimits: Record<string, number | null>,
): Promise<RawTenantUsage> {
  const [seatsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(and(eq(usersTable.workspaceId, workspaceId), eq(usersTable.status, "active")));

  const [workflowsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workflowDefinitionsTable)
    .where(and(
      eq(workflowDefinitionsTable.workspaceId, workspaceId),
      eq(workflowDefinitionsTable.status, "active"),
    ));

  const auditRetentionValue = entitlementLimits["audit_retention_days"] ?? null;

  return {
    seats:                { value: seatsRow?.count ?? 0,        sourceType: "live_db",     notes: "Active users (status=active)" },
    storage_gb:           { value: null,                        sourceType: "unavailable", notes: "No storage tracking implemented" },
    monthly_api_calls:    { value: null,                        sourceType: "unavailable", notes: "No API call counter implemented" },
    documents:            { value: null,                        sourceType: "unavailable", notes: "No documents table" },
    workflows:            { value: workflowsRow?.count ?? 0,   sourceType: "live_db",     notes: "Active workflow definitions (status=active)" },
    custom_reports:       { value: null,                        sourceType: "unavailable", notes: "No custom reports table" },
    integrations:         { value: null,                        sourceType: "unavailable", notes: "No integrations table" },
    ai_actions:           { value: null,                        sourceType: "unavailable", notes: "No AI action counter" },
    audit_retention_days: { value: auditRetentionValue,         sourceType: "configured",  notes: "Configured retention from entitlement limits" },
    workspaces:           { value: 1,                           sourceType: "derived",     notes: "Single workspace per tenant" },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/tenants
// List all platform tenant profiles. Super-admin only.
// Query params: status, subscriptionStatus, riskLevel, search
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/platform/tenants",
  requireAuth,
  requirePlatformPermission("tenants.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const {
      status,
      subscriptionStatus,
      riskLevel,
      search,
    } = req.query as Record<string, string | undefined>;

    const now = new Date();

    const workspaces = await db
      .select({
        id:              workspacesTable.id,
        name:            workspacesTable.name,
        slug:            workspacesTable.slug,
        status:          workspacesTable.status,
        logoUrl:         workspacesTable.logoUrl,
        primaryColor:    workspacesTable.primaryColor,
        userCount:       sql<number>`(select count(*)::int from users where workspace_id = ${workspacesTable.id})`,
        ticketCount:     sql<number>`(select count(*)::int from tickets where workspace_id = ${workspacesTable.id})`,
        departmentCount: sql<number>`(select count(*)::int from departments where workspace_id = ${workspacesTable.id})`,
        createdAt:       workspacesTable.createdAt,
        updatedAt:       workspacesTable.updatedAt,
      })
      .from(workspacesTable)
      .orderBy(workspacesTable.name);

    const workspaceIds = workspaces.map(w => w.id);

    const allOwners = workspaceIds.length > 0
      ? await db
          .select({
            id:          usersTable.id,
            email:       usersTable.email,
            fullName:    usersTable.fullName,
            workspaceId: usersTable.workspaceId,
          })
          .from(usersTable)
          .where(and(
            inArray(usersTable.workspaceId, workspaceIds),
            eq(usersTable.role, "admin"),
          ))
      : [];

    const ownerMap = new Map<number, { id: number; email: string | null; fullName: string }>();
    for (const owner of allOwners) {
      if (owner.workspaceId !== null && !ownerMap.has(owner.workspaceId)) {
        ownerMap.set(owner.workspaceId, {
          id:       owner.id,
          email:    owner.email,
          fullName: owner.fullName,
        });
      }
    }

    const profiles = workspaces.map(ws =>
      buildTenantProfile(ws, ownerMap.get(ws.id) ?? null, now),
    );

    const filters: TenantFilterOptions = { status, subscriptionStatus, riskLevel, search };
    const filtered = applyTenantFilters(profiles, filters);
    const sorted   = sortTenantsByName(filtered);

    req.log.info({
      actorId:        req.userId,
      count:          sorted.length,
      filtersApplied: filters,
      action:         "tenant_registry_listed",
    });

    res.json({ tenants: sorted, total: sorted.length });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/tenants/:tenantId
// Single tenant profile. Super-admin only.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/platform/tenants/:tenantId",
  requireAuth,
  requirePlatformPermission("tenants.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = parseInt(String((req.params as { tenantId: string }).tenantId ?? ""), 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "Invalid tenantId - must be a positive integer" });
      return;
    }

    const now = new Date();

    const [workspace] = await db
      .select({
        id:              workspacesTable.id,
        name:            workspacesTable.name,
        slug:            workspacesTable.slug,
        status:          workspacesTable.status,
        logoUrl:         workspacesTable.logoUrl,
        primaryColor:    workspacesTable.primaryColor,
        userCount:       sql<number>`(select count(*)::int from users where workspace_id = ${workspacesTable.id})`,
        ticketCount:     sql<number>`(select count(*)::int from tickets where workspace_id = ${workspacesTable.id})`,
        departmentCount: sql<number>`(select count(*)::int from departments where workspace_id = ${workspacesTable.id})`,
        createdAt:       workspacesTable.createdAt,
        updatedAt:       workspacesTable.updatedAt,
      })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId));

    if (!workspace) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const [owner] = await db
      .select({ id: usersTable.id, email: usersTable.email, fullName: usersTable.fullName })
      .from(usersTable)
      .where(and(eq(usersTable.workspaceId, workspaceId), eq(usersTable.role, "admin")))
      .limit(1);

    const profile = buildTenantProfile(workspace, owner ?? null, now);

    req.log.info({
      actorId:  req.userId,
      tenantId: workspaceId,
      action:   "tenant_profile_read",
    });

    res.json({ tenant: profile });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/tenants/:tenantId/summary
// Lightweight tenant summary - no owner lookup, reduced payload.
// Super-admin only.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/platform/tenants/:tenantId/summary",
  requireAuth,
  requirePlatformPermission("tenants.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = parseInt(String((req.params as { tenantId: string }).tenantId ?? ""), 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "Invalid tenantId - must be a positive integer" });
      return;
    }

    const now = new Date();

    const [workspace] = await db
      .select({
        id:              workspacesTable.id,
        name:            workspacesTable.name,
        slug:            workspacesTable.slug,
        status:          workspacesTable.status,
        logoUrl:         workspacesTable.logoUrl,
        primaryColor:    workspacesTable.primaryColor,
        userCount:       sql<number>`(select count(*)::int from users where workspace_id = ${workspacesTable.id})`,
        ticketCount:     sql<number>`(select count(*)::int from tickets where workspace_id = ${workspacesTable.id})`,
        departmentCount: sql<number>`(select count(*)::int from departments where workspace_id = ${workspacesTable.id})`,
        createdAt:       workspacesTable.createdAt,
        updatedAt:       workspacesTable.updatedAt,
      })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId));

    if (!workspace) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const profile = buildTenantProfile(workspace, null, now);

    req.log.info({
      actorId:  req.userId,
      tenantId: workspaceId,
      action:   "tenant_summary_read",
    });

    res.json({
      tenantId:          profile.tenantId,
      workspaceName:     profile.workspaceName,
      tenantStatus:      profile.tenantStatus,
      workspaceStatus:   profile.workspaceStatus,
      userCount:         workspace.userCount,
      ticketCount:       workspace.ticketCount,
      departmentCount:   workspace.departmentCount,
      riskSignalSummary: profile.riskSignalSummary,
      usageSummary:      profile.usageSummary,
      planCode:          profile.planCode,
      subscriptionStatus: profile.subscriptionStatus,
      createdAt:         profile.createdAt,
      updatedAt:         profile.updatedAt,
      lastActivityAt:    profile.lastActivityAt,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /platform/tenants/:tenantId/lifecycle
// Controlled workspace lifecycle state transition. Super-admin only.
// Body: { action, reason, internalNote?, confirmation }
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/platform/tenants/:tenantId/lifecycle",
  requireAuth,
  requirePlatformPermission("tenants.lifecycle.update"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = parseInt(String((req.params as { tenantId: string }).tenantId ?? ""), 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "Invalid tenantId - must be a positive integer" });
      return;
    }

    const body = req.body as {
      action?: string;
      reason?: string;
      internalNote?: string;
      confirmation?: unknown;
      initFinance?: { templateKey: string; baseCurrencyCode?: string };
    };

    const now = new Date();

    try {
      const { auditPayload, workspace: transitioned } = await workspaceLifecycleService.executePlatformLifecycleTransition({
        workspaceId,
        actorUserId: req.userId!,
        body,
        tenantIdString: String(workspaceId),
      });

      req.log.info({
        actorId: req.userId,
        tenantId: workspaceId,
        workspaceName: transitioned.name,
        action: auditPayload.eventType,
        previousState: auditPayload.previousState,
        targetState: auditPayload.targetState,
      });

      const [workspace] = await db
        .select({
          id: workspacesTable.id,
          name: workspacesTable.name,
          slug: workspacesTable.slug,
          status: workspacesTable.status,
          logoUrl: workspacesTable.logoUrl,
          primaryColor: workspacesTable.primaryColor,
          userCount: sql<number>`(select count(*)::int from users where workspace_id = ${workspacesTable.id})`,
          ticketCount: sql<number>`(select count(*)::int from tickets where workspace_id = ${workspacesTable.id})`,
          departmentCount: sql<number>`(select count(*)::int from departments where workspace_id = ${workspacesTable.id})`,
          createdAt: workspacesTable.createdAt,
          updatedAt: workspacesTable.updatedAt,
        })
        .from(workspacesTable)
        .where(eq(workspacesTable.id, workspaceId));

      const owner = await workspaceLifecycleService.getWorkspaceAdminContact(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: "Tenant not found" });
        return;
      }
      const profile = buildTenantProfile(workspace, owner ?? null, now);

      res.json({ tenant: profile, lifecycleEvent: auditPayload });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = err instanceof Error ? (err as { code?: string }).code : undefined;
      if (msg === "Tenant not found") {
        res.status(404).json({ error: msg });
        return;
      }
      if (
        code === "UNKNOWN_ACTION" ||
        code === "REASON_REQUIRED" ||
        code === "CONFIRMATION_REQUIRED" ||
        code === "TRANSITION_NOT_ALLOWED" ||
        msg.startsWith("Cannot enable") ||
        msg.startsWith("Cannot disable")
      ) {
        res.status(400).json({ error: msg, code });
        return;
      }
      throw err;
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/tenants/:tenantId/subscription
// Read subscription metadata for a tenant. Super-admin only.
// Returns subscription fields and derived status.
// Returns isConfigured=false when no subscription record exists - not 404.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/platform/tenants/:tenantId/subscription",
  requireAuth,
  requirePlatformPermission("subscriptions.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = parseInt(String((req.params as { tenantId: string }).tenantId ?? ""), 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "Invalid tenantId - must be a positive integer" });
      return;
    }

    const now = new Date();

    // Verify tenant exists
    const [workspace] = await db
      .select({ id: workspacesTable.id, name: workspacesTable.name })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId));

    if (!workspace) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const [sub] = await db
      .select()
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.workspaceId, workspaceId))
      .limit(1);

    const isConfigured = !!sub;

    const subFields: Partial<RawSubscriptionRow> | null = sub
      ? {
          planCode:             sub.planCode,
          subscriptionStatus:   sub.subscriptionStatus,
          billingPeriodStart:   sub.billingPeriodStart,
          billingPeriodEnd:     sub.billingPeriodEnd,
          renewalDueAt:         sub.renewalDueAt,
          trialStartedAt:       sub.trialStartedAt,
          trialEndsAt:          sub.trialEndsAt,
          gracePeriodStartedAt: sub.gracePeriodStartedAt,
          gracePeriodEndsAt:    sub.gracePeriodEndsAt,
          cancelledAt:          sub.cancelledAt,
          suspendedAt:          sub.suspendedAt,
        }
      : null;

    const derivedStatus = sub
      ? deriveSubscriptionStatus(
          {
            planCode:             sub.planCode,
            subscriptionStatus:   sub.subscriptionStatus,
            billingPeriodStart:   sub.billingPeriodStart,
            billingPeriodEnd:     sub.billingPeriodEnd,
            renewalDueAt:         sub.renewalDueAt,
            trialStartedAt:       sub.trialStartedAt,
            trialEndsAt:          sub.trialEndsAt,
            gracePeriodStartedAt: sub.gracePeriodStartedAt,
            gracePeriodEndsAt:    sub.gracePeriodEndsAt,
            cancelledAt:          sub.cancelledAt,
            suspendedAt:          sub.suspendedAt,
          },
          now,
        )
      : "unknown";

    req.log.info({
      actorId:     req.userId,
      tenantId:    workspaceId,
      isConfigured,
      action:      "tenant_subscription_read",
    });

    void subFields; // used for type narrowing; actual response built from sub

    res.json({
      tenantId:             String(workspaceId),
      workspaceId,
      isConfigured,
      planCode:             sub?.planCode             ?? null,
      subscriptionStatus:   sub?.subscriptionStatus   ?? "unknown",
      derivedStatus,
      billingPeriodStart:   sub?.billingPeriodStart?.toISOString()   ?? null,
      billingPeriodEnd:     sub?.billingPeriodEnd?.toISOString()     ?? null,
      renewalDueAt:         sub?.renewalDueAt?.toISOString()         ?? null,
      trialStartedAt:       sub?.trialStartedAt?.toISOString()       ?? null,
      trialEndsAt:          sub?.trialEndsAt?.toISOString()          ?? null,
      gracePeriodStartedAt: sub?.gracePeriodStartedAt?.toISOString() ?? null,
      gracePeriodEndsAt:    sub?.gracePeriodEndsAt?.toISOString()    ?? null,
      cancelledAt:          sub?.cancelledAt?.toISOString()          ?? null,
      suspendedAt:          sub?.suspendedAt?.toISOString()          ?? null,
      metadataJson:         sub?.metadataJson                        ?? null,
      reason:               sub?.reason                              ?? null,
      createdAt:            sub?.createdAt?.toISOString()            ?? null,
      updatedAt:            sub?.updatedAt?.toISOString()            ?? null,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /platform/tenants/:tenantId/subscription
// Update subscription metadata. Super-admin only.
// Body: { planCode?, subscriptionStatus?, billingPeriodStart?, billingPeriodEnd?,
//         renewalDueAt?, trialStartedAt?, trialEndsAt?, gracePeriodStartedAt?,
//         gracePeriodEndsAt?, cancelledAt?, suspendedAt?, metadataJson?,
//         reason, confirmation }
//
// SAFETY CONTRACT:
//   - Metadata only - no payment processing, no invoice, no charge, no tax.
//   - No automatic workspace.status changes - subscriptions are independent.
//   - Requires reason (≥10 chars) and confirmation=true.
//   - All changes audit-logged to activity_logs before response.
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/platform/tenants/:tenantId/subscription",
  requireAuth,
  requirePlatformPermission("subscriptions.update"),
  async (req: AuthRequest, res): Promise<void> => {
    const workspaceId = parseInt(String((req.params as { tenantId: string }).tenantId ?? ""), 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "Invalid tenantId - must be a positive integer" });
      return;
    }

    const body = req.body as Partial<SubscriptionUpdateRequest>;
    const now   = new Date();

    // Verify tenant exists
    const [workspace] = await db
      .select({
        id:              workspacesTable.id,
        name:            workspacesTable.name,
        slug:            workspacesTable.slug,
        status:          workspacesTable.status,
        logoUrl:         workspacesTable.logoUrl,
        primaryColor:    workspacesTable.primaryColor,
        userCount:       sql<number>`(select count(*)::int from users where workspace_id = ${workspacesTable.id})`,
        ticketCount:     sql<number>`(select count(*)::int from tickets where workspace_id = ${workspacesTable.id})`,
        departmentCount: sql<number>`(select count(*)::int from departments where workspace_id = ${workspacesTable.id})`,
        createdAt:       workspacesTable.createdAt,
        updatedAt:       workspacesTable.updatedAt,
      })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId));

    if (!workspace) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    // Validate request
    const updateRequest: SubscriptionUpdateRequest = {
      planCode:             body.planCode,
      subscriptionStatus:   body.subscriptionStatus,
      billingPeriodStart:   body.billingPeriodStart ?? null,
      billingPeriodEnd:     body.billingPeriodEnd   ?? null,
      renewalDueAt:         body.renewalDueAt       ?? null,
      trialStartedAt:       body.trialStartedAt     ?? null,
      trialEndsAt:          body.trialEndsAt        ?? null,
      gracePeriodStartedAt: body.gracePeriodStartedAt ?? null,
      gracePeriodEndsAt:    body.gracePeriodEndsAt  ?? null,
      cancelledAt:          body.cancelledAt        ?? null,
      suspendedAt:          body.suspendedAt        ?? null,
      metadataJson:         body.metadataJson,
      reason:               String(body.reason ?? ""),
      confirmation:         body.confirmation === true,
    };

    const validation = validateSubscriptionMetadataUpdate(updateRequest);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error, code: validation.code });
      return;
    }

    // Load existing subscription for audit diff
    const [existingSub] = await db
      .select()
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.workspaceId, workspaceId))
      .limit(1);

    const previousStatus  = existingSub?.subscriptionStatus ?? "unknown";
    const previousPlan    = existingSub?.planCode           ?? null;

    // Build the upsert values
    const toDate = (v: string | null | undefined): Date | null =>
      (v && v !== "") ? new Date(v) : null;

    const upsertValues = {
      workspaceId,
      planCode:             updateRequest.planCode             ?? existingSub?.planCode           ?? null,
      subscriptionStatus:   updateRequest.subscriptionStatus   ?? existingSub?.subscriptionStatus ?? "unknown",
      billingPeriodStart:   toDate(updateRequest.billingPeriodStart)   ?? existingSub?.billingPeriodStart   ?? null,
      billingPeriodEnd:     toDate(updateRequest.billingPeriodEnd)     ?? existingSub?.billingPeriodEnd     ?? null,
      renewalDueAt:         toDate(updateRequest.renewalDueAt)         ?? existingSub?.renewalDueAt         ?? null,
      trialStartedAt:       toDate(updateRequest.trialStartedAt)       ?? existingSub?.trialStartedAt       ?? null,
      trialEndsAt:          toDate(updateRequest.trialEndsAt)          ?? existingSub?.trialEndsAt          ?? null,
      gracePeriodStartedAt: toDate(updateRequest.gracePeriodStartedAt) ?? existingSub?.gracePeriodStartedAt ?? null,
      gracePeriodEndsAt:    toDate(updateRequest.gracePeriodEndsAt)    ?? existingSub?.gracePeriodEndsAt    ?? null,
      cancelledAt:          toDate(updateRequest.cancelledAt)          ?? existingSub?.cancelledAt          ?? null,
      suspendedAt:          toDate(updateRequest.suspendedAt)          ?? existingSub?.suspendedAt          ?? null,
      metadataJson:         updateRequest.metadataJson !== undefined ? updateRequest.metadataJson : existingSub?.metadataJson ?? null,
      reason:               updateRequest.reason.trim(),
      updatedBy:            req.userId!,
    };

    // Determine which fields changed for audit
    const changedFields: string[] = [];
    const checkField = (key: string, newVal: unknown, oldVal: unknown) => {
      const n = newVal instanceof Date ? newVal.toISOString() : String(newVal ?? "");
      const o = oldVal instanceof Date ? oldVal.toISOString() : String(oldVal ?? "");
      if (n !== o) changedFields.push(key);
    };
    checkField("planCode",             upsertValues.planCode,             existingSub?.planCode);
    checkField("subscriptionStatus",   upsertValues.subscriptionStatus,   existingSub?.subscriptionStatus);
    checkField("billingPeriodStart",   upsertValues.billingPeriodStart,   existingSub?.billingPeriodStart);
    checkField("billingPeriodEnd",     upsertValues.billingPeriodEnd,     existingSub?.billingPeriodEnd);
    checkField("renewalDueAt",         upsertValues.renewalDueAt,         existingSub?.renewalDueAt);
    checkField("trialStartedAt",       upsertValues.trialStartedAt,       existingSub?.trialStartedAt);
    checkField("trialEndsAt",          upsertValues.trialEndsAt,          existingSub?.trialEndsAt);
    checkField("gracePeriodStartedAt", upsertValues.gracePeriodStartedAt, existingSub?.gracePeriodStartedAt);
    checkField("gracePeriodEndsAt",    upsertValues.gracePeriodEndsAt,    existingSub?.gracePeriodEndsAt);
    checkField("cancelledAt",          upsertValues.cancelledAt,          existingSub?.cancelledAt);
    checkField("suspendedAt",          upsertValues.suspendedAt,          existingSub?.suspendedAt);

    // Upsert subscription record
    await db
      .insert(tenantSubscriptionsTable)
      .values(upsertValues)
      .onConflictDoUpdate({
        target: tenantSubscriptionsTable.workspaceId,
        set:    {
          planCode:             upsertValues.planCode,
          subscriptionStatus:   upsertValues.subscriptionStatus,
          billingPeriodStart:   upsertValues.billingPeriodStart,
          billingPeriodEnd:     upsertValues.billingPeriodEnd,
          renewalDueAt:         upsertValues.renewalDueAt,
          trialStartedAt:       upsertValues.trialStartedAt,
          trialEndsAt:          upsertValues.trialEndsAt,
          gracePeriodStartedAt: upsertValues.gracePeriodStartedAt,
          gracePeriodEndsAt:    upsertValues.gracePeriodEndsAt,
          cancelledAt:          upsertValues.cancelledAt,
          suspendedAt:          upsertValues.suspendedAt,
          metadataJson:         upsertValues.metadataJson,
          reason:               upsertValues.reason,
          updatedBy:            upsertValues.updatedBy,
          updatedAt:            now,
        },
      });

    // Derive new status for audit
    const newStatus = deriveSubscriptionStatus(
      {
        planCode:             upsertValues.planCode,
        subscriptionStatus:   upsertValues.subscriptionStatus,
        billingPeriodStart:   upsertValues.billingPeriodStart,
        billingPeriodEnd:     upsertValues.billingPeriodEnd,
        renewalDueAt:         upsertValues.renewalDueAt,
        trialStartedAt:       upsertValues.trialStartedAt,
        trialEndsAt:          upsertValues.trialEndsAt,
        gracePeriodStartedAt: upsertValues.gracePeriodStartedAt,
        gracePeriodEndsAt:    upsertValues.gracePeriodEndsAt,
        cancelledAt:          upsertValues.cancelledAt,
        suspendedAt:          upsertValues.suspendedAt,
      },
      now,
    );

    const auditPayload = buildSubscriptionAuditPayload({
      tenantId:                   String(workspaceId),
      workspaceId,
      actorId:                    req.userId!,
      previousSubscriptionStatus: previousStatus,
      newSubscriptionStatus:      newStatus,
      previousPlanCode:           previousPlan,
      newPlanCode:                upsertValues.planCode,
      changedFields,
      reason:                     updateRequest.reason.trim(),
      now,
    });

    await db.insert(activityLogsTable).values({
      userId:     req.userId!,
      workspaceId,
      action:     auditPayload.eventType,
      metadata:   JSON.stringify({
        previousSubscriptionStatus: auditPayload.previousSubscriptionStatus,
        newSubscriptionStatus:      auditPayload.newSubscriptionStatus,
        previousPlanCode:           auditPayload.previousPlanCode,
        newPlanCode:                auditPayload.newPlanCode,
        changedFields:              auditPayload.changedFields,
        reason:                     auditPayload.reason,
        tenantId:                   auditPayload.tenantId,
      }),
    });

    req.log.info({
      actorId:                    req.userId,
      tenantId:                   workspaceId,
      workspaceName:              workspace.name,
      action:                     "tenant_subscription_updated",
      previousSubscriptionStatus: previousStatus,
      newSubscriptionStatus:      newStatus,
      changedFields,
    });

    // Return updated tenant profile (with subscription) + audit payload
    const [owner] = await db
      .select({ id: usersTable.id, email: usersTable.email, fullName: usersTable.fullName })
      .from(usersTable)
      .where(and(eq(usersTable.workspaceId, workspaceId), eq(usersTable.role, "admin")))
      .limit(1);

    const subRow: RawSubscriptionRow = {
      planCode:             upsertValues.planCode,
      subscriptionStatus:   upsertValues.subscriptionStatus,
      billingPeriodStart:   upsertValues.billingPeriodStart,
      billingPeriodEnd:     upsertValues.billingPeriodEnd,
      renewalDueAt:         upsertValues.renewalDueAt,
      trialStartedAt:       upsertValues.trialStartedAt,
      trialEndsAt:          upsertValues.trialEndsAt,
      gracePeriodStartedAt: upsertValues.gracePeriodStartedAt,
      gracePeriodEndsAt:    upsertValues.gracePeriodEndsAt,
      cancelledAt:          upsertValues.cancelledAt,
      suspendedAt:          upsertValues.suspendedAt,
    };

    const profile = buildTenantProfile(workspace, owner ?? null, now, subRow);

    res.json({
      subscription: {
        tenantId:             String(workspaceId),
        workspaceId,
        isConfigured:         true,
        planCode:             upsertValues.planCode,
        subscriptionStatus:   upsertValues.subscriptionStatus,
        derivedStatus:        newStatus,
        billingPeriodStart:   upsertValues.billingPeriodStart?.toISOString()   ?? null,
        billingPeriodEnd:     upsertValues.billingPeriodEnd?.toISOString()     ?? null,
        renewalDueAt:         upsertValues.renewalDueAt?.toISOString()         ?? null,
        trialStartedAt:       upsertValues.trialStartedAt?.toISOString()       ?? null,
        trialEndsAt:          upsertValues.trialEndsAt?.toISOString()          ?? null,
        gracePeriodStartedAt: upsertValues.gracePeriodStartedAt?.toISOString() ?? null,
        gracePeriodEndsAt:    upsertValues.gracePeriodEndsAt?.toISOString()    ?? null,
        cancelledAt:          upsertValues.cancelledAt?.toISOString()          ?? null,
        suspendedAt:          upsertValues.suspendedAt?.toISOString()          ?? null,
        metadataJson:         upsertValues.metadataJson,
        reason:               upsertValues.reason,
      },
      tenant:         profile,
      auditEvent:     auditPayload,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/tenants/:tenantId/entitlements  (P13-D)
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/:tenantId/entitlements",
  requireAuth,
  requirePlatformPermission("entitlements.read"),
  async (req, res) => {
    const workspaceId = parseInt(String((req.params as { tenantId: string }).tenantId ?? ""), 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "Invalid tenant ID." });
      return;
    }

    const workspace = await db.query.workspacesTable.findFirst({
      where: eq(workspacesTable.id, workspaceId),
    });
    if (!workspace) {
      res.status(404).json({ error: "Tenant not found." });
      return;
    }

    const [subscription] = await db
      .select()
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.workspaceId, workspaceId))
      .limit(1);

    const planCode = subscription?.planCode ?? null;

    const rawOverrides = await db
      .select()
      .from(tenantEntitlementOverridesTable)
      .where(eq(tenantEntitlementOverridesTable.workspaceId, workspaceId));

    const overrides: EntitlementOverrideRecord[] = rawOverrides.map(ov => ({
      id:           ov.id,
      moduleCode:   ov.moduleCode as EntitlementOverrideRecord["moduleCode"],
      overrideType: ov.overrideType as OverrideType,
      limitCode:    ov.limitCode as EntitlementOverrideRecord["limitCode"],
      limitValue:   ov.limitValue ?? null,
      reason:       ov.reason,
      createdBy:    ov.createdBy,
      createdAt:    ov.createdAt.toISOString(),
    }));

    const profile = deriveTenantEntitlementProfile(planCode, overrides, new Date());

    res.json({ entitlementProfile: profile, overrides });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /platform/tenants/:tenantId/entitlements/overrides  (P13-D)
// ─────────────────────────────────────────────────────────────────────────────

router.patch(
  "/:tenantId/entitlements/overrides",
  requireAuth,
  requirePlatformPermission("entitlements.override.update"),
  async (req, res) => {
    const workspaceId = parseInt(String((req.params as { tenantId: string }).tenantId ?? ""), 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "Invalid tenant ID." });
      return;
    }

    const [workspace] = await db
      .select({
        id:              workspacesTable.id,
        name:            workspacesTable.name,
        slug:            workspacesTable.slug,
        status:          workspacesTable.status,
        logoUrl:         workspacesTable.logoUrl,
        primaryColor:    workspacesTable.primaryColor,
        userCount:       sql<number>`(select count(*)::int from users where workspace_id = ${workspacesTable.id})`,
        ticketCount:     sql<number>`(select count(*)::int from tickets where workspace_id = ${workspacesTable.id})`,
        departmentCount: sql<number>`(select count(*)::int from departments where workspace_id = ${workspacesTable.id})`,
        createdAt:       workspacesTable.createdAt,
        updatedAt:       workspacesTable.updatedAt,
      })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId));
    if (!workspace) {
      res.status(404).json({ error: "Tenant not found." });
      return;
    }

    const body        = req.body as EntitlementOverridesBatchInput;
    const validation  = validateEntitlementOverridesBatch(body);
    if (!validation.valid) {
      res.status(422).json({ error: validation.message, code: validation.code });
      return;
    }

    const [subscription] = await db
      .select()
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.workspaceId, workspaceId))
      .limit(1);

    const planCode = subscription?.planCode ?? null;
    const actorId  = (req as AuthRequest).userId!;
    const now      = new Date();

    for (const ov of body.overrides) {
      if (ov.overrideType === "limit_override") {
        await db
          .delete(tenantEntitlementOverridesTable)
          .where(
            and(
              eq(tenantEntitlementOverridesTable.workspaceId, workspaceId),
              eq(tenantEntitlementOverridesTable.moduleCode,   ov.moduleCode),
              eq(tenantEntitlementOverridesTable.overrideType, "limit_override"),
              ov.limitCode != null
                ? eq(tenantEntitlementOverridesTable.limitCode, ov.limitCode)
                : sql`${tenantEntitlementOverridesTable.limitCode} IS NULL`,
            ),
          );
      } else {
        await db
          .delete(tenantEntitlementOverridesTable)
          .where(
            and(
              eq(tenantEntitlementOverridesTable.workspaceId, workspaceId),
              eq(tenantEntitlementOverridesTable.moduleCode,   ov.moduleCode),
              inArray(tenantEntitlementOverridesTable.overrideType, ["enable", "disable"]),
            ),
          );
      }

      await db.insert(tenantEntitlementOverridesTable).values({
        workspaceId,
        moduleCode:   ov.moduleCode,
        overrideType: ov.overrideType,
        limitCode:    ov.limitCode ?? null,
        limitValue:   ov.limitValue ?? null,
        reason:       ov.reason,
        createdBy:    actorId,
      });
    }

    const rawOverrides = await db
      .select()
      .from(tenantEntitlementOverridesTable)
      .where(eq(tenantEntitlementOverridesTable.workspaceId, workspaceId));

    const overrides: EntitlementOverrideRecord[] = rawOverrides.map(ov => ({
      id:           ov.id,
      moduleCode:   ov.moduleCode as EntitlementOverrideRecord["moduleCode"],
      overrideType: ov.overrideType as OverrideType,
      limitCode:    ov.limitCode as EntitlementOverrideRecord["limitCode"],
      limitValue:   ov.limitValue ?? null,
      reason:       ov.reason,
      createdBy:    ov.createdBy,
      createdAt:    ov.createdAt.toISOString(),
    }));

    const profile = deriveTenantEntitlementProfile(planCode, overrides, now);

    const combinedReason = body.overrides.map(o => o.reason).join("; ");
    const auditPayload   = buildEntitlementAuditPayload({
      tenantId:       String(workspaceId),
      workspaceId,
      actorId,
      planCode,
      addedOverrides: body.overrides,
      reason:         combinedReason,
      now,
    });

    await db.insert(activityLogsTable).values({
      workspaceId: null,
      userId:      actorId,
      action:      auditPayload.eventType,
      metadata:    JSON.stringify(auditPayload),
    });

    const [owner] = await db
      .select({ id: usersTable.id, email: usersTable.email, fullName: usersTable.fullName })
      .from(usersTable)
      .where(and(eq(usersTable.workspaceId, workspaceId), eq(usersTable.role, "admin")))
      .limit(1);

    const tenantProfile = buildTenantProfile(workspace, owner ?? null, now, subscription ?? null);

    res.json({
      entitlementProfile: profile,
      overrides,
      tenant:     tenantProfile,
      auditEvent: auditPayload,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/tenants/:tenantId/usage  (P13-E)
// Read-only usage and capacity intelligence for a single tenant.
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/:tenantId/usage",
  requireAuth,
  requirePlatformPermission("usage.read"),
  async (req: AuthRequest, res) => {
    const workspaceId = parseInt(String((req.params as { tenantId: string }).tenantId ?? ""), 10);
    if (isNaN(workspaceId) || workspaceId <= 0) {
      res.status(400).json({ error: "Invalid tenant ID." });
      return;
    }

    const now = new Date();

    const [workspace] = await db
      .select({ id: workspacesTable.id, name: workspacesTable.name, status: workspacesTable.status })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId));
    if (!workspace) {
      res.status(404).json({ error: "Tenant not found." });
      return;
    }

    const [subscription] = await db
      .select()
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.workspaceId, workspaceId))
      .limit(1);

    const planCode = subscription?.planCode ?? null;

    const rawOverrides = await db
      .select()
      .from(tenantEntitlementOverridesTable)
      .where(eq(tenantEntitlementOverridesTable.workspaceId, workspaceId));

    const overrides: EntitlementOverrideRecord[] = rawOverrides.map(ov => ({
      id:           ov.id,
      moduleCode:   ov.moduleCode as EntitlementOverrideRecord["moduleCode"],
      overrideType: ov.overrideType as OverrideType,
      limitCode:    ov.limitCode as EntitlementOverrideRecord["limitCode"],
      limitValue:   ov.limitValue ?? null,
      reason:       ov.reason,
      createdBy:    ov.createdBy,
      createdAt:    ov.createdAt.toISOString(),
    }));

    const entitlementProfile = deriveTenantEntitlementProfile(planCode, overrides, now);

    const rawUsage = await collectTenantRawUsage(
      workspaceId,
      entitlementProfile.limits as Record<string, number | null>,
    );

    const usageProfile = deriveTenantUsageProfile(
      String(workspaceId),
      workspaceId,
      rawUsage,
      entitlementProfile,
      now,
    );

    const { warnings } = summarizeUsageWarnings(usageProfile.metrics);

    req.log.info({
      actorId:           req.userId,
      tenantId:          workspaceId,
      workspaceId,
      action:            "tenant_usage_profile_read",
      warningCount:      usageProfile.warningCount,
      exceededCount:     usageProfile.exceededCount,
      unknownCount:      usageProfile.unknownCount,
      capacityRiskLevel: usageProfile.capacityRiskLevel,
    });

    res.json({
      usageProfile,
      entitlementProfileSummary: {
        planCode:          entitlementProfile.planCode,
        planTier:          entitlementProfile.planTier,
        enabledCount:      entitlementProfile.enabledModules.length,
        customOverrides:   entitlementProfile.customEntitlementsCount,
        limits:            entitlementProfile.limits,
      },
      rawUsageSources: Object.fromEntries(
        Object.entries(rawUsage).map(([code, entry]) => [code, { sourceType: entry.sourceType, notes: entry.notes }]),
      ),
      warnings,
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/tenants/:tenantId/renewal-intelligence
// P13-F - Subscription Expiry, Grace Period & Renewal Intelligence
// READ-ONLY - no mutations, no suspension, no enforcement.
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/renewal-intelligence",
  requireAuth,
  requirePlatformPermission("renewal.read"),
  async (req, res) => {
    const tenantIdRaw = parseInt(
      String((req.params as { tenantId: string }).tenantId ?? ""),
      10,
    );
    if (isNaN(tenantIdRaw) || tenantIdRaw <= 0) {
      res.status(400).json({ error: "Invalid tenantId - must be a positive integer." });
      return;
    }

    const authReq = req as AuthRequest;

    // Verify tenant exists
    const [workspace] = await db
      .select({ id: workspacesTable.id, name: workspacesTable.name, status: workspacesTable.status })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, tenantIdRaw))
      .limit(1);

    if (!workspace) {
      res.status(404).json({ error: "Tenant not found." });
      return;
    }

    const now = new Date();

    // Fetch subscription metadata
    const [subRow] = await db
      .select()
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.workspaceId, tenantIdRaw))
      .limit(1);

    const subFields = subRow
      ? {
          planCode:             subRow.planCode,
          subscriptionStatus:   subRow.subscriptionStatus,
          billingPeriodStart:   subRow.billingPeriodStart,
          billingPeriodEnd:     subRow.billingPeriodEnd,
          renewalDueAt:         subRow.renewalDueAt,
          trialStartedAt:       subRow.trialStartedAt,
          trialEndsAt:          subRow.trialEndsAt,
          gracePeriodStartedAt: subRow.gracePeriodStartedAt,
          gracePeriodEndsAt:    subRow.gracePeriodEndsAt,
          cancelledAt:          subRow.cancelledAt,
          suspendedAt:          subRow.suspendedAt,
        }
      : null;

    // Derive renewal profile
    const renewalProfile = deriveSubscriptionRenewalProfile(
      tenantIdRaw,
      subFields,
      now,
      subRow ? String(subRow.id) : null,
    );

    // Subscription summary for UI context
    const subscriptionSummary = subRow
      ? {
          planCode:             subRow.planCode,
          subscriptionStatus:   subRow.subscriptionStatus,
          billingPeriodStart:   subRow.billingPeriodStart?.toISOString()   ?? null,
          billingPeriodEnd:     subRow.billingPeriodEnd?.toISOString()     ?? null,
          renewalDueAt:         subRow.renewalDueAt?.toISOString()         ?? null,
          trialStartedAt:       subRow.trialStartedAt?.toISOString()       ?? null,
          trialEndsAt:          subRow.trialEndsAt?.toISOString()          ?? null,
          gracePeriodStartedAt: subRow.gracePeriodStartedAt?.toISOString() ?? null,
          gracePeriodEndsAt:    subRow.gracePeriodEndsAt?.toISOString()    ?? null,
          cancelledAt:          subRow.cancelledAt?.toISOString()          ?? null,
          suspendedAt:          subRow.suspendedAt?.toISOString()          ?? null,
        }
      : null;

    req.log.info({
      actorId:           authReq.userId,
      tenantId:          tenantIdRaw,
      workspaceId:       tenantIdRaw,
      action:            "tenant_renewal_intelligence_read",
      urgency:           renewalProfile.urgency,
      recommendedAction: renewalProfile.recommendedAction,
      signalCount:       renewalProfile.signals.length,
    });

    res.json({
      renewalProfile,
      subscriptionSummary,
      warnings: renewalProfile.warnings,
      safetyNotice:
        "Renewal intelligence is read-only and informational. No automatic enforcement, suspension, or payment action is taken.",
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/tenants/:tenantId/health
// P13-G - Tenant Health, Risk Signals & Operational Monitoring
// READ-ONLY - no mutations, no suspension, no enforcement, no billing.
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/health",
  requireAuth,
  requirePlatformPermission("health.read"),
  async (req, res) => {
    const tenantIdRaw = parseInt(
      String((req.params as { tenantId: string }).tenantId ?? ""),
      10,
    );
    if (isNaN(tenantIdRaw) || tenantIdRaw <= 0) {
      res.status(400).json({ error: "Invalid tenantId - must be a positive integer." });
      return;
    }

    const authReq = req as AuthRequest;

    // Verify tenant exists
    const [workspace] = await db
      .select({ id: workspacesTable.id, name: workspacesTable.name, status: workspacesTable.status })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, tenantIdRaw))
      .limit(1);

    if (!workspace) {
      res.status(404).json({ error: "Tenant not found." });
      return;
    }

    const now = new Date();

    // Fetch subscription metadata
    const [subRow] = await db
      .select()
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.workspaceId, tenantIdRaw))
      .limit(1);

    const subFields = subRow
      ? {
          planCode:             subRow.planCode,
          subscriptionStatus:   subRow.subscriptionStatus,
          billingPeriodStart:   subRow.billingPeriodStart,
          billingPeriodEnd:     subRow.billingPeriodEnd,
          renewalDueAt:         subRow.renewalDueAt,
          trialStartedAt:       subRow.trialStartedAt,
          trialEndsAt:          subRow.trialEndsAt,
          gracePeriodStartedAt: subRow.gracePeriodStartedAt,
          gracePeriodEndsAt:    subRow.gracePeriodEndsAt,
          cancelledAt:          subRow.cancelledAt,
          suspendedAt:          subRow.suspendedAt,
        }
      : null;

    const planCode = subRow?.planCode ?? null;

    // Fetch entitlement overrides
    const rawOverrides = await db
      .select()
      .from(tenantEntitlementOverridesTable)
      .where(eq(tenantEntitlementOverridesTable.workspaceId, tenantIdRaw));

    const overrides: EntitlementOverrideRecord[] = rawOverrides.map(ov => ({
      id:           ov.id,
      moduleCode:   ov.moduleCode as EntitlementOverrideRecord["moduleCode"],
      overrideType: ov.overrideType as OverrideType,
      limitCode:    ov.limitCode as EntitlementOverrideRecord["limitCode"],
      limitValue:   ov.limitValue ?? null,
      reason:       ov.reason,
      createdBy:    ov.createdBy,
      createdAt:    ov.createdAt.toISOString(),
    }));

    // Derive entitlement profile
    const entitlementProfile = deriveTenantEntitlementProfile(planCode, overrides, now);

    // Derive usage profile
    const rawUsage = await collectTenantRawUsage(
      tenantIdRaw,
      entitlementProfile.limits as Record<string, number | null>,
    );
    const usageProfile = deriveTenantUsageProfile(
      String(tenantIdRaw),
      tenantIdRaw,
      rawUsage,
      entitlementProfile,
      now,
    );

    // Derive renewal profile for renewal signals + urgency
    const renewalProfile = deriveSubscriptionRenewalProfile(
      tenantIdRaw,
      subFields,
      now,
      subRow ? String(subRow.id) : null,
    );

    // Derive subscription status string
    const subscriptionStatusStr: string = subRow && subFields
      ? deriveSubscriptionStatus(subFields, now)
      : "unknown";

    // Build TenantHealthInput from all available intelligence layers
    const healthInput: TenantHealthInput = {
      tenantId:           String(tenantIdRaw),
      workspaceId:        tenantIdRaw,
      workspaceStatus:    workspace.status,
      subscriptionStatus: subscriptionStatusStr,
      renewal: {
        urgency:  renewalProfile.urgency,
        signals:  renewalProfile.signals,
        warnings: renewalProfile.warnings,
      },
      usage: {
        capacityRiskLevel: usageProfile.capacityRiskLevel,
        warningCount:       usageProfile.warningCount,
        exceededCount:      usageProfile.exceededCount,
        unknownCount:       usageProfile.unknownCount,
      },
      entitlements: {
        customEntitlementsCount: entitlementProfile.customEntitlementsCount,
        planCode:                entitlementProfile.planCode,
      },
      governance: {
        hasWarnings: workspace.status === "suspended",
      },
    };

    const healthProfile = deriveTenantHealthProfile(healthInput, now);

    req.log.info({
      actorId:           authReq.userId,
      tenantId:          tenantIdRaw,
      workspaceId:       tenantIdRaw,
      action:            "tenant_health_profile_read",
      healthStatus:      healthProfile.healthStatus,
      riskLevel:         healthProfile.riskLevel,
      recommendedAction: healthProfile.recommendedAction,
      warningCount:      healthProfile.warnings.length,
      signalCount:       healthProfile.signals.length,
    });

    res.json({
      healthProfile,
      componentSummaries: healthProfile.components,
      warnings:           healthProfile.warnings,
      safetyNotice:       "Tenant health is read-only and informational. No automatic actions, suspension, or billing operations are performed.",
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// P13-I - GET /platform/tenants/:tenantId/lifecycle-evaluation
// Lifecycle Evaluation Engine - super-admin only, read-only, no mutations.
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/lifecycle-evaluation",
  requireAuth,
  requirePlatformPermission("evaluation.read"),
  async (req, res) => {
    const tenantIdRaw = parseInt(
      String((req.params as { tenantId: string }).tenantId ?? ""),
      10,
    );
    if (isNaN(tenantIdRaw) || tenantIdRaw <= 0) {
      res.status(400).json({ error: "Invalid tenantId - must be a positive integer." });
      return;
    }

    const authReq = req as AuthRequest;

    // Verify tenant exists
    const [workspace] = await db
      .select({ id: workspacesTable.id, name: workspacesTable.name, status: workspacesTable.status })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, tenantIdRaw))
      .limit(1);

    if (!workspace) {
      res.status(404).json({ error: "Tenant not found." });
      return;
    }

    const now = new Date();

    // Fetch subscription metadata
    const [subRow] = await db
      .select()
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.workspaceId, tenantIdRaw))
      .limit(1);

    const subFields = subRow
      ? {
          planCode:             subRow.planCode,
          subscriptionStatus:   subRow.subscriptionStatus,
          billingPeriodStart:   subRow.billingPeriodStart,
          billingPeriodEnd:     subRow.billingPeriodEnd,
          renewalDueAt:         subRow.renewalDueAt,
          trialStartedAt:       subRow.trialStartedAt,
          trialEndsAt:          subRow.trialEndsAt,
          gracePeriodStartedAt: subRow.gracePeriodStartedAt,
          gracePeriodEndsAt:    subRow.gracePeriodEndsAt,
          cancelledAt:          subRow.cancelledAt,
          suspendedAt:          subRow.suspendedAt,
        }
      : null;

    const planCode = subRow?.planCode ?? null;

    // Derive subscription status
    const subscriptionStatusStr: string = subRow && subFields
      ? deriveSubscriptionStatus(subFields, now)
      : "unknown";

    // Fetch entitlement overrides
    const rawOverrides = await db
      .select()
      .from(tenantEntitlementOverridesTable)
      .where(eq(tenantEntitlementOverridesTable.workspaceId, tenantIdRaw));

    const overrides: EntitlementOverrideRecord[] = rawOverrides.map(ov => ({
      id:           ov.id,
      moduleCode:   ov.moduleCode as EntitlementOverrideRecord["moduleCode"],
      overrideType: ov.overrideType as OverrideType,
      limitCode:    ov.limitCode as EntitlementOverrideRecord["limitCode"],
      limitValue:   ov.limitValue ?? null,
      reason:       ov.reason,
      createdBy:    ov.createdBy,
      createdAt:    ov.createdAt.toISOString(),
    }));

    const entitlementProfile = deriveTenantEntitlementProfile(planCode, overrides, now);

    // Derive usage profile
    const rawUsage = await collectTenantRawUsage(
      tenantIdRaw,
      entitlementProfile.limits as Record<string, number | null>,
    );
    const usageProfile = deriveTenantUsageProfile(
      String(tenantIdRaw),
      tenantIdRaw,
      rawUsage,
      entitlementProfile,
      now,
    );

    // Derive renewal profile
    const renewalProfile = deriveSubscriptionRenewalProfile(
      tenantIdRaw,
      subFields,
      now,
      subRow ? String(subRow.id) : null,
    );

    // Derive lifecycle state
    const { deriveLifecycleState } = await import("../lib/workspace-lifecycle");
    const lifecycleState = deriveLifecycleState(workspace.status);

    // Build TenantHealthInput for health derivation
    const healthInput: TenantHealthInput = {
      tenantId:           String(tenantIdRaw),
      workspaceId:        tenantIdRaw,
      workspaceStatus:    workspace.status,
      subscriptionStatus: subscriptionStatusStr,
      renewal: {
        urgency:  renewalProfile.urgency,
        signals:  renewalProfile.signals,
        warnings: renewalProfile.warnings,
      },
      usage: {
        capacityRiskLevel: usageProfile.capacityRiskLevel,
        warningCount:       usageProfile.warningCount,
        exceededCount:      usageProfile.exceededCount,
        unknownCount:       usageProfile.unknownCount,
      },
      entitlements: {
        customEntitlementsCount: entitlementProfile.customEntitlementsCount,
        planCode:                entitlementProfile.planCode,
      },
      governance: {
        hasWarnings: workspace.status === "suspended",
      },
    };

    const healthProfile = deriveTenantHealthProfile(healthInput, now);

    // Build lifecycle evaluation input from all derived intelligence layers
    const evalInput: TenantLifecycleEvaluationInput = {
      tenantId:    String(tenantIdRaw),
      workspaceId: tenantIdRaw,
      lifecycle: {
        workspaceStatus: workspace.status,
        lifecycleState:  lifecycleState,
      },
      subscription: {
        subscriptionStatus:  subscriptionStatusStr,
        planCode,
        renewalDueSoon:      renewalProfile.signals.includes("renewal_due_soon"),
        renewalDueNow:       renewalProfile.signals.includes("renewal_due_now"),
        trialEndingSoon:     renewalProfile.signals.includes("trial_ending_soon"),
        gracePeriodActive:   renewalProfile.signals.includes("grace_period_active"),
        graceEndingSoon:     renewalProfile.signals.includes("grace_period_ending_soon"),
        graceExpired:        renewalProfile.signals.includes("grace_period_expired"),
        subscriptionExpired: renewalProfile.signals.includes("billing_period_expired") ||
                             subscriptionStatusStr === "expired",
        hasMissingMetadata:  !subRow,
      },
      usage: {
        capacityRiskLevel: usageProfile.capacityRiskLevel,
        warningCount:       usageProfile.warningCount,
        exceededCount:      usageProfile.exceededCount,
        unknownCount:       usageProfile.unknownCount,
      },
      entitlements: {
        customEntitlementsCount: entitlementProfile.customEntitlementsCount,
        planCode:                entitlementProfile.planCode,
      },
      health: {
        healthRiskLevel:         healthProfile.riskLevel,
        healthStatus:            healthProfile.healthStatus,
        healthRecommendedAction: healthProfile.recommendedAction,
        healthWarningCount:      healthProfile.warnings.length,
      },
      governance: {
        hasWarnings: workspace.status === "suspended",
      },
    };

    const evaluationProfile = deriveTenantLifecycleEvaluationProfile(evalInput, now);

    req.log.info({
      actorId:              authReq.userId,
      tenantId:             tenantIdRaw,
      workspaceId:          tenantIdRaw,
      action:               "tenant_lifecycle_evaluation_read",
      severity:             evaluationProfile.severity,
      recommendedAction:    evaluationProfile.recommendedAction,
      manualReviewRequired: evaluationProfile.reviewEligibility.manualReviewRequired,
      signalCount:          evaluationProfile.signals.length,
    });

    res.json({
      evaluationProfile,
      componentSummaries: {
        lifecycle:    { workspaceStatus: workspace.status, lifecycleState },
        subscription: { status: subscriptionStatusStr, planCode },
        usage:        { capacityRiskLevel: usageProfile.capacityRiskLevel, warningCount: usageProfile.warningCount, exceededCount: usageProfile.exceededCount },
        health:       { status: healthProfile.healthStatus, riskLevel: healthProfile.riskLevel },
        entitlements: { customCount: entitlementProfile.customEntitlementsCount, planCode },
      },
      warnings:    evaluationProfile.warnings,
      safetyNotice: evaluationProfile.safetyNotice,
    });
  },
);

export default router;
