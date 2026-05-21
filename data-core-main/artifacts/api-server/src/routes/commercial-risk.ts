/**
 * @file   routes/commercial-risk.ts
 * @phase  P15-F - Commercial Risk & Renewal Readiness (read-only)
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activityLogsTable } from "@workspace/db";
import {
  type AuthRequest,
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission,
} from "../middlewares/requireAuth";
import {
  aggregateCommercialRiskSummary,
  type CommercialRiskAssessment,
  type CommercialRiskLevel,
  type RenewalReadinessStatus,
} from "../lib/commercial-risk-engine";
import {
  loadAllTenantCommercialRiskAssessments,
  loadTenantCommercialRiskAssessment,
} from "../lib/commercial-risk-loader";

const router: IRouter = Router();

async function auditRiskView(
  action: string,
  actorId: number | undefined,
  meta: Record<string, unknown>,
) {
  await db.insert(activityLogsTable).values({
    userId: actorId ?? null,
    workspaceId: typeof meta.tenantId === "number" ? meta.tenantId : null,
    action,
    metadata: JSON.stringify({
      ...meta,
      timestamp: new Date().toISOString(),
    }),
  });
}

function toListItem(a: CommercialRiskAssessment) {
  return {
    tenantId: a.tenantId,
    tenantName: a.tenantName,
    riskLevel: a.riskLevel,
    renewalReadinessStatus: a.renewalReadinessStatus,
    outstandingAmount: a.signals.outstandingAmount,
    overdueInvoiceCount: a.signals.overdueInvoiceCount,
    contractEndDate: a.signals.contractEndDate,
    renewalDate: a.signals.renewalDate,
    reasons: a.reasons,
  };
}

// ── GET platform summary ──────────────────────────────────────────────────────

router.get(
  "/platform/commercial-risk/summary",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.risk.read"),
  async (_req: AuthRequest, res) => {
    const assessments = await loadAllTenantCommercialRiskAssessments();
    const summary = aggregateCommercialRiskSummary(assessments);
    res.json({ summary });
  },
);

// ── GET risk list ─────────────────────────────────────────────────────────────

router.get(
  "/platform/commercial-risk/list",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.risk.read"),
  async (req: AuthRequest, res) => {
    let assessments = await loadAllTenantCommercialRiskAssessments();

    const riskLevel = typeof req.query.riskLevel === "string" ? req.query.riskLevel : undefined;
    const readiness = typeof req.query.renewalReadinessStatus === "string"
      ? req.query.renewalReadinessStatus
      : undefined;
    const hasOverdue = req.query.hasOverdueInvoices === "true";
    const renewalWithinDays = req.query.renewalWithinDays !== undefined
      ? Number(req.query.renewalWithinDays)
      : undefined;

    const validRisk: CommercialRiskLevel[] = ["low", "medium", "high", "critical"];
    const validReadiness: RenewalReadinessStatus[] = [
      "ready",
      "attention_needed",
      "at_risk",
      "blocked",
      "no_active_contract",
    ];

    if (riskLevel && !validRisk.includes(riskLevel as CommercialRiskLevel)) {
      res.status(400).json({ error: "Invalid riskLevel filter" });
      return;
    }
    if (readiness && !validReadiness.includes(readiness as RenewalReadinessStatus)) {
      res.status(400).json({ error: "Invalid renewalReadinessStatus filter" });
      return;
    }

    if (riskLevel) {
      assessments = assessments.filter(a => a.riskLevel === riskLevel);
    }
    if (readiness) {
      assessments = assessments.filter(a => a.renewalReadinessStatus === readiness);
    }
    if (hasOverdue) {
      assessments = assessments.filter(a => a.signals.hasOverdueInvoices);
    }
    if (renewalWithinDays !== undefined) {
      if (!Number.isFinite(renewalWithinDays) || renewalWithinDays < 0) {
        res.status(400).json({ error: "Invalid renewalWithinDays filter" });
        return;
      }
      assessments = assessments.filter(a => {
        const d = a.signals.daysUntilRenewalDate;
        return d !== null && d >= 0 && d <= renewalWithinDays;
      });
    }

    res.json({
      tenants: assessments.map(a => toListItem(a)),
    });
  },
);

// ── GET tenant detail ─────────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/commercial-risk",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.risk.read"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenantId" });
      return;
    }

    const assessment = await loadTenantCommercialRiskAssessment(tenantId);
    if (!assessment) {
      await auditRiskView("commercial_risk_access_denied", req.userId, {
        actorId: req.userId,
        tenantId,
        result: "denied",
        reason: "tenant_not_found",
      });
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    await auditRiskView("commercial_risk_viewed", req.userId, {
      actorId: req.userId,
      tenantId,
      riskLevel: assessment.riskLevel,
      renewalReadinessStatus: assessment.renewalReadinessStatus,
      result: "success",
    });

    res.json({ risk: assessment });
  },
);

export default router;
