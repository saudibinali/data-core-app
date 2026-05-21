/**
 * commercial-permissions.test.ts
 *
 * @phase P15-A - Commercial Accounts & Billing Contacts
 *
 * Unit tests for the 4 commercial permission codes, their presence in
 * PLATFORM_PERMISSION_CODES, their definitions in PLATFORM_PERMISSION_CONFIG,
 * and their role assignments in PLATFORM_ROLE_PERMISSION_MATRIX.
 *
 * Pure vitest unit tests - no DB, no HTTP, no side effects.
 */

import { describe, it, expect } from "vitest";
import {
  PLATFORM_PERMISSION_CODES,
  PLATFORM_PERMISSION_CONFIG,
  PLATFORM_ROLE_PERMISSION_MATRIX,
} from "../platform-permissions";

const COMMERCIAL_CODES = [
  "commercial.accounts.read",
  "commercial.accounts.update",
  "commercial.contacts.read",
  "commercial.contacts.update",
  "commercial.contracts.read",
  "commercial.contracts.update",
  "commercial.invoices.read",
  "commercial.invoices.update",
  "commercial.invoiceDocuments.read",
  "commercial.invoiceDocuments.upload",
  "commercial.payments.read",
  "commercial.payments.record",
  "commercial.payments.verify",
  "commercial.risk.read",
] as const;

// ── Code registration ─────────────────────────────────────────────────────────

describe("commercial permission codes - registration", () => {
  it.each(COMMERCIAL_CODES)("%s is in PLATFORM_PERMISSION_CODES", (code) => {
    expect(PLATFORM_PERMISSION_CODES).toContain(code);
  });

  it("total permission count is 39 (18 original + 14 commercial + 3 subscription + 2 entitlements + 2 quotas)", () => {
    expect(PLATFORM_PERMISSION_CODES.length).toBe(59);
  });
});

// ── Definition completeness ───────────────────────────────────────────────────

describe("commercial permission definitions", () => {
  it.each(COMMERCIAL_CODES)("%s has a definition in PLATFORM_PERMISSION_CONFIG", (code) => {
    expect(PLATFORM_PERMISSION_CONFIG[code]).toBeDefined();
  });

  it.each(COMMERCIAL_CODES)("%s definition has required fields", (code) => {
    const def = PLATFORM_PERMISSION_CONFIG[code];
    expect(def.code).toBe(code);
    expect(typeof def.label).toBe("string");
    expect(typeof def.labelAr).toBe("string");
    expect(typeof def.description).toBe("string");
    expect(def.group).toBe("Commercial");
    expect(["read", "controlled_write", "sensitive_write", "root_only"]).toContain(def.riskLevel);
  });

  it("commercial.accounts.read has riskLevel=read", () => {
    expect(PLATFORM_PERMISSION_CONFIG["commercial.accounts.read"].riskLevel).toBe("read");
  });

  it("commercial.accounts.update has riskLevel=controlled_write", () => {
    expect(PLATFORM_PERMISSION_CONFIG["commercial.accounts.update"].riskLevel).toBe("controlled_write");
  });

  it("commercial.contacts.read has riskLevel=sensitive_write (contacts have sensitive data)", () => {
    expect(PLATFORM_PERMISSION_CONFIG["commercial.contacts.read"].riskLevel).toBe("sensitive_write");
  });

  it("commercial.contacts.update has riskLevel=controlled_write", () => {
    expect(PLATFORM_PERMISSION_CONFIG["commercial.contacts.update"].riskLevel).toBe("controlled_write");
  });
});

// ── Role matrix - full-access roles ──────────────────────────────────────────

describe("commercial permissions - root and platform_admin have all", () => {
  it.each(COMMERCIAL_CODES)(
    "root_platform_owner has %s",
    (code) => expect(PLATFORM_ROLE_PERMISSION_MATRIX.root_platform_owner.has(code)).toBe(true),
  );
  it.each(COMMERCIAL_CODES)(
    "platform_admin has %s",
    (code) => expect(PLATFORM_ROLE_PERMISSION_MATRIX.platform_admin.has(code)).toBe(true),
  );
});

// ── Role matrix - sales_admin ─────────────────────────────────────────────────

describe("commercial permissions - sales_admin", () => {
  const SALES_HAS = [
    "commercial.accounts.read",
    "commercial.accounts.update",
    "commercial.contacts.read",
    "commercial.contacts.update",
    "commercial.contracts.read",
    "commercial.contracts.update",
    "commercial.invoices.read",
    "commercial.invoiceDocuments.read",
    "commercial.payments.read",
  ] as const;

  it.each(SALES_HAS)("sales_admin has %s", (code) => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.sales_admin.has(code)).toBe(true);
  });

  it("sales_admin does NOT have commercial.invoices.update", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.sales_admin.has("commercial.invoices.update")).toBe(false);
  });

  it("sales_admin does NOT have commercial.invoiceDocuments.upload", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.sales_admin.has("commercial.invoiceDocuments.upload")).toBe(false);
  });

  it("sales_admin does NOT have commercial.payments.record", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.sales_admin.has("commercial.payments.record")).toBe(false);
  });

  it("sales_admin has commercial.risk.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.sales_admin.has("commercial.risk.read")).toBe(true);
  });
});

// ── Role matrix - finance_admin ───────────────────────────────────────────────

describe("commercial permissions - finance_admin", () => {
  it.each(COMMERCIAL_CODES)(
    "finance_admin has %s",
    (code) => expect(PLATFORM_ROLE_PERMISSION_MATRIX.finance_admin.has(code)).toBe(true),
  );
});

// ── Role matrix - auditor (read-only commercial) ─────────────────────────────

describe("commercial permissions - auditor (read only)", () => {
  it("auditor has commercial.accounts.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.auditor.has("commercial.accounts.read")).toBe(true);
  });
  it("auditor has commercial.contacts.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.auditor.has("commercial.contacts.read")).toBe(true);
  });
  it("auditor has commercial.contracts.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.auditor.has("commercial.contracts.read")).toBe(true);
  });
  it("auditor does NOT have commercial.accounts.update", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.auditor.has("commercial.accounts.update")).toBe(false);
  });
  it("auditor does NOT have commercial.contacts.update", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.auditor.has("commercial.contacts.update")).toBe(false);
  });
  it("auditor does NOT have commercial.contracts.update", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.auditor.has("commercial.contracts.update")).toBe(false);
  });

  it("auditor has commercial.risk.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.auditor.has("commercial.risk.read")).toBe(true);
  });
});

// ── Role matrix - support_admin (accounts.read only) ─────────────────────────

describe("commercial permissions - support_admin", () => {
  it("support_admin has commercial.accounts.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.support_admin.has("commercial.accounts.read")).toBe(true);
  });
  it("support_admin has commercial.contracts.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.support_admin.has("commercial.contracts.read")).toBe(true);
  });
  it("support_admin does NOT have commercial.accounts.update", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.support_admin.has("commercial.accounts.update")).toBe(false);
  });
  it("support_admin does NOT have commercial.contacts.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.support_admin.has("commercial.contacts.read")).toBe(false);
  });
  it("support_admin does NOT have commercial.contacts.update", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.support_admin.has("commercial.contacts.update")).toBe(false);
  });
  it("support_admin does NOT have commercial.contracts.update", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.support_admin.has("commercial.contracts.update")).toBe(false);
  });

  it("support_admin has commercial.risk.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.support_admin.has("commercial.risk.read")).toBe(true);
  });
});

// ── Role matrix - workspace_support (no commercial) ──────────────────────────

describe("commercial permissions - workspace_support (no commercial)", () => {
  it.each(COMMERCIAL_CODES)(
    "workspace_support does NOT have %s",
    (code) => expect(PLATFORM_ROLE_PERMISSION_MATRIX.workspace_support.has(code)).toBe(false),
  );
});

// ── Role matrix - read_only_operator (accounts.read only) ────────────────────

describe("commercial permissions - read_only_operator", () => {
  it("read_only_operator has commercial.accounts.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.read_only_operator.has("commercial.accounts.read")).toBe(true);
  });
  it("read_only_operator has commercial.contracts.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.read_only_operator.has("commercial.contracts.read")).toBe(true);
  });
  it("read_only_operator does NOT have commercial.accounts.update", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.read_only_operator.has("commercial.accounts.update")).toBe(false);
  });
  it("read_only_operator does NOT have commercial.contacts.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.read_only_operator.has("commercial.contacts.read")).toBe(false);
  });
  it("read_only_operator does NOT have commercial.contacts.update", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.read_only_operator.has("commercial.contacts.update")).toBe(false);
  });
  it("read_only_operator does NOT have commercial.contracts.update", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.read_only_operator.has("commercial.contracts.update")).toBe(false);
  });

  it("read_only_operator has commercial.risk.read", () => {
    expect(PLATFORM_ROLE_PERMISSION_MATRIX.read_only_operator.has("commercial.risk.read")).toBe(true);
  });
});


