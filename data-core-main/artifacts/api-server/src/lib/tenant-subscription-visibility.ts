/**
 * @file   tenant-subscription-visibility.ts
 * @phase  P16-G - Tenant-safe subscription visibility builders
 */

import { db } from "@workspace/db";
import {
  commercialAccountsTable,
  commercialBillingContactsTable,
  workspaceSubscriptionsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { resolveWorkspaceAccessMode } from "./workspace-access-resolver";
import { listTenantProductModules } from "./platform/tenant-product-modules";
import { isWorkspaceReadOnlyEnforcement } from "./workspace-access-enforcement-config";

const INTERNAL_REASON_PATTERNS =
  /collection|outstanding|dunning|stripe|payment|risk score|internal|audit|ledger|zatca/i;

export function utcDaysFromToday(isoDate: string | null | undefined, asOf = new Date()): {
  daysUntilEnd: number | null;
  daysPastEnd: number | null;
} {
  if (!isoDate) return { daysUntilEnd: null, daysPastEnd: null };
  const end = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) return { daysUntilEnd: null, daysPastEnd: null };
  const today = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  const endDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  );
  const diffDays = Math.round((endDay.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays >= 0) {
    return { daysUntilEnd: diffDays, daysPastEnd: null };
  }
  return { daysUntilEnd: null, daysPastEnd: Math.abs(diffDays) };
}

export function sanitizeTenantReadOnlyReason(reason: string | null | undefined): string | null {
  if (!reason?.trim()) return null;
  if (INTERNAL_REASON_PATTERNS.test(reason)) return null;
  return reason.trim().slice(0, 500);
}

export function tenantRecommendedStatusLabel(
  recommendedStatus: string | undefined,
): string | null {
  if (!recommendedStatus || recommendedStatus === "no_change") return null;
  const labels: Record<string, string> = {
    active: "Active",
    grace_period: "Grace period",
    past_due: "Past due",
    suspended: "Suspended",
    terminated: "Ended",
    review_required: "Under review",
  };
  return labels[recommendedStatus] ?? null;
}

export async function loadTenantSupportContact(workspaceId: number) {
  const account = await db.query.commercialAccountsTable.findFirst({
    where: eq(commercialAccountsTable.workspaceId, workspaceId),
  });
  if (!account) return null;

  const primary = await db.query.commercialBillingContactsTable.findFirst({
    where: and(
      eq(commercialBillingContactsTable.commercialAccountId, account.id),
      eq(commercialBillingContactsTable.isPrimary, true),
    ),
  });

  const contact =
    primary ??
    (
      await db
        .select()
        .from(commercialBillingContactsTable)
        .where(eq(commercialBillingContactsTable.commercialAccountId, account.id))
        .orderBy(desc(commercialBillingContactsTable.id))
        .limit(1)
    )[0];

  if (!contact) return null;

  return {
    contactName: contact.contactName,
    contactEmail: contact.contactEmail,
    contactPhone: contact.contactPhone,
    contactRole: contact.contactRole,
  };
}

export async function buildTenantSubscriptionSummary(workspaceId: number) {
  const subscription = await db.query.workspaceSubscriptionsTable.findFirst({
    where: eq(workspaceSubscriptionsTable.workspaceId, workspaceId),
  });

  const access = await resolveWorkspaceAccessMode(workspaceId);
  const readOnlyMode = isWorkspaceReadOnlyEnforcement(access.enforcementStatus);

  const { daysUntilEnd, daysPastEnd } = utcDaysFromToday(subscription?.endDate ?? null);
  const supportContact = await loadTenantSupportContact(workspaceId);

  return {
    subscriptionStatus: subscription?.status ?? "none",
    planName: subscription?.planName ?? subscription?.subscriptionName ?? null,
    startDate: subscription?.startDate ?? null,
    endDate: subscription?.endDate ?? null,
    renewalDate: subscription?.renewalDate ?? null,
    gracePeriodEndsAt: subscription?.gracePeriodEndsAt ?? null,
    accessMode: access.enforcementStatus,
    readOnlyMode,
    readOnlyReason: readOnlyMode ? sanitizeTenantReadOnlyReason(access.reason) : null,
    daysUntilEnd,
    daysPastEnd,
    recommendedStatus: null,
    supportContact,
  };
}

export async function buildTenantSubscriptionEntitlements(workspaceId: number) {
  const rows = await listTenantProductModules(workspaceId);
  return {
    modules: rows.map((m) => ({
      moduleKey: m.key,
      label: m.name,
      labelAr: m.name,
      description: m.description,
      isCore: m.core,
      isEnabled: m.enabled,
      features: [],
    })),
  };
}

export async function buildTenantSubscriptionQuotas(_workspaceId: number) {
  return { quotas: [] as Array<Record<string, unknown>> };
}
