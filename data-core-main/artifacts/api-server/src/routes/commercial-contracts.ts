/**
 * @file   routes/commercial-contracts.ts
 * @phase  P15-B - Contract Terms & Renewal Commitments
 *
 * GET    /platform/tenants/:tenantId/commercial-contracts
 * GET    /platform/tenants/:tenantId/commercial-contracts/:contractId
 * POST   /platform/tenants/:tenantId/commercial-contracts
 * PATCH  /platform/tenants/:tenantId/commercial-contracts/:contractId
 * PATCH  /platform/tenants/:tenantId/commercial-contracts/:contractId/status
 *
 * SAFETY: no payment, invoice generation, PDF upload, tax, email, or delete.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  workspacesTable,
  activityLogsTable,
  commercialAccountsTable,
  commercialContractTermsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, ne, isNull } from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission,
} from "../middlewares/requireAuth";

const VALID_RENEWAL_TYPES = ["manual", "auto_renewal", "non_renewing", "under_negotiation"] as const;
const VALID_COMMITMENT_STATUSES = [
  "not_started", "pending_customer", "pending_internal", "committed", "declined", "expired",
] as const;
const VALID_BILLING_CYCLES = ["monthly", "quarterly", "semi_annual", "annual", "custom"] as const;
const VALID_PAYMENT_TERMS = ["due_on_receipt", "net_15", "net_30", "net_45", "net_60", "custom"] as const;
const VALID_STATUSES = ["draft", "active", "expired", "terminated", "archived"] as const;
const VALID_CURRENCIES = new Set(["SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 2000;
const MAX_TITLE = 200;
const MAX_NAME = 200;
const MAX_NUMBER = 100;
const MIN_REASON_LEN = 10;

function strOpt(v: unknown, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return null;
  return v.trim().slice(0, max) || null;
}

function isValidEmail(v: unknown): boolean {
  return typeof v === "string" && EMAIL_RE.test(v.trim());
}

function parseDate(v: unknown): string | null | "INVALID" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "INVALID";
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "INVALID";
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "INVALID";
  return s;
}

function parseNonNegativeInt(v: unknown, field: string): number | null | "INVALID" | "MISSING" {
  if (v === undefined) return "MISSING";
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return "INVALID";
  return n;
}

function parsePositiveInt(v: unknown): number | null | "INVALID" | "MISSING" {
  if (v === undefined) return "MISSING";
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return "INVALID";
  return n;
}

function parseContractValue(v: unknown): string | null | "INVALID" | "MISSING" {
  if (v === undefined) return "MISSING";
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "INVALID";
  return n.toFixed(2);
}

function compareDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function validateDateOrder(input: {
  contractStartDate: string | null;
  contractEndDate: string | null;
  renewalDate: string | null;
}): string | null {
  const { contractStartDate: start, contractEndDate: end, renewalDate: renewal } = input;
  if (start && end && compareDates(start, end) > 0) {
    return "contractStartDate must be on or before contractEndDate";
  }
  if (renewal && start && compareDates(renewal, start) < 0) {
    return "renewalDate must be on or after contractStartDate";
  }
  if (renewal && end && compareDates(renewal, end) > 0) {
    return "renewalDate must be on or before contractEndDate";
  }
  return null;
}

async function assertPlatformUser(userId: number): Promise<boolean> {
  const u = await db.query.usersTable.findFirst({
    where: and(
      eq(usersTable.id, userId),
      isNull(usersTable.workspaceId),
      eq(usersTable.role, "super_admin"),
    ),
  });
  return !!u;
}

async function loadTenantContext(tenantId: number) {
  const ws = await db.query.workspacesTable.findFirst({
    where: eq(workspacesTable.id, tenantId),
  });
  if (!ws) return { error: "Tenant not found" as const, status: 404 };
  const account = await db.query.commercialAccountsTable.findFirst({
    where: eq(commercialAccountsTable.workspaceId, tenantId),
  });
  if (!account) return { error: "No commercial account found for this tenant. Create one first." as const, status: 404 };
  return { ws, account };
}

async function demoteOtherActiveContracts(workspaceId: number, exceptId?: number) {
  const conditions = [
    eq(commercialContractTermsTable.workspaceId, workspaceId),
    eq(commercialContractTermsTable.status, "active"),
  ];
  if (exceptId !== undefined) {
    conditions.push(ne(commercialContractTermsTable.id, exceptId));
  }
  await db
    .update(commercialContractTermsTable)
    .set({ status: "archived" })
    .where(and(...conditions));
}

async function auditContract(
  action: string,
  actorId: number,
  workspaceId: number,
  meta: Record<string, unknown>,
) {
  await db.insert(activityLogsTable).values({
    userId:      actorId,
    workspaceId,
    action,
    metadata:    JSON.stringify(meta),
  });
}

const router: IRouter = Router();

// ── GET list ──────────────────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/commercial-contracts",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.read"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenantId" });
      return;
    }

    const ctx = await loadTenantContext(tenantId);
    if ("error" in ctx) {
      res.status(ctx.status).json({ error: ctx.error });
      return;
    }

    const contracts = await db.query.commercialContractTermsTable.findMany({
      where: eq(commercialContractTermsTable.workspaceId, tenantId),
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
    });

    res.json({ contracts });
  },
);

// ── GET one ───────────────────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/commercial-contracts/:contractId",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.read"),
  async (req: AuthRequest, res) => {
    const tenantId   = Number(req.params.tenantId);
    const contractId = Number(req.params.contractId);
    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(contractId) || contractId < 1) {
      res.status(400).json({ error: "Invalid tenantId or contractId" });
      return;
    }

    const contract = await db.query.commercialContractTermsTable.findFirst({
      where: and(
        eq(commercialContractTermsTable.id, contractId),
        eq(commercialContractTermsTable.workspaceId, tenantId),
      ),
    });
    if (!contract) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    res.json({ contract });
  },
);

// ── POST create ───────────────────────────────────────────────────────────────

router.post(
  "/platform/tenants/:tenantId/commercial-contracts",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenantId" });
      return;
    }

    const ctx = await loadTenantContext(tenantId);
    if ("error" in ctx) {
      res.status(ctx.status).json({ error: ctx.error });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const validationError = await validateContractBody(body, ctx.account.id, tenantId, true);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const fields = mapContractFields(body, ctx.account.id, tenantId);
    const actorId = req.userId!;

    if (fields.status === "active") {
      await demoteOtherActiveContracts(tenantId);
    }

    const [contract] = await db
      .insert(commercialContractTermsTable)
      .values({
        ...fields,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    await auditContract("commercial_contract_created", actorId, tenantId, {
      tenantId,
      commercialAccountId: ctx.account.id,
      contractId: contract.id,
      status: contract.status,
    });

    res.status(201).json({ contract });
  },
);

// ── PATCH update ──────────────────────────────────────────────────────────────

router.patch(
  "/platform/tenants/:tenantId/commercial-contracts/:contractId",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.update"),
  async (req: AuthRequest, res) => {
    const tenantId   = Number(req.params.tenantId);
    const contractId = Number(req.params.contractId);
    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(contractId) || contractId < 1) {
      res.status(400).json({ error: "Invalid tenantId or contractId" });
      return;
    }

    const existing = await db.query.commercialContractTermsTable.findFirst({
      where: and(
        eq(commercialContractTermsTable.id, contractId),
        eq(commercialContractTermsTable.workspaceId, tenantId),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const ctx = await loadTenantContext(tenantId);
    if ("error" in ctx) {
      res.status(ctx.status).json({ error: ctx.error });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const validationError = await validateContractBody(
      body,
      existing.commercialAccountId,
      tenantId,
      false,
      existing,
    );
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const patch = mapContractPatch(body, existing);
    const actorId = req.userId!;
    const nextStatus = patch.status ?? existing.status;

    if (nextStatus === "active" && existing.status !== "active") {
      await demoteOtherActiveContracts(tenantId, contractId);
    }

    const [contract] = await db
      .update(commercialContractTermsTable)
      .set({ ...patch, updatedBy: actorId })
      .where(eq(commercialContractTermsTable.id, contractId))
      .returning();

    const changedFields = Object.keys(patch).filter(k => k !== "updatedBy");

    await auditContract("commercial_contract_updated", actorId, tenantId, {
      tenantId,
      commercialAccountId: existing.commercialAccountId,
      contractId,
      changedFields,
    });

    res.json({ contract });
  },
);

// ── PATCH status ──────────────────────────────────────────────────────────────

router.patch(
  "/platform/tenants/:tenantId/commercial-contracts/:contractId/status",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contracts.update"),
  async (req: AuthRequest, res) => {
    const tenantId   = Number(req.params.tenantId);
    const contractId = Number(req.params.contractId);
    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(contractId) || contractId < 1) {
      res.status(400).json({ error: "Invalid tenantId or contractId" });
      return;
    }

    const { status, reason } = req.body as { status?: string; reason?: string };

    if (!status || !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }

    if (!reason || typeof reason !== "string" || reason.trim().length < MIN_REASON_LEN) {
      await auditContract("commercial_contract_status_change_blocked", req.userId!, tenantId, {
        tenantId,
        contractId,
        nextStatus: status,
        reason: "reason_required",
      });
      res.status(400).json({ error: `reason is required and must be at least ${MIN_REASON_LEN} characters` });
      return;
    }

    const existing = await db.query.commercialContractTermsTable.findFirst({
      where: and(
        eq(commercialContractTermsTable.id, contractId),
        eq(commercialContractTermsTable.workspaceId, tenantId),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    if (existing.status === status) {
      res.status(400).json({ error: "Contract is already in this status" });
      return;
    }

    const actorId = req.userId!;
    const previousStatus = existing.status;

    if (status === "active") {
      await demoteOtherActiveContracts(tenantId, contractId);
    }

    const [contract] = await db
      .update(commercialContractTermsTable)
      .set({ status, updatedBy: actorId })
      .where(eq(commercialContractTermsTable.id, contractId))
      .returning();

    await auditContract("commercial_contract_status_changed", actorId, tenantId, {
      tenantId,
      commercialAccountId: existing.commercialAccountId,
      contractId,
      previousStatus,
      nextStatus: status,
      reason: reason.trim().slice(0, MAX_TEXT),
    });

    res.json({ contract });
  },
);

// ── Validation helpers ────────────────────────────────────────────────────────

type ExistingContract = typeof commercialContractTermsTable.$inferSelect;

async function validateContractBody(
  body: Record<string, unknown>,
  commercialAccountId: number,
  tenantId: number,
  isCreate: boolean,
  existing?: ExistingContract,
): Promise<string | null> {
  if (isCreate) {
    const rawAcctId = body.commercialAccountId;
    if (rawAcctId === undefined || rawAcctId === null) {
      return "commercialAccountId is required";
    }
    const acctId = Number(rawAcctId);
    if (!Number.isFinite(acctId) || acctId !== commercialAccountId) {
      return "commercialAccountId does not match this tenant's commercial account";
    }
  } else if (body.commercialAccountId !== undefined) {
    const acctId = Number(body.commercialAccountId);
    if (!Number.isFinite(acctId) || acctId !== commercialAccountId) {
      return "commercialAccountId cannot be changed to a different account";
    }
  }

  if (body.renewalType !== undefined && body.renewalType !== null && body.renewalType !== "") {
    if (!VALID_RENEWAL_TYPES.includes(body.renewalType as typeof VALID_RENEWAL_TYPES[number])) {
      return `Invalid renewalType. Must be one of: ${VALID_RENEWAL_TYPES.join(", ")}`;
    }
  }

  if (body.renewalCommitmentStatus !== undefined && body.renewalCommitmentStatus !== null && body.renewalCommitmentStatus !== "") {
    if (!VALID_COMMITMENT_STATUSES.includes(body.renewalCommitmentStatus as typeof VALID_COMMITMENT_STATUSES[number])) {
      return `Invalid renewalCommitmentStatus. Must be one of: ${VALID_COMMITMENT_STATUSES.join(", ")}`;
    }
  }

  if (body.billingCycle !== undefined && body.billingCycle !== null && body.billingCycle !== "") {
    if (!VALID_BILLING_CYCLES.includes(body.billingCycle as typeof VALID_BILLING_CYCLES[number])) {
      return `Invalid billingCycle. Must be one of: ${VALID_BILLING_CYCLES.join(", ")}`;
    }
  }

  if (body.paymentTerms !== undefined && body.paymentTerms !== null && body.paymentTerms !== "") {
    if (!VALID_PAYMENT_TERMS.includes(body.paymentTerms as typeof VALID_PAYMENT_TERMS[number])) {
      return `Invalid paymentTerms. Must be one of: ${VALID_PAYMENT_TERMS.join(", ")}`;
    }
  }

  if (body.status !== undefined && body.status !== null && body.status !== "") {
    if (!VALID_STATUSES.includes(body.status as typeof VALID_STATUSES[number])) {
      return `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`;
    }
  }

  const email = body.customerDecisionMakerEmail;
  if (email !== undefined && email !== null && email !== "") {
    if (!isValidEmail(email)) return "Invalid customerDecisionMakerEmail format";
  }

  const currency = body.currency;
  if (currency !== undefined && currency !== null && currency !== "") {
    if (typeof currency !== "string" || currency.trim().length > 8) {
      return "Invalid currency";
    }
    const c = currency.trim().toUpperCase();
    if (!VALID_CURRENCIES.has(c)) {
      return `Invalid currency. Supported: ${[...VALID_CURRENCIES].join(", ")}`;
    }
  }

  const noticeDays = parseNonNegativeInt(body.renewalNoticeDays, "renewalNoticeDays");
  if (noticeDays === "INVALID") return "renewalNoticeDays must be a non-negative integer";

  const termMonths = parsePositiveInt(body.contractTermMonths);
  if (termMonths === "INVALID") return "contractTermMonths must be a positive integer";

  const contractValue = parseContractValue(body.contractValue);
  if (contractValue === "INVALID") return "contractValue must be a non-negative number";

  const start = body.contractStartDate !== undefined
    ? parseDate(body.contractStartDate)
    : (existing?.contractStartDate ?? null);
  const end = body.contractEndDate !== undefined
    ? parseDate(body.contractEndDate)
    : (existing?.contractEndDate ?? null);
  const renewal = body.renewalDate !== undefined
    ? parseDate(body.renewalDate)
    : (existing?.renewalDate ?? null);

  if (start === "INVALID" || end === "INVALID" || renewal === "INVALID") {
    return "Dates must be ISO format YYYY-MM-DD";
  }

  const dateErr = validateDateOrder({
    contractStartDate: start as string | null,
    contractEndDate: end as string | null,
    renewalDate: renewal as string | null,
  });
  if (dateErr) return dateErr;

  if (body.internalOwnerUserId !== undefined && body.internalOwnerUserId !== null && body.internalOwnerUserId !== "") {
    const ownerId = Number(body.internalOwnerUserId);
    if (!Number.isFinite(ownerId) || !Number.isInteger(ownerId) || ownerId < 1) {
      return "Invalid internalOwnerUserId";
    }
    if (!(await assertPlatformUser(ownerId))) {
      return "internalOwnerUserId must reference an active platform user";
    }
  }

  return null;
}

function mapContractFields(
  body: Record<string, unknown>,
  commercialAccountId: number,
  workspaceId: number,
) {
  const start = parseDate(body.contractStartDate);
  const end = parseDate(body.contractEndDate);
  const renewal = parseDate(body.renewalDate);
  const noticeDays = parseNonNegativeInt(body.renewalNoticeDays, "renewalNoticeDays");
  const termMonths = parsePositiveInt(body.contractTermMonths);
  const contractValue = parseContractValue(body.contractValue);
  const ownerRaw = body.internalOwnerUserId;

  let internalOwnerUserId: number | null = null;
  if (ownerRaw !== undefined && ownerRaw !== null && ownerRaw !== "") {
    internalOwnerUserId = Number(ownerRaw);
  }

  return {
    workspaceId,
    commercialAccountId,
    contractNumber:              strOpt(body.contractNumber, MAX_NUMBER),
    contractTitle:               strOpt(body.contractTitle, MAX_TITLE),
    contractStartDate:           start === "INVALID" ? null : start,
    contractEndDate:             end === "INVALID" ? null : end,
    renewalDate:                 renewal === "INVALID" ? null : renewal,
    renewalNoticeDays:           noticeDays === "INVALID" || noticeDays === "MISSING" ? null : noticeDays,
    contractTermMonths:          termMonths === "INVALID" || termMonths === "MISSING" ? null : termMonths,
    renewalType:                 typeof body.renewalType === "string" ? body.renewalType : "manual",
    renewalCommitmentStatus:     typeof body.renewalCommitmentStatus === "string" ? body.renewalCommitmentStatus : "not_started",
    contractValue:               contractValue === "INVALID" || contractValue === "MISSING" ? null : contractValue,
    currency:                    typeof body.currency === "string" ? body.currency.trim().toUpperCase().slice(0, 8) : null,
    billingCycle:                strOpt(body.billingCycle, 32),
    paymentTerms:                strOpt(body.paymentTerms, 32),
    internalOwnerUserId,
    customerDecisionMakerName:     strOpt(body.customerDecisionMakerName, MAX_NAME),
    customerDecisionMakerEmail:  typeof body.customerDecisionMakerEmail === "string"
      ? body.customerDecisionMakerEmail.trim().toLowerCase().slice(0, 254)
      : null,
    renewalNotes:                strOpt(body.renewalNotes, MAX_TEXT),
    status:                      typeof body.status === "string" ? body.status : "draft",
  };
}

function mapContractPatch(body: Record<string, unknown>, existing: ExistingContract) {
  const patch: Record<string, unknown> = {};

  if (body.contractNumber !== undefined) patch.contractNumber = strOpt(body.contractNumber, MAX_NUMBER);
  if (body.contractTitle !== undefined) patch.contractTitle = strOpt(body.contractTitle, MAX_TITLE);
  if (body.contractStartDate !== undefined) {
    const d = parseDate(body.contractStartDate);
    patch.contractStartDate = d === "INVALID" ? existing.contractStartDate : d;
  }
  if (body.contractEndDate !== undefined) {
    const d = parseDate(body.contractEndDate);
    patch.contractEndDate = d === "INVALID" ? existing.contractEndDate : d;
  }
  if (body.renewalDate !== undefined) {
    const d = parseDate(body.renewalDate);
    patch.renewalDate = d === "INVALID" ? existing.renewalDate : d;
  }
  if (body.renewalNoticeDays !== undefined) {
    const n = parseNonNegativeInt(body.renewalNoticeDays, "renewalNoticeDays");
    if (n !== "INVALID" && n !== "MISSING") patch.renewalNoticeDays = n;
  }
  if (body.contractTermMonths !== undefined) {
    const n = parsePositiveInt(body.contractTermMonths);
    if (n !== "INVALID" && n !== "MISSING") patch.contractTermMonths = n;
  }
  if (body.renewalType !== undefined && typeof body.renewalType === "string") patch.renewalType = body.renewalType;
  if (body.renewalCommitmentStatus !== undefined && typeof body.renewalCommitmentStatus === "string") {
    patch.renewalCommitmentStatus = body.renewalCommitmentStatus;
  }
  if (body.contractValue !== undefined) {
    const v = parseContractValue(body.contractValue);
    if (v !== "INVALID" && v !== "MISSING") patch.contractValue = v;
  }
  if (body.currency !== undefined && typeof body.currency === "string") {
    patch.currency = body.currency.trim().toUpperCase().slice(0, 8);
  }
  if (body.billingCycle !== undefined) patch.billingCycle = strOpt(body.billingCycle, 32);
  if (body.paymentTerms !== undefined) patch.paymentTerms = strOpt(body.paymentTerms, 32);
  if (body.internalOwnerUserId !== undefined) {
    if (body.internalOwnerUserId === null || body.internalOwnerUserId === "") {
      patch.internalOwnerUserId = null;
    } else {
      patch.internalOwnerUserId = Number(body.internalOwnerUserId);
    }
  }
  if (body.customerDecisionMakerName !== undefined) {
    patch.customerDecisionMakerName = strOpt(body.customerDecisionMakerName, MAX_NAME);
  }
  if (body.customerDecisionMakerEmail !== undefined) {
    patch.customerDecisionMakerEmail = typeof body.customerDecisionMakerEmail === "string"
      ? body.customerDecisionMakerEmail.trim().toLowerCase().slice(0, 254)
      : null;
  }
  if (body.renewalNotes !== undefined) patch.renewalNotes = strOpt(body.renewalNotes, MAX_TEXT);
  if (body.status !== undefined && typeof body.status === "string") patch.status = body.status;

  return patch;
}

export default router;
