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
import {
  workspacesTable,
  usersTable,
  workspaceSubscriptionsTable,
  workspaceModuleSettingsTable,
  workflowDefinitionsTable,
} from "@workspace/db";
import { eq, inArray, and, sql }    from "drizzle-orm";
import { type AuthRequest, requireAuth, requirePlatformPermission } from "../middlewares/requireAuth";
import {
  buildTenantProfile,
  applyTenantFilters,
  sortTenantsByName,
  type TenantFilterOptions,
  type RawSubscriptionRow,
} from "../lib/tenant-registry";
import { workspaceLifecycleService } from "../lib/platform/workspace-lifecycle-service";
import { deriveSubscriptionStatus } from "../lib/subscription-lifecycle";
import { deriveTenantEntitlementProfile } from "../lib/tenant-entitlements";
import {
  snapshotToRawSubscriptionRow,
  workspaceSubscriptionToSnapshot,
} from "../lib/canonical-subscription-registry";
import { loadCanonicalSubscriptionRawRow } from "../lib/canonical-subscription-loader";
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// collectTenantRawUsage  (local helper - read-only, no side effects)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /platform/tenants
// List all platform tenant profiles. Super-admin only.
// Query params: status, subscriptionStatus, riskLevel, search
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    const subscriptionRows =
      workspaceIds.length > 0
        ? await db
            .select()
            .from(workspaceSubscriptionsTable)
            .where(inArray(workspaceSubscriptionsTable.workspaceId, workspaceIds))
        : [];
    const subscriptionByWorkspace = new Map(
      subscriptionRows.map((s) => [s.workspaceId, s]),
    );

    const profiles = workspaces.map((ws) => {
      const sub = subscriptionByWorkspace.get(ws.id);
      const rawSub: RawSubscriptionRow | null = sub
        ? (snapshotToRawSubscriptionRow(
            workspaceSubscriptionToSnapshot(sub, now),
          ) as RawSubscriptionRow)
        : null;
      return buildTenantProfile(ws, ownerMap.get(ws.id) ?? null, now, rawSub);
    });

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /platform/tenants/:tenantId
// Single tenant profile. Super-admin only.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    const { raw: rawSub } = await loadCanonicalSubscriptionRawRow(workspaceId, now);
    const profile = buildTenantProfile(workspace, owner ?? null, now, rawSub);

    req.log.info({
      actorId:  req.userId,
      tenantId: workspaceId,
      action:   "tenant_profile_read",
    });

    res.json({ tenant: profile });
  },
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /platform/tenants/:tenantId/summary
// Lightweight tenant summary - no owner lookup, reduced payload.
// Super-admin only.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    const { raw: rawSub } = await loadCanonicalSubscriptionRawRow(workspaceId, now);
    const profile = buildTenantProfile(workspace, null, now, rawSub);

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PATCH /platform/tenants/:tenantId/lifecycle
// Controlled workspace lifecycle state transition. Super-admin only.
// Body: { action, reason, internalNote?, confirmation }
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      const { raw: rawSub } = await loadCanonicalSubscriptionRawRow(workspaceId, now);
      const profile = buildTenantProfile(workspace, owner ?? null, now, rawSub);

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
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /platform/tenants/:tenantId/usage  (P13-E)
// Read-only usage and capacity intelligence for a single tenant.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    const { planCode } = await loadCanonicalSubscriptionRawRow(workspaceId, now);
    const moduleSettings = await db
      .select()
      .from(workspaceModuleSettingsTable)
      .where(eq(workspaceModuleSettingsTable.workspaceId, workspaceId));

    const entitlementProfile = deriveTenantEntitlementProfile(planCode, [], now);
    entitlementProfile.customEntitlementsCount = moduleSettings.length;

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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /platform/tenants/:tenantId/renewal-intelligence
// P13-F - Subscription Expiry, Grace Period & Renewal Intelligence
// READ-ONLY - no mutations, no suspension, no enforcement.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    const { raw: subFields, subscriptionId, planCode } =
      await loadCanonicalSubscriptionRawRow(tenantIdRaw, now);

    const renewalProfile = deriveSubscriptionRenewalProfile(
      tenantIdRaw,
      subFields,
      now,
      subscriptionId,
    );

    const subscriptionSummary = subFields
      ? {
          planCode,
          subscriptionStatus:   subFields.subscriptionStatus,
          billingPeriodStart:   subFields.billingPeriodStart?.toISOString()   ?? null,
          billingPeriodEnd:     subFields.billingPeriodEnd?.toISOString()     ?? null,
          renewalDueAt:         subFields.renewalDueAt?.toISOString()         ?? null,
          trialStartedAt:       subFields.trialStartedAt?.toISOString()       ?? null,
          trialEndsAt:          subFields.trialEndsAt?.toISOString()          ?? null,
          gracePeriodStartedAt: subFields.gracePeriodStartedAt?.toISOString() ?? null,
          gracePeriodEndsAt:    subFields.gracePeriodEndsAt?.toISOString()    ?? null,
          cancelledAt:          subFields.cancelledAt?.toISOString()          ?? null,
          suspendedAt:          subFields.suspendedAt?.toISOString()          ?? null,
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /platform/tenants/:tenantId/health
// P13-G - Tenant Health, Risk Signals & Operational Monitoring
// READ-ONLY - no mutations, no suspension, no enforcement, no billing.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    const { raw: subFields, subscriptionId, planCode } =
      await loadCanonicalSubscriptionRawRow(tenantIdRaw, now);

    const moduleSettings = await db
      .select()
      .from(workspaceModuleSettingsTable)
      .where(eq(workspaceModuleSettingsTable.workspaceId, tenantIdRaw));

    const entitlementProfile = deriveTenantEntitlementProfile(planCode, [], now);
    entitlementProfile.customEntitlementsCount = moduleSettings.length;

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

    const renewalProfile = deriveSubscriptionRenewalProfile(
      tenantIdRaw,
      subFields,
      now,
      subscriptionId,
    );

    const subscriptionStatusStr: string = subFields
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// P13-I - GET /platform/tenants/:tenantId/lifecycle-evaluation
// Lifecycle Evaluation Engine - super-admin only, read-only, no mutations.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    const { raw: subFields, subscriptionId, planCode } =
      await loadCanonicalSubscriptionRawRow(tenantIdRaw, now);

    const moduleSettings = await db
      .select()
      .from(workspaceModuleSettingsTable)
      .where(eq(workspaceModuleSettingsTable.workspaceId, tenantIdRaw));

    const subscriptionStatusStr: string = subFields
      ? deriveSubscriptionStatus(subFields, now)
      : "unknown";

    const entitlementProfile = deriveTenantEntitlementProfile(planCode, [], now);
    entitlementProfile.customEntitlementsCount = moduleSettings.length;

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

    const renewalProfile = deriveSubscriptionRenewalProfile(
      tenantIdRaw,
      subFields,
      now,
      subscriptionId,
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
