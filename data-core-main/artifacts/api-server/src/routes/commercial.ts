/**
 * @file   routes/commercial.ts
 * @phase  P15-A - Commercial Accounts & Billing Contacts
 *
 * GET    /platform/tenants/:tenantId/commercial-account
 * PUT    /platform/tenants/:tenantId/commercial-account
 * GET    /platform/tenants/:tenantId/commercial-contacts
 * POST   /platform/tenants/:tenantId/commercial-contacts
 * PATCH  /platform/tenants/:tenantId/commercial-contacts/:contactId
 * PATCH  /platform/tenants/:tenantId/commercial-contacts/:contactId/primary
 *
 * SAFETY CONTRACT:
 *   - No payment processing, no Stripe, no invoice, no tax calculation.
 *   - No delete - contacts are soft-deprecated via update only.
 *   - No tenant-side visibility - platform administration only.
 *   - commercial.accounts.read  required for all account reads.
 *   - commercial.accounts.update required for account upsert.
 *   - commercial.contacts.read  required for contact list.
 *   - commercial.contacts.update required for contact create/update/primary.
 *   - All mutations emit platform audit events via activityLogsTable.
 */

import { Router, type IRouter }   from "express";
import { db }                      from "@workspace/db";
import {
  workspacesTable,
  activityLogsTable,
  commercialAccountsTable,
  commercialBillingContactsTable,
}                                  from "@workspace/db";
import { eq, and }                 from "drizzle-orm";
import {
  type AuthRequest,
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission,
}                                  from "../middlewares/requireAuth";

// ── Inline constants (no cross-artifact import) ───────────────────────────────

const VALID_STATUSES  = ["draft", "active", "under_review", "inactive"] as const;
const VALID_ROLES     = ["finance_contact", "procurement_contact", "contract_owner", "executive_sponsor", "other"] as const;
const MAX_TEXT        = 2000;
const MAX_NAME        = 200;
const MAX_PHONE       = 30;
const MAX_CONTACT_NAME = 150;

// Simple RFC-5322 subset - rejects clearly malformed emails
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function strOpt(v: unknown, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return null;
  return v.trim().slice(0, max) || null;
}

function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && EMAIL_RE.test(v.trim());
}

/** Returns the positive integer value, or null to clear, or "INVALID" for bad input. */
function parseOptionalUserId(v: unknown): number | null | "INVALID" {
  if (v === undefined || v === null || v === "") return undefined as never; // not provided - signal "skip"
  if (v === 0 || v === "0") return null; // explicit clear
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return "INVALID";
  return n;
}

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/tenants/:tenantId/commercial-account
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/commercial-account",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.accounts.read"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenantId" });
      return;
    }

    const ws = await db.query.workspacesTable.findFirst({
      where: eq(workspacesTable.id, tenantId),
    });
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const account = await db.query.commercialAccountsTable.findFirst({
      where: eq(commercialAccountsTable.workspaceId, tenantId),
    });

    res.json({ commercialAccount: account ?? null });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /platform/tenants/:tenantId/commercial-account
// ─────────────────────────────────────────────────────────────────────────────

router.put(
  "/platform/tenants/:tenantId/commercial-account",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.accounts.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenantId" });
      return;
    }

    const ws = await db.query.workspacesTable.findFirst({
      where: eq(workspacesTable.id, tenantId),
    });
    if (!ws) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    const {
      commercialAccountName,
      legalEntityName,
      billingEmail,
      billingPhone,
      contractOwnerName,
      contractOwnerEmail,
      companyTaxNumberPlaceholder,
      commercialNotes,
      status,
      accountManagerUserId: rawAccountManager,
      financeOwnerUserId:   rawFinanceOwner,
    } = req.body as Record<string, unknown>;

    // ── Validate status ───────────────────────────────────────────────────────
    if (status !== undefined && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }

    // ── Validate email fields ─────────────────────────────────────────────────
    if (billingEmail !== undefined && billingEmail !== null && billingEmail !== "") {
      if (!isValidEmail(billingEmail)) {
        res.status(400).json({ error: "Invalid billingEmail format" });
        return;
      }
    }
    if (contractOwnerEmail !== undefined && contractOwnerEmail !== null && contractOwnerEmail !== "") {
      if (!isValidEmail(contractOwnerEmail)) {
        res.status(400).json({ error: "Invalid contractOwnerEmail format" });
        return;
      }
    }

    // ── Validate optional user ID fields ──────────────────────────────────────
    let accountManagerId: number | null | undefined;
    if (rawAccountManager !== undefined) {
      const parsed = parseOptionalUserId(rawAccountManager);
      if (parsed === "INVALID") {
        res.status(400).json({ error: "Invalid accountManagerUserId: must be a positive integer or 0 to clear" });
        return;
      }
      accountManagerId = parsed as number | null;
    }

    let financeOwnerId: number | null | undefined;
    if (rawFinanceOwner !== undefined) {
      const parsed = parseOptionalUserId(rawFinanceOwner);
      if (parsed === "INVALID") {
        res.status(400).json({ error: "Invalid financeOwnerUserId: must be a positive integer or 0 to clear" });
        return;
      }
      financeOwnerId = parsed as number | null;
    }

    const existing = await db.query.commercialAccountsTable.findFirst({
      where: eq(commercialAccountsTable.workspaceId, tenantId),
    });

    let account;
    const actorId = req.userId!;
    const wsId    = ws.id;

    if (existing) {
      [account] = await db
        .update(commercialAccountsTable)
        .set({
          commercialAccountName: strOpt(commercialAccountName, MAX_NAME),
          legalEntityName:       strOpt(legalEntityName, MAX_NAME),
          billingEmail:          strOpt(billingEmail, 254),
          billingPhone:          strOpt(billingPhone, MAX_PHONE),
          contractOwnerName:     strOpt(contractOwnerName, MAX_NAME),
          contractOwnerEmail:    strOpt(contractOwnerEmail, 254),
          companyTaxNumberPlaceholder: strOpt(companyTaxNumberPlaceholder, 100),
          commercialNotes:       strOpt(commercialNotes, MAX_TEXT),
          ...(status !== undefined && { status: String(status) }),
          ...(accountManagerId !== undefined && { accountManagerUserId: accountManagerId }),
          ...(financeOwnerId   !== undefined && { financeOwnerUserId:   financeOwnerId   }),
          updatedBy:             actorId,
        })
        .where(eq(commercialAccountsTable.workspaceId, tenantId))
        .returning();

      await db.insert(activityLogsTable).values({
        userId:      actorId,
        workspaceId: wsId,
        action:      "commercial_account_updated",
        metadata:    JSON.stringify({ tenantId, workspaceName: ws.name }),
      });

      res.json({ commercialAccount: account });
    } else {
      [account] = await db
        .insert(commercialAccountsTable)
        .values({
          workspaceId:           tenantId,
          commercialAccountName: strOpt(commercialAccountName, MAX_NAME),
          legalEntityName:       strOpt(legalEntityName, MAX_NAME),
          billingEmail:          strOpt(billingEmail, 254),
          billingPhone:          strOpt(billingPhone, MAX_PHONE),
          contractOwnerName:     strOpt(contractOwnerName, MAX_NAME),
          contractOwnerEmail:    strOpt(contractOwnerEmail, 254),
          companyTaxNumberPlaceholder: strOpt(companyTaxNumberPlaceholder, 100),
          commercialNotes:       strOpt(commercialNotes, MAX_TEXT),
          status:                typeof status === "string" ? status : "draft",
          ...(accountManagerId !== undefined && { accountManagerUserId: accountManagerId }),
          ...(financeOwnerId   !== undefined && { financeOwnerUserId:   financeOwnerId   }),
          createdBy:             actorId,
          updatedBy:             actorId,
        })
        .returning();

      await db.insert(activityLogsTable).values({
        userId:      actorId,
        workspaceId: wsId,
        action:      "commercial_account_created",
        metadata:    JSON.stringify({ tenantId, workspaceName: ws.name }),
      });

      res.status(201).json({ commercialAccount: account });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /platform/tenants/:tenantId/commercial-contacts
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/platform/tenants/:tenantId/commercial-contacts",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contacts.read"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenantId" });
      return;
    }

    const account = await db.query.commercialAccountsTable.findFirst({
      where: eq(commercialAccountsTable.workspaceId, tenantId),
    });
    if (!account) {
      res.json({ contacts: [] });
      return;
    }

    const contacts = await db.query.commercialBillingContactsTable.findMany({
      where: eq(commercialBillingContactsTable.commercialAccountId, account.id),
      orderBy: (t, { desc, asc }) => [desc(t.isPrimary), asc(t.createdAt)],
    });

    res.json({ contacts });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /platform/tenants/:tenantId/commercial-contacts
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/platform/tenants/:tenantId/commercial-contacts",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contacts.update"),
  async (req: AuthRequest, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isFinite(tenantId) || tenantId < 1) {
      res.status(400).json({ error: "Invalid tenantId" });
      return;
    }

    const account = await db.query.commercialAccountsTable.findFirst({
      where: eq(commercialAccountsTable.workspaceId, tenantId),
    });
    if (!account) {
      res.status(404).json({ error: "No commercial account found for this tenant. Create one first." });
      return;
    }

    const { contactName, contactEmail, contactPhone, contactRole, notes } = req.body as Record<string, unknown>;

    if (!contactName || typeof contactName !== "string" || !contactName.trim()) {
      res.status(400).json({ error: "contactName is required" });
      return;
    }
    if (!contactEmail || typeof contactEmail !== "string" || !contactEmail.trim()) {
      res.status(400).json({ error: "contactEmail is required" });
      return;
    }
    if (!isValidEmail(contactEmail)) {
      res.status(400).json({ error: "Invalid contactEmail format" });
      return;
    }

    const resolvedRole = typeof contactRole === "string" && VALID_ROLES.includes(contactRole as typeof VALID_ROLES[number])
      ? contactRole
      : "other";

    const actorId = req.userId!;

    const [contact] = await db
      .insert(commercialBillingContactsTable)
      .values({
        commercialAccountId: account.id,
        contactName:         contactName.trim().slice(0, MAX_CONTACT_NAME),
        contactEmail:        contactEmail.trim().slice(0, 254),
        contactPhone:        strOpt(contactPhone, MAX_PHONE),
        contactRole:         resolvedRole,
        notes:               strOpt(notes, 500),
        isPrimary:           false,
        createdBy:           actorId,
        updatedBy:           actorId,
      })
      .returning();

    await db.insert(activityLogsTable).values({
      userId:      actorId,
      workspaceId: account.workspaceId,
      action:      "commercial_billing_contact_created",
      metadata:    JSON.stringify({ tenantId, contactId: contact.id, contactName: contact.contactName }),
    });

    res.status(201).json({ contact });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /platform/tenants/:tenantId/commercial-contacts/:contactId
// ─────────────────────────────────────────────────────────────────────────────

router.patch(
  "/platform/tenants/:tenantId/commercial-contacts/:contactId",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contacts.update"),
  async (req: AuthRequest, res) => {
    const tenantId   = Number(req.params.tenantId);
    const contactId  = Number(req.params.contactId);

    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(contactId) || contactId < 1) {
      res.status(400).json({ error: "Invalid tenantId or contactId" });
      return;
    }

    const account = await db.query.commercialAccountsTable.findFirst({
      where: eq(commercialAccountsTable.workspaceId, tenantId),
    });
    if (!account) {
      res.status(404).json({ error: "No commercial account found for this tenant" });
      return;
    }

    const existing = await db.query.commercialBillingContactsTable.findFirst({
      where: and(
        eq(commercialBillingContactsTable.id, contactId),
        eq(commercialBillingContactsTable.commercialAccountId, account.id),
      ),
    });
    if (!existing) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    const { contactName, contactEmail, contactPhone, contactRole, notes } = req.body as Record<string, unknown>;

    // Validate email only if provided and non-empty
    if (contactEmail !== undefined && contactEmail !== null && contactEmail !== "") {
      if (!isValidEmail(contactEmail)) {
        res.status(400).json({ error: "Invalid contactEmail format" });
        return;
      }
    }

    const resolvedRole = typeof contactRole === "string" && VALID_ROLES.includes(contactRole as typeof VALID_ROLES[number])
      ? contactRole
      : existing.contactRole;

    const actorId = req.userId!;

    const [contact] = await db
      .update(commercialBillingContactsTable)
      .set({
        contactName:  typeof contactName === "string" && contactName.trim() ? contactName.trim().slice(0, MAX_CONTACT_NAME) : existing.contactName,
        contactEmail: typeof contactEmail === "string" && contactEmail.trim() ? contactEmail.trim().slice(0, 254) : existing.contactEmail,
        contactPhone: contactPhone !== undefined ? strOpt(contactPhone, MAX_PHONE) : existing.contactPhone,
        contactRole:  resolvedRole,
        notes:        notes !== undefined ? strOpt(notes, 500) : existing.notes,
        updatedBy:    actorId,
      })
      .where(and(
        eq(commercialBillingContactsTable.id, contactId),
        eq(commercialBillingContactsTable.commercialAccountId, account.id),
      ))
      .returning();

    await db.insert(activityLogsTable).values({
      userId:      actorId,
      workspaceId: account.workspaceId,
      action:      "commercial_billing_contact_updated",
      metadata:    JSON.stringify({ tenantId, contactId, contactName: contact.contactName }),
    });

    res.json({ contact });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /platform/tenants/:tenantId/commercial-contacts/:contactId/primary
// ─────────────────────────────────────────────────────────────────────────────

router.patch(
  "/platform/tenants/:tenantId/commercial-contacts/:contactId/primary",
  requireAuth,
  requireSuperAdmin,
  requirePlatformPermission("commercial.contacts.update"),
  async (req: AuthRequest, res) => {
    const tenantId  = Number(req.params.tenantId);
    const contactId = Number(req.params.contactId);

    if (!Number.isFinite(tenantId) || tenantId < 1 || !Number.isFinite(contactId) || contactId < 1) {
      res.status(400).json({ error: "Invalid tenantId or contactId" });
      return;
    }

    const account = await db.query.commercialAccountsTable.findFirst({
      where: eq(commercialAccountsTable.workspaceId, tenantId),
    });
    if (!account) {
      res.status(404).json({ error: "No commercial account found for this tenant" });
      return;
    }

    const target = await db.query.commercialBillingContactsTable.findFirst({
      where: and(
        eq(commercialBillingContactsTable.id, contactId),
        eq(commercialBillingContactsTable.commercialAccountId, account.id),
      ),
    });
    if (!target) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    const actorId = req.userId!;

    // Clear existing primary
    await db
      .update(commercialBillingContactsTable)
      .set({ isPrimary: false })
      .where(eq(commercialBillingContactsTable.commercialAccountId, account.id));

    // Set new primary
    const [contact] = await db
      .update(commercialBillingContactsTable)
      .set({ isPrimary: true, updatedBy: actorId })
      .where(and(
        eq(commercialBillingContactsTable.id, contactId),
        eq(commercialBillingContactsTable.commercialAccountId, account.id),
      ))
      .returning();

    await db.insert(activityLogsTable).values({
      userId:      actorId,
      workspaceId: account.workspaceId,
      action:      "commercial_billing_contact_primary_changed",
      metadata:    JSON.stringify({ tenantId, contactId, contactName: contact.contactName }),
    });

    res.json({ contact });
  },
);

export default router;
