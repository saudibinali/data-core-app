/**
 * commercial-audit-events.test.ts
 *
 * @phase P15-A - Commercial Accounts & Billing Contacts
 *
 * Unit tests for the 6 new commercial audit event definitions.
 * Verifies event registration, group membership, and config map entry.
 *
 * Pure vitest unit tests - no DB, no HTTP.
 */

import { describe, it, expect } from "vitest";
import {
  PLATFORM_AUDIT_EVENT_CONFIG,
  PLATFORM_AUDIT_EVENT_GROUPS,
  PLATFORM_AUDIT_ACTION_CODES,
  getPlatformAuditEventConfig,
} from "../platform-audit-events";

const COMMERCIAL_ACTION_CODES = [
  "commercial_account_created",
  "commercial_account_updated",
  "commercial_billing_contact_created",
  "commercial_billing_contact_updated",
  "commercial_billing_contact_primary_changed",
  "commercial_access_denied",
  "commercial_contract_created",
  "commercial_contract_updated",
  "commercial_contract_status_changed",
  "commercial_contract_status_change_blocked",
  "commercial_invoice_created",
  "commercial_invoice_updated",
  "commercial_invoice_status_changed",
  "commercial_invoice_status_change_blocked",
  "commercial_invoice_document_uploaded",
  "commercial_invoice_document_downloaded",
  "commercial_invoice_document_upload_blocked",
  "commercial_payment_recorded",
  "commercial_payment_updated",
  "commercial_payment_verified",
  "commercial_payment_rejected",
  "commercial_payment_reversed",
  "commercial_payment_action_blocked",
  "commercial_risk_viewed",
  "commercial_risk_access_denied",
] as const;

// ── Group registration ────────────────────────────────────────────────────────

describe("commercial audit group", () => {
  it("'commercial' group is in PLATFORM_AUDIT_EVENT_GROUPS", () => {
    expect(PLATFORM_AUDIT_EVENT_GROUPS).toContain("commercial");
  });
});

// ── Event registration ────────────────────────────────────────────────────────

describe("commercial audit events - registration", () => {
  it.each(COMMERCIAL_ACTION_CODES)("%s is registered in PLATFORM_AUDIT_EVENT_CONFIG", (code) => {
    expect(PLATFORM_AUDIT_EVENT_CONFIG[code]).toBeDefined();
  });

  it.each(COMMERCIAL_ACTION_CODES)("%s is in PLATFORM_AUDIT_ACTION_CODES", (code) => {
    expect(PLATFORM_AUDIT_ACTION_CODES).toContain(code);
  });
});

// ── Event definitions ─────────────────────────────────────────────────────────

describe("commercial audit events - definitions", () => {
  it.each(COMMERCIAL_ACTION_CODES)("%s has group='commercial'", (code) => {
    expect(PLATFORM_AUDIT_EVENT_CONFIG[code].group).toBe("commercial");
  });

  it.each(COMMERCIAL_ACTION_CODES)("%s has required fields", (code) => {
    const def = PLATFORM_AUDIT_EVENT_CONFIG[code];
    expect(typeof def.label).toBe("string");
    expect(typeof def.labelAr).toBe("string");
    expect(typeof def.description).toBe("string");
    expect(["info", "warning", "critical"]).toContain(def.severity);
    expect(["success", "blocked", "denied", "failed"]).toContain(def.resultType);
  });

  it("commercial_access_denied has severity='warning' and resultType='denied'", () => {
    const def = PLATFORM_AUDIT_EVENT_CONFIG["commercial_access_denied"];
    expect(def.severity).toBe("warning");
    expect(def.resultType).toBe("denied");
  });

  it.each([
    "commercial_account_created",
    "commercial_account_updated",
    "commercial_billing_contact_created",
    "commercial_billing_contact_updated",
    "commercial_billing_contact_primary_changed",
  ] as const)("%s has severity='info' and resultType='success'", (code) => {
    const def = PLATFORM_AUDIT_EVENT_CONFIG[code];
    expect(def.severity).toBe("info");
    expect(def.resultType).toBe("success");
  });
});

// ── getPlatformAuditEventConfig helper ────────────────────────────────────────

describe("getPlatformAuditEventConfig - commercial events", () => {
  it.each(COMMERCIAL_ACTION_CODES)("returns correct def for %s", (code) => {
    const def = getPlatformAuditEventConfig(code);
    expect(def.actionCode).toBe(code);
    expect(def.group).toBe("commercial");
  });
});
