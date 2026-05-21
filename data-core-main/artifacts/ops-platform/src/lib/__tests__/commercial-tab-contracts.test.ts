/**
 * commercial-tab-contracts.test.ts
 *
 * @phase P15-B - Contract Terms UI gating & safety (static + permission helpers)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canPerformPlatformAction,
  hasPlatformPermissionClient,
  type MinimalPlatformUser,
} from "../platform-access";

const ROOT = resolve(import.meta.dirname, "../..");

function readSrc(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("P15-B - contract permission gating (client)", () => {
  const sales: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "sales_admin",
    isRootOwner: false,
  };
  const auditor: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "auditor",
    isRootOwner: false,
  };
  const support: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "support_admin",
    isRootOwner: false,
  };
  const workspaceSupport: MinimalPlatformUser = {
    role: "super_admin",
    platformRoleCode: "workspace_support",
    isRootOwner: false,
  };

  it("sales_admin can read and update contracts", () => {
    expect(hasPlatformPermissionClient(sales, "commercial.contracts.read")).toBe(true);
    expect(canPerformPlatformAction(sales, "commercial.contracts.update")).toBe(true);
  });

  it("auditor can read but not update contracts", () => {
    expect(hasPlatformPermissionClient(auditor, "commercial.contracts.read")).toBe(true);
    expect(canPerformPlatformAction(auditor, "commercial.contracts.update")).toBe(false);
  });

  it("support_admin can read but not update contracts", () => {
    expect(hasPlatformPermissionClient(support, "commercial.contracts.read")).toBe(true);
    expect(canPerformPlatformAction(support, "commercial.contracts.update")).toBe(false);
  });

  it("workspace_support cannot read or update contracts", () => {
    expect(hasPlatformPermissionClient(workspaceSupport, "commercial.contracts.read")).toBe(false);
    expect(canPerformPlatformAction(workspaceSupport, "commercial.contracts.update")).toBe(false);
  });
});

describe("P15-B - Commercial tab contract section (static)", () => {
  const consolePage = readSrc("components/commercial/CommercialConsole.tsx");
  const contractSection = readSrc("components/commercial/ContractTermsSection.tsx");

  it("renders ContractTermsSection only when canReadContracts is true", () => {
    expect(consolePage).toContain("canReadContracts &&");
    expect(consolePage).toContain("<ContractTermsSection");
  });

  it("passes canWrite to ContractTermsSection for action buttons", () => {
    expect(consolePage).toContain("canWrite={canWriteContracts}");
  });

  it("ContractTermsSection exposes expected test ids", () => {
    expect(contractSection).toContain('data-testid="commercial-contract-terms-section"');
    expect(contractSection).toContain('data-testid="commercial-add-contract-btn"');
    expect(contractSection).toContain("Change Status");
  });

  it("does not add forbidden billing/payment/invoice UI in contract section", () => {
    const forbidden = [
      "stripe",
      "checkout",
      "generate invoice",
      "upload invoice",
      "ZATCA",
      "send email",
      "delete contract",
      "payment gateway",
    ];
    const lower = contractSection.toLowerCase();
    for (const term of forbidden) {
      expect(lower.includes(term), `forbidden term: ${term}`).toBe(false);
    }
  });
});
